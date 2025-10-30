import pool from '@/lib/database/db';
import { executeChain } from '@/lib/services/chain-processor';
import { IN_PAST, IN_PLAY, IN_FUTURE } from '@/lib/constants';

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
      COUNT(f.id) as fixture_count
    FROM football_fixtures f
    JOIN football_leagues l ON f.league_id = l.id
    WHERE f.date < NOW() AND f.date > NOW() - INTERVAL '5 days'
    AND (
      LOWER(f.status_short) IN ('${[...IN_PLAY, ...IN_FUTURE].join("', '")}')
      OR
      (LOWER(f.status_short) IN ('${IN_PAST.join("', '")}') AND (f.xg_home IS NULL OR f.xg_away IS NULL))
    )
    GROUP BY f.league_id, l.name
    ORDER BY fixture_count DESC
  `;

  const result = await pool.query(query);
  const leaguesToProcess = result.rows;

  if (leaguesToProcess.length === 0) {
    return {
      success: true,
      message: 'No stale fixtures found',
      leaguesProcessed: 0
    };
  }

  console.log(`Auto-refresh: Processing ${leaguesToProcess.length} league(s)`);

  const results = [];

  for (const league of leaguesToProcess) {
    try {
      console.log(`Processing ${league.league_name} (ID: ${league.league_id})...`);
      
      const leagueResult = await executeChain({
        type: 'league',
        leagueId: league.league_id
      });
      
      results.push({
        leagueId: league.league_id,
        leagueName: league.league_name,
        fixtureCount: league.fixture_count,
        ...leagueResult
      });

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
    }
  }

  const successCount = results.filter(r => r.success).length;

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
