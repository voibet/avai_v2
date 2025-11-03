import pool from '@/lib/database/db';
import { executeChain } from '@/lib/services/chain-processor';
import { IN_PAST, IN_PLAY } from '@/lib/constants';
import { initializeSchedulers } from '@/lib/scheduler/init-scheduler';

let isExecuting = false;

export function isAutoRefreshRunning() {
  return isExecuting;
}

export async function executeAutoRefresh() {
  // Initialize scheduler on first execution
  initializeSchedulers();

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
    HAVING
      COUNT(CASE WHEN LOWER(f.status_short) IN ('${IN_PLAY.join("', '")}') THEN 1 END) > 0
      OR
      COUNT(CASE WHEN LOWER(f.status_short) IN ('${IN_PAST.join("', '")}') AND (f.xg_home IS NULL OR f.xg_away IS NULL) THEN 1 END) > 0
      OR
      COUNT(CASE WHEN LOWER(f.status_short) NOT IN ('${IN_PAST.join("', '")}', '${IN_PLAY.join("', '")}') AND f.date < NOW() THEN 1 END) > 0
    ORDER BY
      COUNT(CASE WHEN LOWER(f.status_short) IN ('${IN_PLAY.join("', '")}') THEN 1 END) DESC,
      COUNT(CASE WHEN LOWER(f.status_short) NOT IN ('${IN_PAST.join("', '")}', '${IN_PLAY.join("', '")}') AND f.date < NOW() THEN 1 END) DESC
  `;

  const client = await pool.connect();
  try {
    const result = await client.query(query);
    const leaguesToProcess = result.rows;

    console.log(`Found ${leaguesToProcess.length} leagues needing refresh`);
    let leaguesProcessed = 0;

    for (const league of leaguesToProcess) {
      try {
        console.log(`Processing league: ${league.league_name} (ID: ${league.league_id})`);

        await executeChain({
          type: 'league',
          leagueId: league.league_id
        });

        leaguesProcessed++;
        console.log(`✓ Successfully processed league: ${league.league_name}`);
        console.log('');

        // Add a small delay between leagues to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Failed to process league ${league.league_name}:`, error);
        // Continue with other leagues even if one fails
      }
    }

    return {
      success: true,
      message: `Auto-refresh completed. Processed ${leaguesProcessed} out of ${leaguesToProcess.length} leagues`,
      leaguesProcessed
    };

  } catch (error) {
    console.error('Auto-refresh error:', error);
    return {
      success: false,
      message: `Auto-refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      leaguesProcessed: 0
    };
  } finally {
    client.release();
  }
}
