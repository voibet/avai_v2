import pool from '../../../../lib/database/db';
import type { PoolClient } from 'pg';
export const dynamic = 'force-dynamic';

async function getLatestFixtureUpdates(client: PoolClient, updatedFixtureId?: number) {
  let params: any[] = [];
  let whereConditions = [];

  // Always include date filter
  whereConditions.push('f.date >= CURRENT_DATE');

  if (updatedFixtureId) {
    // When fetching a specific fixture, include it even if finished
    whereConditions.push(`(LOWER(f.status_short) NOT IN ('ft', 'aet', 'pen') OR f.id = $${params.length + 1})`);
    params.push(updatedFixtureId);
  } else {
    // When fetching all fixtures, exclude finished ones
    whereConditions.push(`LOWER(f.status_short) NOT IN ('ft', 'aet', 'pen')`);
  }

  const query = `
    SELECT
      f.id, f.referee, f.timestamp, f.date, f.venue_name, f.status_long, f.status_short,
      f.home_team_id, f.home_team_name, f.home_country,
      f.away_team_id, f.away_team_name, f.away_country,
      f.xg_home, f.xg_away, f.market_xg_home, f.market_xg_away, f.goals_home, f.goals_away,
      f.score_halftime_home, f.score_halftime_away,
      f.score_fulltime_home, f.score_fulltime_away,
      f.score_extratime_home, f.score_extratime_away,
      f.score_penalty_home, f.score_penalty_away,
      f.league_id, f.league_name, f.league_country, f.season, f.round,
      EXTRACT(epoch FROM f.updated_at)::integer as updated_at,
      p.home_pred, p.away_pred
    FROM football_fixtures f
    LEFT JOIN football_predictions p ON f.id = p.fixture_id
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY f.updated_at DESC, f.id
  `;

  const result = await client.query(query, params);
  return result.rows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdParam = searchParams.get('fixtureId');

  // Parse fixture IDs - support both single ID and comma-separated IDs
  let fixtureIds: number[];
  if (fixtureIdParam) {
    if (fixtureIdParam.includes(',')) {
      // Multiple IDs separated by comma
      fixtureIds = fixtureIdParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    } else {
      // Single ID
      const fixtureId = parseInt(fixtureIdParam);
      fixtureIds = !isNaN(fixtureId) ? [fixtureId] : [];
    }
  } else {
    // Default: stream all upcoming fixtures
    fixtureIds = [];
  }

  if (fixtureIdParam && fixtureIds.length === 0) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Invalid fixture ID(s)' })}\n\n`));
        controller.close();
      }
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const encoder = new TextEncoder();
  let client: PoolClient | null = null;
  let keepAliveInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Get a dedicated client from the pool for this connection
        client = await pool.connect();

        // Get fixture IDs to listen to their channels
        let finalFixtureIds: number[];
        if (fixtureIds.length > 0) {
          // Use specified fixture IDs
          finalFixtureIds = fixtureIds;
        } else {
          // Get all current non-finished fixture IDs (not in past) to listen to their channels
          const fixturesResult = await client.query(`
            SELECT id FROM football_fixtures
            WHERE LOWER(status_short) NOT IN ('ft', 'aet', 'pen') AND date >= CURRENT_DATE
          `, []);
          finalFixtureIds = fixturesResult.rows.map(row => row.id);
        }

        // Listen to all fixture-specific channels
        for (const fixtureId of finalFixtureIds) {
          await client.query(`LISTEN fixture_update_${fixtureId}`);
        }

        // Send initial "started" message
        const startedData = JSON.stringify({
          type: 'started',
          timestamp: Date.now(),
          message: 'Fixtures stream started successfully'
        });
        controller.enqueue(encoder.encode(`data: ${startedData}\n\n`));

        // Set up notification handler for all channels
        client.on('notification', async (msg) => {
          // Check if it's a fixture_update channel
          if (msg.channel.startsWith('fixture_update_')) {
            try {
              // Extract fixture ID from channel name
              const fixtureId = parseInt(msg.channel.replace('fixture_update_', ''));

              if (fixtureId && !isNaN(fixtureId)) {
                // Fetch updated fixture data for this specific fixture
                const updates = await getLatestFixtureUpdates(client!, fixtureId);

                if (updates.length > 0) {
                  const fixture = updates[0];

                  // Send fixture update
                  const data = JSON.stringify({
                    type: 'fixture_update',
                    timestamp: Date.now(),
                    fixture_id: fixture.id,
                    fixture: fixture
                  });
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                }
              }
            } catch (error) {
              console.error('Error fetching updated fixture:', error);
            }
          }
        });

        // Send keep-alive ping every 30 seconds to prevent timeout
        keepAliveInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch (error) {
            // Connection closed, clear interval
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
            }
          }
        }, 30000);

      } catch (error) {
        console.error('Error setting up SSE connection:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Failed to setup stream' })}\n\n`));
        controller.close();
      }
    },
    cancel() {
      // Clean up when client disconnects
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      if (client) {
        client.removeAllListeners('notification');
        client.release();
        client = null;
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
