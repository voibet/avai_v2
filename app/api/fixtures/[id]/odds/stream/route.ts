import pool from '../../../../../../lib/database/db';
import type { PoolClient } from 'pg';


export const dynamic = 'force-dynamic';

async function getOddsData(client: PoolClient, fixtureId: number) {
  // Optimized single query with LEFT JOINs for better performance
  const result = await client.query(`
    SELECT
      fo.*,
      fp.payout_x12,
      fp.payout_ah,
      fp.payout_ou
    FROM football_odds fo
    LEFT JOIN football_payouts fp ON fo.fixture_id = fp.fixture_id AND fo.bookie = fp.bookie
    WHERE fo.fixture_id = $1
    ORDER BY fo.bookie
  `, [fixtureId]);

  let odds = result.rows;

  // Add fair odds from Pinnacle as a special bookmaker entry
  const fairOddsResult = await client.query(
    'SELECT * FROM football_fair_odds WHERE fixture_id = $1 AND LOWER(bookie) = $2',
    [fixtureId, 'pinnacle']
  );

  if (fairOddsResult.rows.length > 0) {
    const fairOdds = fairOddsResult.rows[0];

    const fairOddsEntry = {
      fixture_id: fixtureId,
      bookie: 'PINNACLE_FAIR_ODDS',
      decimals: fairOdds.decimals,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      fair_odds_x12: fairOdds.fair_odds_x12,
      fair_odds_ah: fairOdds.fair_odds_ah,
      fair_odds_ou: fairOdds.fair_odds_ou,
      latest_lines: fairOdds.latest_lines
    };

    odds.push(fairOddsEntry);
  }

  return { odds };
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return new Response('Invalid fixture ID', { status: 400 });
  }

  const encoder = new TextEncoder();
  let client: PoolClient | null = null;
  let keepAliveInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Get a dedicated client from the pool for this connection
        client = await pool.connect();
        
        // Set up LISTEN for this specific fixture
        const channelName = `odds_update_${fixtureId}`;
        await client.query(`LISTEN ${channelName}`);

        // Send initial data immediately
        const oddsData = await getOddsData(client, fixtureId);
        const data = JSON.stringify(oddsData);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));

        // Set up notification handler
        client.on('notification', async (msg) => {
          if (msg.channel === channelName) {
            try {
              // Fetch and send updated odds data
              const updatedOddsData = await getOddsData(client!, fixtureId);
              const data = JSON.stringify(updatedOddsData);
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            } catch (error) {
              console.error('Error fetching updated odds:', error);
              // Send error notification instead of crashing
              const errorData = JSON.stringify({
                error: 'Failed to fetch updated odds',
                details: error instanceof Error ? error.message : String(error)
              });
              controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Failed to fetch odds' })}\n\n`));
        controller.close();
      }
    },
    cancel() {
      // Clean up when client disconnects
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
      if (client) {
        client.removeAllListeners('notification');
        client.release();
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
