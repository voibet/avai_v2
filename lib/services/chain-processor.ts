import pool from '@/lib/database/db';
import { FixtureFetcher } from './fixture-fetcher';
import { XGFetcher } from './xg-fetcher';
import { IN_PAST, IN_PLAY, IN_FUTURE } from '../constants';

/**
 * Helper for consistent logging with timestamp and service prefix
 */
function log(message: string): void {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
  console.log(`${time} Chain: ${message}`);
}

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

  let result: ChainResult;

  if (type === 'league') {
    result = await executeLeagueChain(leagueId!, { onProgress, skipFixtureFetch, skipXG, forceStatsUpdate, fixtureId });
  } else {
    result = await executeAllLeaguesChain({ onProgress, skipFixtureFetch, skipXG, forceStatsUpdate, fixtureId });
  }

  return result;
}

async function executeLeagueChain(
  leagueId: number,
  options: { onProgress?: ChainOptions['onProgress'], skipFixtureFetch?: boolean, skipXG?: boolean, forceStatsUpdate?: boolean, fixtureId?: number }
): Promise<ChainResult> {
  const { onProgress, skipFixtureFetch = false, skipXG = false, forceStatsUpdate = false, fixtureId } = options;

  let fixturesUpdated = 0;
  let fixturesUpdatedIds: number[] = [];

  // Step 1/5: Fetch fixtures for specific league
  if (!skipFixtureFetch) {
    onProgress?.('1/5: Fetching fixtures', 1, 5);

    const fixtureFetcher = new FixtureFetcher();
    const currentSeason = await fixtureFetcher.getCurrentSeasonForLeague(leagueId);
    if (!currentSeason) {
      throw new Error(`No current season found for league ${leagueId}`);
    }

    const leagueSeasons = [{ id: leagueId, name: '', season: currentSeason }];
    const fixtureResult = await fixtureFetcher.fetchAndUpdateFixtures(
      leagueSeasons,
      (info: string) => onProgress?.(`1/5: Fetching fixtures - ${info}`, 1, 5)
    );

    fixturesUpdated = fixtureResult.updatedCount || 0;
    fixturesUpdatedIds = fixtureResult.updatedFixtureIds || [];
  }

  // Step 2/5: Calculate market XG
  onProgress?.('2/5: Calculating market XG', 2, 5);
  const marketXGCalculatedFixtureIds = await getFixturesNeedingMarketXG(leagueId);

  if (marketXGCalculatedFixtureIds.length > 0) {
    log(`Found ${marketXGCalculatedFixtureIds.length} fixtures needing market XG`);
    const { calculateMarketXG } = await import('@/lib/calculations/market-xg');
    await calculateMarketXG(marketXGCalculatedFixtureIds);
    log('Market XG calculation complete');
  }

  // Step 3/5: Fetch xG data
  let xgUpdated = 0;
  let xgUpdatedFixtureIds: number[] = [];

  if (!skipXG) {
    onProgress?.('3/5: Fetching xG data', 3, 5);

    const xgFetcher = new XGFetcher();
    const xgResult = await xgFetcher.fetchXGDataForLeague(
      leagueId,
      (msg: string) => onProgress?.(`3/5: Fetching xG data - ${msg}`, 3, 5)
    );

    xgUpdated = xgResult.updatedCount || 0;
    xgUpdatedFixtureIds = xgResult.updatedFixtureIds || [];
  }

  // Step 4/5: Update statistics if needed
  const hasMeaningfulChanges = marketXGCalculatedFixtureIds.length > 0 || xgUpdatedFixtureIds.length > 0 || fixturesUpdated > 0 || forceStatsUpdate;

  if (hasMeaningfulChanges) {
    onProgress?.('4/5: Updating statistics', 4, 5);

    // Collect all fixture IDs that need statistics updates
    const allAffectedFixtureIds = [...marketXGCalculatedFixtureIds, ...xgUpdatedFixtureIds, ...fixturesUpdatedIds];

    if (forceStatsUpdate && fixtureId) {
      allAffectedFixtureIds.push(fixtureId);
    }

    const affectedTeams = await getAffectedTeams(allAffectedFixtureIds);
    const futureFixtureIds = await getFutureFixturesForTeams(affectedTeams);

    if (futureFixtureIds.length > 0) {
      log(`Updating statistics for ${futureFixtureIds.length} future fixtures`);
      await updateStatisticsForFixtures(futureFixtureIds);

      // Step 5/5: Generate predictions and odds
      onProgress?.('5/5: Running MLP predictions', 5, 5);
      await generatePredictionsAndOdds(futureFixtureIds, onProgress);
    } else {
      onProgress?.('4/5: No future fixtures to update', 4, 5);
    }
  } else {
    onProgress?.('4/5: No meaningful changes, skipping updates', 4, 5);
  }

  return {
    success: true,
    message: `Chain completed: ${fixturesUpdated} fixtures fetched, ${xgUpdated} xG values updated`,
    fixturesUpdated,
    xgUpdated
  };
}

async function executeAllLeaguesChain(
  options: { onProgress?: ChainOptions['onProgress'], skipFixtureFetch?: boolean, skipXG?: boolean, forceStatsUpdate?: boolean, fixtureId?: number }
): Promise<ChainResult> {
  const { onProgress, skipFixtureFetch = false, skipXG = false, forceStatsUpdate = false, fixtureId } = options;

  let fixturesUpdated = 0;
  let fixturesUpdatedIds: number[] = [];

  // Step 1/5: Fetch fixtures for all leagues
  if (!skipFixtureFetch) {
    onProgress?.('1/5: Fetching fixtures', 1, 5);

    const fixtureFetcher = new FixtureFetcher();
    const fixtureResult = await fixtureFetcher.fetchAndUpdateFixturesForCurrentSeasons(
      (info: string) => onProgress?.(`1/5: Fetching fixtures - ${info}`, 1, 5)
    );

    fixturesUpdated = fixtureResult.updatedCount || 0;
    fixturesUpdatedIds = fixtureResult.updatedFixtureIds || [];
  }

  // Step 2/5: Calculate market XG
  onProgress?.('2/5: Calculating market XG', 2, 5);
  const marketXGCalculatedFixtureIds = await getFixturesNeedingMarketXG();

  if (marketXGCalculatedFixtureIds.length > 0) {
    log(`Found ${marketXGCalculatedFixtureIds.length} fixtures needing market XG`);
    const { calculateMarketXG } = await import('@/lib/calculations/market-xg');
    await calculateMarketXG(marketXGCalculatedFixtureIds);
    log('Market XG calculation complete');
  }

  // Step 3/5: Fetch xG data
  let xgUpdated = 0;
  let xgUpdatedFixtureIds: number[] = [];

  if (!skipXG) {
    onProgress?.('3/5: Fetching xG data', 3, 5);

    const xgFetcher = new XGFetcher();
    const xgResult = await xgFetcher.fetchXGDataForAllLeagues(
      (msg: string) => onProgress?.(`3/5: Fetching xG data - ${msg}`, 3, 5)
    );

    xgUpdated = xgResult.updatedCount || 0;
    xgUpdatedFixtureIds = xgResult.updatedFixtureIds || [];
  }

  // Step 4/5: Update statistics if needed
  const hasMeaningfulChanges = marketXGCalculatedFixtureIds.length > 0 || xgUpdatedFixtureIds.length > 0 || fixturesUpdated > 0 || forceStatsUpdate;

  if (hasMeaningfulChanges) {
    onProgress?.('4/5: Updating statistics', 4, 5);

    const allAffectedFixtureIds = [...marketXGCalculatedFixtureIds, ...xgUpdatedFixtureIds, ...fixturesUpdatedIds];

    if (forceStatsUpdate && fixtureId) {
      allAffectedFixtureIds.push(fixtureId);
    }

    const affectedTeams = await getAffectedTeams(allAffectedFixtureIds);
    const futureFixtureIds = await getFutureFixturesForTeams(affectedTeams);

    if (futureFixtureIds.length > 0) {
      log(`Updating statistics for ${futureFixtureIds.length} future fixtures`);
      await updateStatisticsForFixtures(futureFixtureIds);

      // Step 5/5: Generate predictions and odds
      onProgress?.('5/5: Running MLP predictions', 5, 5);
      await generatePredictionsAndOdds(futureFixtureIds, onProgress);
    } else {
      onProgress?.('4/5: No future fixtures to update', 4, 5);
    }
  } else {
    onProgress?.('4/5: No meaningful changes, skipping updates', 4, 5);
  }

  return {
    success: true,
    message: `Chain completed: ${fixturesUpdated} fixtures fetched, ${xgUpdated} xG values updated`,
    fixturesUpdated,
    xgUpdated
  };
}

async function getFixturesNeedingMarketXG(leagueId?: number): Promise<number[]> {
  const query = leagueId
    ? `SELECT f.id FROM football_fixtures f WHERE f.league_id = $1 AND f.date > NOW() - INTERVAL '5 days' AND (LOWER(f.status_short) = ANY($2) OR LOWER(f.status_short) = ANY($3)) AND (f.market_xg_home IS NULL OR f.market_xg_away IS NULL)`
    : `SELECT f.id FROM football_fixtures f WHERE f.date > NOW() - INTERVAL '5 days' AND (LOWER(f.status_short) = ANY($1) OR LOWER(f.status_short) = ANY($2)) AND (f.market_xg_home IS NULL OR f.market_xg_away IS NULL)`;

  const params = leagueId ? [leagueId, IN_PAST, IN_PLAY] : [IN_PAST, IN_PLAY];
  const result = await pool.query(query, params);
  return result.rows.map((row: any) => row.id);
}

async function getAffectedTeams(fixtureIds: number[]): Promise<number[]> {
  if (fixtureIds.length === 0) return [];

  const query = `
    SELECT DISTINCT team_id
    FROM (
      SELECT home_team_id as team_id FROM football_fixtures WHERE id = ANY($1)
      UNION
      SELECT away_team_id as team_id FROM football_fixtures WHERE id = ANY($1)
    ) teams
  `;
  const result = await pool.query(query, [fixtureIds]);
  return result.rows.map((row: any) => row.team_id);
}

async function getFutureFixturesForTeams(teamIds: number[]): Promise<number[]> {
  if (teamIds.length === 0) return [];

  const query = `
    SELECT f.id
    FROM football_fixtures f
    WHERE LOWER(f.status_short) IN ('${IN_FUTURE.join("', '")}')
      AND (f.home_team_id = ANY($1::bigint[]) OR f.away_team_id = ANY($1::bigint[]))
    ORDER BY f.date ASC
  `;
  const result = await pool.query(query, [teamIds]);
  return result.rows.map((row: any) => row.id);
}

async function updateStatisticsForFixtures(fixtureIds: number[]): Promise<void> {
  await pool.query('SELECT populate_hours_batch($1)', [fixtureIds]);
  await pool.query('SELECT populate_league_goals_batch($1)', [fixtureIds]);
  await pool.query('SELECT populate_home_advantage_batch($1)', [fixtureIds]);
  await pool.query('SELECT calculate_elos_incremental($1)', [fixtureIds]);
  await pool.query('SELECT populate_adjusted_rolling_xg_batch($1)', [fixtureIds]);
  await pool.query('SELECT populate_adjusted_rolling_market_xg_batch($1)', [fixtureIds]);
}

async function generatePredictionsAndOdds(fixtureIds: number[], onProgress?: ChainOptions['onProgress']): Promise<void> {
  const { predictFixtures } = await import('@/lib/ml/ml-predict');
  await predictFixtures({ fixtureIds });

  const { calculateOddsFromPredictions } = await import('@/lib/calculations/prediction-odds');
  await calculateOddsFromPredictions(fixtureIds);
}