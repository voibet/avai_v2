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
    fullBookieFilter = bookieFilter.replace(/\$(\d+)/g, (_match, num) => `$${parseInt(num) + params.length}`);
    params.push(...(bookieParams || []));
  }

  let query;
  if (useFairOdds) {
    // When fair_odds=true, join both tables and return both regular and fair odds
    query = `
      SELECT
        COALESCE(fo.fixture_id, ffo.fixture_id) as fixture_id,
        ff.home_team_id,
        ff.home_team_name,
        ff.away_team_id,
        ff.away_team_name,
        ff.date,
        ff.league_id,
        ff.league_name,
        ff.season,
        ff.status_short,
        ff.round,
        COALESCE(fo.bookie, ffo.bookie) as bookie,
        COALESCE(fo.decimals, ffo.decimals) as decimals,
        -- Regular odds from football_odds table
        fo.odds_x12->-1 as odds_x12,
        fo.odds_ah->-1 as odds_ah,
        fo.odds_ou->-1 as odds_ou,
        fo.lines->-1 as lines,
        -- Fair odds from football_fair_odds table
        ffo.fair_odds_x12,
        ffo.fair_odds_ah,
        ffo.fair_odds_ou,
        jsonb_build_object('ah', ffo.latest_lines->'ah', 'ou', ffo.latest_lines->'ou') as fair_odds_lines,
        ffo.latest_t as fair_odds_latest_t
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
        ff.home_team_id,
        ff.home_team_name,
        ff.away_team_id,
        ff.away_team_name,
        ff.date,
        ff.league_id,
        ff.league_name,
        ff.season,
        ff.status_short,
        ff.round,
        fo.bookie,
        fo.decimals,
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
        try {
          client = await pool.connect();
        } catch (dbError) {
          console.error('Database connection failed:', dbError);
          if (dbError instanceof Error && dbError.message.includes('timeout')) {
            throw new Error('Database connection timeout - pool may be exhausted');
          }
          throw new Error(`Database connection failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
        }

        if (!client) {
          console.error('Client is null after pool.connect() - this should not happen');
          throw new Error('Database client is null after successful connection');
        }

        // Store bookie filter for use in notification handler
        bookieFilterStr = bookieFilter;
        bookieParamsArr = bookieParams;

        // Get fixture IDs to listen to their channels
        let finalFixtureIds: number[];
        let listenToAllFixtures = false;
        try {
        if (fixtureIds.length > 0) {
          // Use specified fixture IDs
          finalFixtureIds = fixtureIds;
          } else {
            // Listen to ALL future fixtures - don't filter by specific IDs
            listenToAllFixtures = true;
            finalFixtureIds = []; // Will query fresh on each notification
          }
        } catch (fixtureQueryError) {
          console.error('Error fetching fixture IDs:', fixtureQueryError);
          // Continue anyway - we'll listen to all updates
          listenToAllFixtures = true;
          finalFixtureIds = [];
        }

        // Listen to single odds updates channel
        if (!client) {
          console.error('Client became null before LISTEN command');
          throw new Error('Database client is not available');
        }
        try {
          await client.query(`LISTEN odds_updates`);
        } catch (listenError) {
          console.error('Failed to LISTEN on odds_updates:', listenError);
          throw new Error(`Failed to listen on channel odds_updates: ${listenError instanceof Error ? listenError.message : 'Unknown error'}`);
        }

        // Send initial "started" message
        const startedData = JSON.stringify({
          type: 'started',
          timestamp: Date.now(),
          message: 'Odds stream started successfully'
        });
        controller.enqueue(encoder.encode(`data: ${startedData}\n\n`));

        // Set up notification handler for the odds_updates channel
        client.on('notification', async (msg) => {
          // Check if it's the odds_updates channel
          if (msg.channel === 'odds_updates') {
            try {
              // Extract fixture ID from payload
              if (!msg.payload) {
                console.error('[Odds Stream] Received notification without payload');
                return;
              }

              const fixtureId = parseInt(msg.payload);

              if (fixtureId && !isNaN(fixtureId)) {
                // Process if: listening to all fixtures OR this specific fixture is in our list
                if (listenToAllFixtures || finalFixtureIds.includes(fixtureId)) {
                  const updates = await getLatestOddsUpdates(client!, fixtureId, bookieFilterStr, bookieParamsArr, useFairOdds);

                  if (updates.length > 0) {
                    // Group updates by fixture for cleaner streaming
                    const fixturesMap = new Map();

                    updates.forEach(row => {
                      const fixtureId = row.fixture_id;

                      if (!fixturesMap.has(fixtureId)) {
                        fixturesMap.set(fixtureId, {
                          fixture_id: fixtureId,
                          home_team_id: row.home_team_id,
                          home_team: row.home_team_name,
                          away_team_id: row.away_team_id,
                          away_team: row.away_team_name,
                          date: row.date,
                          league_id: row.league_id,
                          league: row.league_name,
                          season: row.season,
                          status_short: row.status_short,
                          round: row.round,
                          odds: []
                        });
                      }

                      // Only add odds if they exist (regular odds or fair odds)
                      if (row.odds_x12 || row.odds_ah || row.odds_ou || row.fair_odds_x12 || row.fair_odds_ah || row.fair_odds_ou) {
                        const oddsObj: any = {
                          bookie: row.bookie,
                          decimals: row.decimals,
                          // Wrap single objects in arrays (SQL ->-1 returns last element, not array)
                          odds_x12: row.odds_x12 ? [row.odds_x12] : null,
                          odds_ah: row.odds_ah ? [row.odds_ah] : null,
                          odds_ou: row.odds_ou ? [row.odds_ou] : null,
                          lines: row.lines ? [row.lines] : null,
                          updated_at: row.updated_at
                        };

                        // Add fair odds fields when fair_odds=true
                        if (useFairOdds) {
                          if (row.bookie === 'Prediction') {
                            // For Prediction, row.odds_x12 is single object (from SQL ->-1), already has latest values
                            const latestTimestamp = row.odds_x12?.t || row.odds_ah?.t || row.odds_ou?.t || row.lines?.t;

                            if (row.odds_x12 && row.odds_x12.x12 && latestTimestamp) {
                              oddsObj.fair_odds_x12 = {
                                t: latestTimestamp,
                                x12: row.odds_x12.x12
                              };
                            } else {
                              oddsObj.fair_odds_x12 = null;
                            }

                            if (row.odds_ah && latestTimestamp) {
                              oddsObj.fair_odds_ah = {
                                t: latestTimestamp,
                                fair_ah_a: row.odds_ah.ah_a || null,
                                fair_ah_h: row.odds_ah.ah_h || null
                              };
                            } else {
                              oddsObj.fair_odds_ah = null;
                            }

                            if (row.odds_ou && latestTimestamp) {
                              oddsObj.fair_odds_ou = {
                                t: latestTimestamp,
                                fair_ou_o: row.odds_ou.ou_o || null,
                                fair_ou_u: row.odds_ou.ou_u || null
                              };
                            } else {
                              oddsObj.fair_odds_ou = null;
                            }

                            if (row.lines && latestTimestamp) {
                              oddsObj.fair_odds_lines = [{
                                t: latestTimestamp,
                                ah: row.lines.ah || null,
                                ou: row.lines.ou || null
                              }];
                            } else {
                              oddsObj.fair_odds_lines = null;
                            }
                          } else {
                            // For other bookmakers, use calculated fair odds with embedded timestamps
                            if (row.fair_odds_x12 && row.fair_odds_latest_t?.x12_ts) {
                              oddsObj.fair_odds_x12 = {
                                t: row.fair_odds_latest_t.x12_ts,
                                x12: row.fair_odds_x12
                              };
                            } else {
                              oddsObj.fair_odds_x12 = null;
                            }

                            if (row.fair_odds_ah && row.fair_odds_latest_t?.ah_ts) {
                              oddsObj.fair_odds_ah = {
                                t: row.fair_odds_latest_t.ah_ts,
                                fair_ah_a: row.fair_odds_ah.fair_ah_a,
                                fair_ah_h: row.fair_odds_ah.fair_ah_h
                              };
                            } else {
                              oddsObj.fair_odds_ah = null;
                            }

                            if (row.fair_odds_ou && row.fair_odds_latest_t?.ou_ts) {
                              oddsObj.fair_odds_ou = {
                                t: row.fair_odds_latest_t.ou_ts,
                                fair_ou_o: row.fair_odds_ou.fair_ou_o,
                                fair_ou_u: row.fair_odds_ou.fair_ou_u
                              };
                            } else {
                              oddsObj.fair_odds_ou = null;
                            }

                            if (row.fair_odds_lines && row.fair_odds_latest_t?.lines_ts) {
                              oddsObj.fair_odds_lines = [{
                                t: row.fair_odds_latest_t.lines_ts,
                                ah: row.fair_odds_lines.ah || [],
                                ou: row.fair_odds_lines.ou || []
                              }];
                            } else {
                              oddsObj.fair_odds_lines = null;
                            }
                            // Remove separate latest_t field for fair odds
                          }
                        }

                        fixturesMap.get(fixtureId).odds.push(oddsObj);
                      }
                    });

                    const fixtures = Array.from(fixturesMap.values());

                    if (fixtures.length > 0) {
                      // Return fixture with odds, including all fixture metadata
                      const fixture = fixtures[0];
                      const data = JSON.stringify({
                        type: 'odds_update',
                        timestamp: Date.now(),
                        fixture_id: fixture.fixture_id,
                        home_team_id: fixture.home_team_id,
                        home_team_name: fixture.home_team,
                        away_team_id: fixture.away_team_id,
                        away_team_name: fixture.away_team,
                        date: fixture.date,
                        league_id: fixture.league_id,
                        league_name: fixture.league,
                        season: fixture.season,
                        status_short: fixture.status_short,
                        round: fixture.round,
                        odds: fixture.odds
                      });
                      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
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
