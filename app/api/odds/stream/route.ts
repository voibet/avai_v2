import pool from '../../../../lib/database/db';
import type { PoolClient } from 'pg';
import { IN_FUTURE } from '../../../../lib/constants';

export const dynamic = 'force-dynamic';

async function getLatestOddsUpdates(client: PoolClient, updatedFixtureId?: number, bookieFilter?: string, bookieParams?: any[], useFairOdds?: boolean) {
  let fixtureFilter = '';
  let params: any[] = [IN_FUTURE]; // Add status array first

  if (updatedFixtureId) {
    fixtureFilter = `AND fo.fixture_id = $${params.length + 1}`;
    params.push(updatedFixtureId);
  }

  // Add bookie filter if provided
  let fullBookieFilter = '';
  if (bookieFilter) {
    fullBookieFilter = bookieFilter.replace(/\$(\d+)/g, (match, num) => `$${parseInt(num) + params.length}`);
    params.push(...(bookieParams || []));
  }

  let query;
  if (useFairOdds) {
    // When fair_odds=true, join both tables and return both regular and fair odds
    query = `
      SELECT
        COALESCE(fo.fixture_id, ffo.fixture_id) as fixture_id,
        ff.home_team_name,
        ff.away_team_name,
        ff.date,
        ff.league_name,
        COALESCE(fo.bookie, ffo.bookie) as bookie,
        COALESCE(fo.decimals, ffo.decimals) as decimals,
        COALESCE(fo.updated_at, ffo.updated_at) as updated_at,
        -- Regular odds from football_odds table
        fo.odds_x12->-1 as odds_x12,
        fo.odds_ah->-1 as odds_ah,
        fo.odds_ou->-1 as odds_ou,
        fo.lines->-1 as lines,
        -- Fair odds from football_fair_odds table
        ffo.fair_odds_x12,
        ffo.fair_odds_ah,
        ffo.fair_odds_ou,
        jsonb_build_object('ah', ffo.latest_lines->'ah', 'ou', ffo.latest_lines->'ou') as fair_latest_lines
      FROM football_fixtures ff
      LEFT JOIN football_odds fo ON ff.id = fo.fixture_id
      LEFT JOIN football_fair_odds ffo ON ff.id = ffo.fixture_id AND fo.bookie = ffo.bookie
      WHERE LOWER(ff.status_short) = ANY($1)
        AND ff.date >= CURRENT_DATE
        ${fixtureFilter}
        ${fullBookieFilter}
        AND (ffo.bookie IS NULL OR ffo.bookie != 'Prediction')
      ORDER BY COALESCE(fo.updated_at, ffo.updated_at) DESC, COALESCE(fo.fixture_id, ffo.fixture_id), COALESCE(fo.bookie, ffo.bookie)
    `;
  } else {
    // Regular odds only
    query = `
      SELECT
        fo.fixture_id,
        ff.home_team_name,
        ff.away_team_name,
        ff.date,
        ff.league_name,
        fo.bookie,
        fo.decimals,
        fo.updated_at,
        -- Extract latest X12 odds (last element of array using -> -1)
        fo.odds_x12->-1 as odds_x12,
        -- Extract latest AH odds (last element of array using -> -1)
        fo.odds_ah->-1 as odds_ah,
        -- Extract latest OU odds (last element of array using -> -1)
        fo.odds_ou->-1 as odds_ou,
        -- Extract latest lines (last element of array using -> -1)
        fo.lines->-1 as lines
      FROM football_odds fo
      JOIN football_fixtures ff ON fo.fixture_id = ff.id
      WHERE LOWER(ff.status_short) = ANY($1)
        AND ff.date >= CURRENT_DATE
        ${fixtureFilter}
        ${fullBookieFilter}
      ORDER BY fo.updated_at DESC, fo.fixture_id, fo.bookie
    `;
  }

  const result = await client.query(query, params);

  return result.rows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureIdParam = searchParams.get('fixtureId');
  const bookiesParam = searchParams.get('bookies');
  const fairOddsParam = searchParams.get('fair_odds');

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

  // Parse fair_odds parameter
  const useFairOdds = fairOddsParam === 'true' || fairOddsParam === '1';

  // Parse bookies parameter (comma-separated list)
  let bookieFilter = '';
  let bookieParams: any[] = [];
  if (bookiesParam) {
    const bookies = bookiesParam.split(',').map(b => b.trim()).filter(b => b.length > 0);
    if (bookies.length > 0) {
      const bookiePlaceholders = bookies.map((_, i) => `$${i + 1}`).join(',');
      bookieFilter = `AND fo.bookie IN (${bookiePlaceholders})`;
      bookieParams = bookies;
    }
  }

  const encoder = new TextEncoder();
  let client: PoolClient | null = null;
  let keepAliveInterval: NodeJS.Timeout | null = null;
  let bookieFilterStr = '';
  let bookieParamsArr: any[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Get a dedicated client from the pool for this connection
        client = await pool.connect();

        // Store bookie filter for use in notification handler
        bookieFilterStr = bookieFilter;
        bookieParamsArr = bookieParams;

        // Get fixture IDs to listen to their channels
        let finalFixtureIds: number[];
        if (fixtureIds.length > 0) {
          // Use specified fixture IDs
          finalFixtureIds = fixtureIds;
        } else {
          // Get all current future fixture IDs to listen to their channels
          const fixturesResult = await client.query(`
            SELECT id FROM football_fixtures
            WHERE LOWER(status_short) = ANY($1) AND date >= CURRENT_DATE
          `, [IN_FUTURE]);
          finalFixtureIds = fixturesResult.rows.map(row => row.id);
        }

        // Listen to all fixture-specific channels
        for (const fixtureId of finalFixtureIds) {
          await client.query(`LISTEN odds_update_${fixtureId}`);
        }

        // Send initial "started" message
        const startedData = JSON.stringify({
          type: 'started',
          timestamp: Date.now(),
          message: 'Odds stream started successfully'
        });
        controller.enqueue(encoder.encode(`data: ${startedData}\n\n`));

        // Set up notification handler for all channels
        client.on('notification', async (msg) => {
          // Check if it's an odds_update channel
          if (msg.channel.startsWith('odds_update_')) {
            try {
              // Extract fixture ID from channel name
              const fixtureId = parseInt(msg.channel.replace('odds_update_', ''));

              if (fixtureId && !isNaN(fixtureId)) {
                // Fetch updated odds data for this specific fixture
                const updates = await getLatestOddsUpdates(client!, fixtureId, bookieFilterStr, bookieParamsArr, useFairOdds);

                if (updates.length > 0) {
                  // Group updates by fixture for cleaner streaming
                  const fixturesMap = new Map();

                  updates.forEach(row => {
                    const fixtureId = row.fixture_id;

                    if (!fixturesMap.has(fixtureId)) {
                      fixturesMap.set(fixtureId, {
                        fixture_id: fixtureId,
                        home_team: row.home_team_name,
                        away_team: row.away_team_name,
                        date: row.date,
                        league: row.league_name,
                        updated_at: row.updated_at,
                        odds: []
                      });
                    }

                    // Only add odds if they exist (regular odds or fair odds)
                    if (row.odds_x12 || row.odds_ah || row.odds_ou || row.fair_odds_x12 || row.fair_odds_ah || row.fair_odds_ou) {
                      const oddsObj: any = {
                        bookie: row.bookie,
                        decimals: row.decimals,
                        odds_x12: row.odds_x12 || null,
                        odds_ah: row.odds_ah || null,
                        odds_ou: row.odds_ou || null,
                        lines: row.lines || null
                      };

                      // Add fair odds fields when fair_odds=true
                      if (useFairOdds) {
                        if (row.bookie === 'Prediction') {
                          // For Prediction, use latest regular odds as fair odds (without timestamps) since they're already calculated without margins
                          oddsObj.fair_odds_x12 = row.odds_x12 && row.odds_x12.length > 0 ? row.odds_x12[row.odds_x12.length - 1].x12 : null;
                          oddsObj.fair_odds_ah = row.odds_ah && row.odds_ah.length > 0 ? row.odds_ah[row.odds_ah.length - 1] : null;
                          oddsObj.fair_odds_ou = row.odds_ou && row.odds_ou.length > 0 ? row.odds_ou[row.odds_ou.length - 1] : null;
                          oddsObj.fair_latest_lines = row.lines && row.lines.length > 0 ? {
                            ah: row.lines[row.lines.length - 1].ah || null,
                            ou: row.lines[row.lines.length - 1].ou || null
                          } : null;
                        } else {
                          // For other bookmakers, use calculated fair odds
                          oddsObj.fair_odds_x12 = row.fair_odds_x12 || null;
                          oddsObj.fair_odds_ah = row.fair_odds_ah || null;
                          oddsObj.fair_odds_ou = row.fair_odds_ou || null;
                          oddsObj.fair_latest_lines = row.fair_latest_lines || null;
                        }
                      }

                      fixturesMap.get(fixtureId).odds.push(oddsObj);
                    }
                  });

                  const fixtures = Array.from(fixturesMap.values());

                  if (fixtures.length > 0) {
                    // For single fixture streams, return just the odds array directly
                    const data = JSON.stringify({
                      type: 'odds_update',
                      timestamp: Date.now(),
                      odds: fixtures[0].odds
                    });
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                  }
                }
              }
            } catch (error) {
              console.error('Error fetching updated odds:', error);
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
