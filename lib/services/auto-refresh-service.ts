import pool from '@/lib/database/db';
import { executeChain } from '@/lib/services/chain-processor';
import { IN_PAST, IN_PLAY, IN_FUTURE, CANCELLED } from '@/lib/constants';
import { initializeSchedulers } from '@/lib/scheduler/init-scheduler';

let isExecuting = false;
let executionStartTime: number | null = null;
const MAX_EXECUTION_TIME = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * Helper for consistent logging with timestamp and service prefix
 */
function log(message: string): void {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
  console.log(`${time} AutoRefresh: ${message}`);
}

function isAutoRefreshRunning() {
  // Check if we're currently executing AND haven't exceeded max time
  if (isExecuting && executionStartTime) {
    const elapsed = Date.now() - executionStartTime;
    if (elapsed > MAX_EXECUTION_TIME) {
      log(`Execution timeout detected (${Math.round(elapsed / 1000)}s), resetting flag`);
      isExecuting = false;
      executionStartTime = null;
    }
  }
  return isExecuting;
}

export async function executeAutoRefresh() {
  // Initialize scheduler on first execution
  initializeSchedulers();

  // Prevent concurrent execution
  if (isAutoRefreshRunning()) {
    log('Service already running, skipping...');
    return {
      success: false,
      message: 'Auto-refresh already in progress',
      leaguesProcessed: 0
    };
  }

  isExecuting = true;
  executionStartTime = Date.now();
  try {
    return await runAutoRefreshInternal();
  } finally {
    isExecuting = false;
    executionStartTime = null;
  }
}

async function runAutoRefreshInternal() {
  const query = `
    SELECT DISTINCT
      f.league_id,
      l.name as league_name,
      COUNT(f.id) as fixture_count,
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($1) THEN 1 END) as in_play_count,
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($2) AND (f.xg_home IS NULL OR f.xg_away IS NULL) THEN 1 END) as past_missing_xg_count,
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($3) AND f.date < NOW() THEN 1 END) as should_have_started_count
    FROM football_fixtures f
    JOIN football_leagues l ON f.league_id = l.id
    WHERE f.date < NOW() AND f.date > NOW() - INTERVAL '5 days'
    AND LOWER(f.status_short) != ALL($4)
    AND (
      LOWER(f.status_short) = ANY($1)
      OR
      (LOWER(f.status_short) = ANY($2) AND (f.xg_home IS NULL OR f.xg_away IS NULL))
      OR
      (LOWER(f.status_short) = ANY($3) AND f.date < NOW())
    )
    GROUP BY f.league_id, l.name
    HAVING
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($1) THEN 1 END) > 0
      OR
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($2) AND (f.xg_home IS NULL OR f.xg_away IS NULL) THEN 1 END) > 0
      OR
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($3) AND f.date < NOW() THEN 1 END) > 0
    ORDER BY
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($1) THEN 1 END) DESC,
      COUNT(CASE WHEN LOWER(f.status_short) = ANY($3) AND f.date < NOW() THEN 1 END) DESC
  `;

  const client = await pool.connect();
  try {
    const result = await client.query(query, [IN_PLAY, IN_PAST, IN_FUTURE, CANCELLED]);
    const leaguesToProcess = result.rows;

    log(`Found ${leaguesToProcess.length} leagues needing refresh`);
    let leaguesProcessed = 0;

    for (const league of leaguesToProcess) {
      // Add spacing between leagues
      if (leaguesProcessed > 0) {
        console.log('');
      }

      log(`Processing league: ${league.league_name} (ID: ${league.league_id})`);
      log(`  - In play: ${league.in_play_count || 0}, Missing xG: ${league.past_missing_xg_count || 0}, Should have started: ${league.should_have_started_count || 0}`);

      await executeChain({
        type: 'league',
        leagueId: league.league_id
      });

      leaguesProcessed++;
      log(`✓ Successfully processed league: ${league.league_name}`);

      // Small delay between leagues
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Log completion of entire auto-refresh cycle
    log(`✅ Auto-refresh cycle completed. Processed ${leaguesProcessed} leagues total`);

    return {
      success: true,
      message: `Auto-refresh completed. Processed ${leaguesProcessed} leagues`,
      leaguesProcessed
    };
  } finally {
    client.release();
  }
}
