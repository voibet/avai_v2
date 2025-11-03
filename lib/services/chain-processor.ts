import pool from '@/lib/database/db';
import { FixtureFetcher } from './fixture-fetcher';
import { XGFetcher } from './xg-fetcher';
import { IN_PAST, IN_PLAY, IN_FUTURE } from '../constants';

interface ChainOptions {
  type: 'league' | 'all';
  leagueId?: number;
  fixtureId?: number;
  onProgress?: (message: string, current: number, total: number) => void;
  skipFixtureFetch?: boolean;
  skipXG?: boolean;
  forceStatsUpdate?: boolean;
}

interface ChainResult {
  success: boolean;
  message: string;
  fixturesUpdated: number;
  xgUpdated: number;
}

export async function executeChain(options: ChainOptions): Promise<ChainResult> {
  const { type, leagueId, fixtureId, onProgress, skipFixtureFetch = false, skipXG = false, forceStatsUpdate = false } = options;

  let fixturesUpdated = 0;
  let statusChangedToPastCount = 0;

  // Calculate total steps based on what we're actually doing
  const totalSteps = 5 - (skipFixtureFetch ? 1 : 0) - (skipXG ? 1 : 0);
  let currentStep = 0;

  // Step 1: Fetch fixtures (skip if requested)
  if (!skipFixtureFetch) {
    currentStep++;
    onProgress?.(`Step ${currentStep}/${totalSteps}: Fetching fixtures...`, currentStep, totalSteps);
    const fixtureFetcher = new FixtureFetcher();

    let fixtureResult;
    if (type === 'league') {
      const currentSeason = await fixtureFetcher.getCurrentSeasonForLeague(leagueId!);
      if (!currentSeason) {
        throw new Error(`No current season found for league ${leagueId}`);
      }
      const selectedSeasons: Record<string, string[]> = {
        [leagueId!.toString()]: [currentSeason.toString()]
      };
      fixtureResult = await fixtureFetcher.fetchAndUpdateFixtures(
        (info: string) => onProgress?.(`Fetched ${info}`, currentStep, totalSteps),
        selectedSeasons
      );
    } else {
      fixtureResult = await fixtureFetcher.fetchAndUpdateFixtures(
        (info: string) => onProgress?.(`Fetched ${info}`, currentStep, totalSteps)
      );
    }
    fixturesUpdated = fixtureResult.updatedCount || 0;
    statusChangedToPastCount = fixtureResult.statusChangedToPastCount || 0;
  }

  // Step 2: Calculate market XG for any fixtures that need it (IN_PAST or IN_PLAY with NULL market XG)
  currentStep++;
  onProgress?.(`Step ${currentStep}/${totalSteps}: Checking for market XG calculations...`, currentStep, totalSteps);

  let fixturesNeedingMarketXGQuery: string;
  let fixturesNeedingMarketXGResult: any;

  if (type === 'league') {
    fixturesNeedingMarketXGQuery = `
      SELECT f.id
      FROM football_fixtures f
      WHERE f.league_id = $1
        AND f.date > NOW() - INTERVAL '5 days'
        AND (LOWER(f.status_short) = ANY($2) OR LOWER(f.status_short) = ANY($3))
        AND (f.market_xg_home IS NULL OR f.market_xg_away IS NULL)
    `;
    fixturesNeedingMarketXGResult = await pool.query(fixturesNeedingMarketXGQuery, [leagueId, IN_PAST, IN_PLAY]);
  } else {
    fixturesNeedingMarketXGQuery = `
      SELECT f.id
      FROM football_fixtures f
      WHERE f.date > NOW() - INTERVAL '5 days'
        AND (LOWER(f.status_short) = ANY($1) OR LOWER(f.status_short) = ANY($2))
        AND (f.market_xg_home IS NULL OR f.market_xg_away IS NULL)
    `;
    fixturesNeedingMarketXGResult = await pool.query(fixturesNeedingMarketXGQuery, [IN_PAST, IN_PLAY]);
  }

  const marketXGCalculatedFixtureIds = fixturesNeedingMarketXGResult.rows.map((row: any) => row.id);

  if (marketXGCalculatedFixtureIds.length > 0) {
    console.log(`Found ${marketXGCalculatedFixtureIds.length} fixtures needing market XG: ${marketXGCalculatedFixtureIds.join(', ')}`);
    const { calculateMarketXG } = await import('@/calculators/market-xg.js');
    await calculateMarketXG(marketXGCalculatedFixtureIds);
    console.log(`Market XG calculation complete`);
  }

  // Step 3: Fetch xG data for completed matches (skip if requested)
  let xgUpdated = 0;
  let xgUpdatedFixtureIds: number[] = [];

  if (!skipXG) {
    currentStep++;
    onProgress?.(`Step ${currentStep}/${totalSteps}: Fetching xG data...`, currentStep, totalSteps);

    const xgFetcher = new XGFetcher();
    let xgResult;

    if (type === 'league') {
      xgResult = await xgFetcher.fetchXGDataForLeague(
        leagueId!,
        (msg: string) => onProgress?.(`xG: ${msg}`, 2, 4)
      );
    } else {
      xgResult = await xgFetcher.fetchXGDataForAllLeagues(
        (msg: string) => onProgress?.(`xG: ${msg}`, 2, 4)
      );
    }

    xgUpdated = xgResult.updatedCount || 0;
    xgUpdatedFixtureIds = xgResult.updatedFixtureIds || [];
  }

  // Step 4: Update statistics and predictions if we have meaningful changes or forced update
  // Trigger calculations if: market XG was calculated OR basic XG was updated OR forced update
  const hasMeaningfulChanges = marketXGCalculatedFixtureIds.length > 0 || xgUpdatedFixtureIds.length > 0 || forceStatsUpdate;

  if (hasMeaningfulChanges) {
    currentStep++;
    onProgress?.(`Step ${currentStep}/${totalSteps}: Updating statistics...`, currentStep, totalSteps);


    // Collect all fixture IDs that need statistics updates
    const allAffectedFixtureIds = [...marketXGCalculatedFixtureIds, ...xgUpdatedFixtureIds];

    // If doing forced update for a specific fixture, include that fixture's teams
    if (forceStatsUpdate && fixtureId) {
      allAffectedFixtureIds.push(fixtureId);
    }

    // Get teams from the affected fixtures
    let affectedTeams: number[] = [];
    if (allAffectedFixtureIds.length > 0) {
      const teamsFromAffectedQuery = `
        SELECT DISTINCT team_id
        FROM (
          SELECT home_team_id as team_id FROM football_fixtures WHERE id = ANY($1)
          UNION
          SELECT away_team_id as team_id FROM football_fixtures WHERE id = ANY($1)
        ) teams
      `;
      const teamsFromAffectedResult = await pool.query(teamsFromAffectedQuery, [allAffectedFixtureIds]);
      affectedTeams = teamsFromAffectedResult.rows.map((row: any) => row.team_id);
    }

    // Get future fixtures for affected teams (scoped to current league if type='league')
    if (affectedTeams.length > 0) {
      let futureFixturesQuery: string;
      let futureFixturesResult: any;

      if (type === 'league') {
        // Only update future fixtures in the current league
        futureFixturesQuery = `
          SELECT f.id
          FROM football_fixtures f
          WHERE f.league_id = $1
            AND LOWER(f.status_short) IN ('${IN_FUTURE.join("', '")}')
            AND (f.home_team_id = ANY($2::bigint[]) OR f.away_team_id = ANY($2::bigint[]))
          ORDER BY f.date ASC
        `;
        futureFixturesResult = await pool.query(futureFixturesQuery, [leagueId, affectedTeams]);
      } else {
        // Update all future fixtures for affected teams
        futureFixturesQuery = `
          SELECT f.id
          FROM football_fixtures f
          WHERE LOWER(f.status_short) IN ('${IN_FUTURE.join("', '")}')
            AND (f.home_team_id = ANY($1::bigint[]) OR f.away_team_id = ANY($1::bigint[]))
          ORDER BY f.date ASC
        `;
        futureFixturesResult = await pool.query(futureFixturesQuery, [affectedTeams]);
      }

      const futureFixtureIds = futureFixturesResult.rows.map((row: any) => row.id);

      if (futureFixtureIds.length > 0) {
        console.log(`Updating statistics for ${futureFixtureIds.length} future fixtures`);
        
        // Update statistics for affected future fixtures
        await pool.query('SELECT populate_hours_batch($1)', [futureFixtureIds]);
        await pool.query('SELECT populate_league_goals_batch($1)', [futureFixtureIds]);
        await pool.query('SELECT populate_home_advantage_batch($1)', [futureFixtureIds]);
        await pool.query('SELECT calculate_elos_incremental($1)', [futureFixtureIds]);
        await pool.query('SELECT populate_adjusted_rolling_xg_batch($1)', [futureFixtureIds]);
        await pool.query('SELECT populate_adjusted_rolling_market_xg_batch($1)', [futureFixtureIds]);

        // Step 5: Generate predictions and odds
        currentStep++;
        onProgress?.(`Step ${currentStep}/${totalSteps}: Generating predictions...`, currentStep, totalSteps);
        const { predictFixtures } = await import('@/lib/ml/ml-predict');
        await predictFixtures({ fixtureIds: futureFixtureIds });

        const { calculateOddsFromPredictions } = await import('@/calculators/prediction-odds.js');
        await calculateOddsFromPredictions(futureFixtureIds);
      } else {
        onProgress?.(`No future fixtures to update`, currentStep, totalSteps);
      }
    } else {
      onProgress?.(`No teams affected, skipping statistics update`, currentStep, totalSteps);
    }
  } else {
    onProgress?.(`Step ${currentStep}/${totalSteps}: No meaningful changes, skipping updates...`, currentStep, totalSteps);
  }

  return {
    success: true,
    message: `Chain completed: ${fixturesUpdated} fixtures fetched, ${xgUpdated} xG values updated`,
    fixturesUpdated,
    xgUpdated
  };
}
