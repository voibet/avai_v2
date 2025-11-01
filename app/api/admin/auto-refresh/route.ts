import pool from '@/lib/database/db';
import { executeChain } from '@/lib/services/chain-processor';
import { IN_PAST, IN_PLAY } from '@/lib/constants';

let isExecuting = false;

export function isAutoRefreshRunning() {
  return isExecuting;
}

export async function executeAutoRefresh() {
  // Prevent concurrent execution
  if (isExecuting) {
    console.log('Auto-refresh already running, skipping...');
    return {
      success: false,
      message: 'Auto-refresh already in progress',
      leaguesProcessed: 0
    };
  }

  isExecuting = true;
  try {
    return await runAutoRefreshInternal();
  } finally {
    isExecuting = false;
  }
}

async function runAutoRefreshInternal() {
  const query = `
    SELECT DISTINCT
      f.league_id,
      l.name as league_name,
      COUNT(f.id) as fixture_count,
      COUNT(CASE WHEN LOWER(f.status_short) IN ('${IN_PLAY.join("', '")}') THEN 1 END) as in_play_count,
      COUNT(CASE WHEN LOWER(f.status_short) IN ('${IN_PAST.join("', '")}') AND (f.xg_home IS NULL OR f.xg_away IS NULL) THEN 1 END) as past_missing_xg_count,
      COUNT(CASE WHEN LOWER(f.status_short) NOT IN ('${IN_PAST.join("', '")}', '${IN_PLAY.join("', '")}') AND f.date < NOW() THEN 1 END) as should_have_started_count
    FROM football_fixtures f
    JOIN football_leagues l ON f.league_id = l.id
    WHERE f.date < NOW() AND f.date > NOW() - INTERVAL '5 days'
    AND (
      LOWER(f.status_short) IN ('${IN_PLAY.join("', '")}')
      OR
      (LOWER(f.status_short) IN ('${IN_PAST.join("', '")}') AND (f.xg_home IS NULL OR f.xg_away IS NULL))
      OR
      (LOWER(f.status_short) NOT IN ('${IN_PAST.join("', '")}', '${IN_PLAY.join("', '")}') AND f.date < NOW())
    )
    GROUP BY f.league_id, l.name
    ORDER BY fixture_count DESC
  `;

  const result = await pool.query(query);
  const leaguesToProcess = result.rows;

  if (leaguesToProcess.length === 0) {
    console.log('No stale fixtures found');
    return {
      success: true,
      message: 'No stale fixtures found',
      leaguesProcessed: 0
    };
  }

  console.log(`Processing ${leaguesToProcess.length} league(s)...`);

  const results = [];

  for (const league of leaguesToProcess) {
    try {
      // Fetch fixtures if: IN_PLAY matches OR matches that should have started but status not updated
      const shouldFetchFixtures = league.in_play_count > 0 || league.should_have_started_count > 0;
      const skipFixtureFetch = !shouldFetchFixtures;

      console.log(`Processing ${league.league_name} (ID: ${league.league_id})...`);

      const leagueResult = await executeChain({
        type: 'league',
        leagueId: league.league_id,
        skipFixtureFetch
      });

      results.push({
        leagueId: league.league_id,
        leagueName: league.league_name,
        fixtureCount: league.fixture_count,
        skipFixtureFetch,
        ...leagueResult
      });

      // Add gap between league chains for better log readability
      console.log('');

      // Delay between leagues to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Error processing ${league.league_name}:`, error);
      results.push({
        leagueId: league.league_id,
        leagueName: league.league_name,
        fixtureCount: league.fixture_count,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Add gap between league chains even for errors
      console.log('');
    }
  }

  const successCount = results.filter(r => r.success).length;

  // Log completion of entire auto-refresh cycle
  const totalFixtures = results.reduce((sum, r) => sum + (('fixturesUpdated' in r ? r.fixturesUpdated : 0) || 0), 0);
  const totalXG = results.reduce((sum, r) => sum + (('xgUpdated' in r ? r.xgUpdated : 0) || 0), 0);

  console.log('='.repeat(60));
  console.log(`✓ Processed ${successCount}/${leaguesToProcess.length} leagues`);
  console.log(`✓ Total: ${totalFixtures} fixtures updated`);
  console.log('='.repeat(60) + '\n');

  return {
    success: true,
    message: `Processed ${successCount}/${leaguesToProcess.length} league(s)`,
    leaguesProcessed: successCount,
    results
  };
}

export async function POST(request: Request) {
  try {
    const result = await executeAutoRefresh();
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : 'An error occurred'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
