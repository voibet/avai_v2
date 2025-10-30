import pool from '@/lib/database/db';
import { FixtureFetcher } from './fixture-fetcher';
import { XGFetcher } from './xg-fetcher';
import { IN_PAST } from '../constants';

interface ChainOptions {
  type: 'league' | 'all';
  leagueId?: number;
  onProgress?: (message: string, current: number, total: number) => void;
}

interface ChainResult {
  success: boolean;
  message: string;
  fixturesUpdated: number;
  xgUpdated: number;
}

export async function executeChain(options: ChainOptions): Promise<ChainResult> {
  const { type, leagueId, onProgress } = options;
  
  let fixturesUpdated = 0;
  let xgUpdated = 0;
  const allUpdatedFixtureIds: number[] = [];

  const leagueName = leagueId ? `League ${leagueId}` : 'All leagues';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Chain: ${leagueName}`);
  console.log('='.repeat(60));

  // Step 1: Fetch fixtures
  console.log('[1/5] Fetching fixtures...');
  onProgress?.('Step 1/5: Fetching fixtures...', 1, 5);
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
      (league: string) => onProgress?.(`Fetching fixtures: ${league}`, 1, 5),
      selectedSeasons
    );
  } else {
    fixtureResult = await fixtureFetcher.fetchAndUpdateFixtures(
      (league: string) => onProgress?.(`Fetching fixtures: ${league}`, 1, 5)
    );
  }
  fixturesUpdated = fixtureResult.updatedCount || 0;

  // Step 2: Fetch xG data
  console.log('[2/5] Fetching xG data...');
  onProgress?.('Step 2/5: Fetching xG data...', 2, 5);

  // Get all fixtures and leagues that will be processed for XG
  let xgCheckQuery = `
    SELECT DISTINCT f.id as fixture_id, f.league_id, l.name as league_name
    FROM football_fixtures f
    JOIN football_leagues l ON f.league_id = l.id
    WHERE f.date < NOW() AND f.date > NOW() - INTERVAL '5 days'
      AND LOWER(f.status_short) IN ('${IN_PAST.join("', '")}')
      AND (f.xg_home IS NULL OR f.xg_away IS NULL)
      AND f.goals_home IS NOT NULL
      AND f.goals_away IS NOT NULL
      AND l.xg_source IS NOT NULL
  `;

  const xgCheckParams: any[] = [];
  if (type === 'league' && leagueId) {
    xgCheckQuery += ' AND f.league_id = $1';
    xgCheckParams.push(leagueId);
  }

  const xgCheckResult = await pool.query(xgCheckQuery, xgCheckParams);
  const fixturesAndLeagues = xgCheckResult.rows;

  // Extract fixture IDs and league info
  const fixturesToProcessIds = fixturesAndLeagues.map(row => row.fixture_id);
  const leaguesNeedingXG = Array.from(new Map(
    fixturesAndLeagues.map(row => [row.league_id, { league_id: row.league_id, league_name: row.league_name }])
  ).values());

  // Add all fixtures that will be processed to the updated list
  allUpdatedFixtureIds.push(...fixturesToProcessIds);

  if (leaguesNeedingXG.length > 0) {
    const xgFetcher = new XGFetcher();

    for (const league of leaguesNeedingXG) {
      onProgress?.(`Fetching xG: ${league.league_name}`, 2, 5);

      try {
        const xgResult = await xgFetcher.fetchXGDataForLeague(
          league.league_id,
          (msg: string) => onProgress?.(`xG: ${league.league_name} - ${msg}`, 2, 5)
        );

        if (xgResult.updatedCount) {
          xgUpdated += xgResult.updatedCount;
        }
      } catch (error) {
        console.error(`Error fetching xG for league ${league.league_name}:`, error);
      }
    }
  }

  // Step 3: Run calculations if we have updated fixtures
  if (allUpdatedFixtureIds.length > 0) {
    console.log(`[3/5] Running calculations (${allUpdatedFixtureIds.length} fixtures with xG)...`);
    onProgress?.('Step 3/5: Calculating market xG...', 3, 5);
    
    // Get teams and future fixtures
    const teamsQuery = `
      SELECT DISTINCT team_id
      FROM (
        SELECT home_team_id as team_id FROM football_fixtures WHERE id = ANY($1::bigint[])
        UNION
        SELECT away_team_id as team_id FROM football_fixtures WHERE id = ANY($1::bigint[])
      ) teams
    `;
    const teamsResult = await pool.query(teamsQuery, [allUpdatedFixtureIds]);
    const teamIds = teamsResult.rows.map((row: any) => row.team_id);

    const futureFixturesQuery = `
      SELECT f.id
      FROM football_fixtures f
      WHERE f.status_short = 'NS'
        AND (f.home_team_id = ANY($1::bigint[]) OR f.away_team_id = ANY($1::bigint[]))
      ORDER BY f.date ASC
    `;
    const futureFixturesResult = await pool.query(futureFixturesQuery, [teamIds]);
    const futureFixtureIds = futureFixturesResult.rows.map((row: any) => row.id);

    // Calculate market XG
    const { calculateMarketXG } = await import('@/calculators/market-xg.js');
    await calculateMarketXG(allUpdatedFixtureIds);

    if (futureFixtureIds.length > 0) {
      // Step 4: Calculate statistics
      console.log(`[4/5] Calculating statistics (${futureFixtureIds.length} future fixtures)...`);
      onProgress?.('Step 4/5: Calculating statistics...', 4, 5);
      await pool.query('SELECT populate_hours_batch($1)', [futureFixtureIds]);
      await pool.query('SELECT populate_league_goals_batch($1)', [futureFixtureIds]);
      await pool.query('SELECT populate_home_advantage_batch($1)', [futureFixtureIds]);
      await pool.query('SELECT calculate_elos_incremental($1)', [futureFixtureIds]);
      await pool.query('SELECT populate_adjusted_rolling_xg_batch($1)', [futureFixtureIds]);
      await pool.query('SELECT populate_adjusted_rolling_market_xg_batch($1)', [futureFixtureIds]);

      // Step 5: Generate predictions and odds
      console.log('[5/5] Generating predictions and odds...');
      onProgress?.('Step 5/5: Generating predictions...', 5, 5);
      const { predictFixtures } = await import('@/lib/ml/ml-predict');
      await predictFixtures({ fixtureIds: futureFixtureIds });

      const { calculateOddsFromPredictions } = await import('@/calculators/prediction-odds.js');
      await calculateOddsFromPredictions(futureFixtureIds);
    } else {
      console.log('[4/5] No future fixtures to update');
    }
  } else {
    console.log('[3/5] No xG updates, skipping calculations');
    onProgress?.('Step 3/5: No xG updates, skipping calculations...', 3, 5);
  }

  console.log('='.repeat(60));
  console.log(`✓ Chain complete: ${fixturesUpdated} fixtures, ${xgUpdated} xG updated`);
  console.log('='.repeat(60) + '\n');

  return {
    success: true,
    message: `Chain completed: ${fixturesUpdated} fixtures fetched, ${xgUpdated} xG values updated`,
    fixturesUpdated,
    xgUpdated
  };
}
