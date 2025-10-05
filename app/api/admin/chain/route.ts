import { FixtureFetcher } from '@/lib/fixture-fetcher';
import { XGFetcher } from '@/lib/xg-fetcher';
import pool from '@/lib/db';


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, leagueId } = body;

    if (!type || !['league', 'all'].includes(type)) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid type. Must be "league" or "all"'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (type === 'league' && !leagueId) {
      return new Response(JSON.stringify({
        success: false,
        message: 'League ID is required when type is "league"'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const sendProgress = (message: string, current: number, total: number) => {
          const progressData = {
            type: 'progress',
            message,
            current,
            total,
            percentage: Math.round((current / total) * 100)
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progressData)}\n\n`));
        };

        const processChain = async () => {
          try {
            let fixturesUpdated = 0;
            let xgUpdated = 0;
            const allUpdatedFixtureIds: number[] = [];

            // Step 1: Fetch fixtures
            sendProgress('Step 1/5: Fetching fixtures...', 1, 5);
            const fixtureFetcher = new FixtureFetcher();
            
            let fixtureResult;
            if (type === 'league') {
              const currentSeason = await fixtureFetcher.getCurrentSeasonForLeague(leagueId);
              if (!currentSeason) {
                throw new Error(`No current season found for league ${leagueId}`);
              }
              const selectedSeasons: Record<string, string[]> = {
                [leagueId.toString()]: [currentSeason.toString()]
              };
              fixtureResult = await fixtureFetcher.fetchAndUpdateFixtures(
                (league: string, index: number, total: number) => 
                  sendProgress(`Fetching fixtures: ${league}`, 1, 5),
                selectedSeasons
              );
            } else {
              fixtureResult = await fixtureFetcher.fetchAndUpdateFixtures(
                (league: string, index: number, total: number) => 
                  sendProgress(`Fetching fixtures: ${league}`, 1, 5)
              );
            }
            fixturesUpdated = fixtureResult.updatedCount || 0;

            // Step 2: Fetch xG data for finished fixtures missing xG
            sendProgress('Step 2/5: Fetching xG data...', 2, 5);
            
            let xgCheckQuery = `
              SELECT DISTINCT f.league_id, l.name as league_name
              FROM football_fixtures f
              JOIN football_leagues l ON f.league_id = l.id
              WHERE f.status_short = 'FT'
              AND (f.xg_home IS NULL OR f.xg_away IS NULL)
              AND l.xg_source IS NOT NULL
            `;
            
            const xgCheckParams: any[] = [];
            if (type === 'league' && leagueId) {
              xgCheckQuery += ' AND f.league_id = $1';
              xgCheckParams.push(leagueId);
            }
            
            const xgCheckResult = await pool.query(xgCheckQuery, xgCheckParams);
            const leaguesNeedingXG = xgCheckResult.rows;

            if (leaguesNeedingXG.length > 0) {
              const xgFetcher = new XGFetcher();
              
              for (let i = 0; i < leaguesNeedingXG.length; i++) {
                const league = leaguesNeedingXG[i];
                
                sendProgress(`Fetching xG: ${league.league_name}`, 2, 5);

                try {
                  const xgResult = await xgFetcher.fetchXGDataForLeague(
                    league.league_id,
                    (msg: string) => sendProgress(`xG: ${league.league_name} - ${msg}`, 2, 5)
                  );

                  if (xgResult.success && xgResult.updatedCount) {
                    xgUpdated += xgResult.updatedCount;
                    if (xgResult.updatedFixtureIds) {
                      allUpdatedFixtureIds.push(...xgResult.updatedFixtureIds);
                    }
                  }
                } catch (error) {
                  console.error(`Error fetching xG for league ${league.league_name}:`, error);
                }
              }
            }

            // Step 3: Run calculation chain if we have updated fixtures
            if (allUpdatedFixtureIds.length > 0) {
              console.log(`Starting calculations for ${allUpdatedFixtureIds.length} updated fixtures`);
              sendProgress('Step 3/5: Calculating market xG...', 3, 5);
              
              try {
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
                console.log(`Found ${teamIds.length} teams involved`);

                const futureFixturesQuery = `
                  SELECT f.id
                  FROM football_fixtures f
                  WHERE f.status_short = 'NS'
                    AND (f.home_team_id = ANY($1::bigint[]) OR f.away_team_id = ANY($1::bigint[]))
                  ORDER BY f.date ASC
                `;
                const futureFixturesResult = await pool.query(futureFixturesQuery, [teamIds]);
                const futureFixtureIds = futureFixturesResult.rows.map((row: any) => row.id);
                console.log(`Found ${futureFixtureIds.length} future fixtures`);

                // Calculate market XG
                console.log('Calculating market XG...');
                const { calculateMarketXG } = await import('@/calculators/market-xg.js');
                await calculateMarketXG(allUpdatedFixtureIds);
                console.log('Market XG calculated');

                if (futureFixtureIds.length > 0) {
                  // Step 4: Calculate statistics
                  sendProgress('Step 4/5: Calculating statistics...', 4, 5);
                  console.log('Calculating statistics...');
                  await pool.query('SELECT populate_hours_batch($1) as count', [futureFixtureIds]);
                  await pool.query('SELECT populate_league_goals_batch($1) as count', [futureFixtureIds]);
                  await pool.query('SELECT populate_home_advantage_batch($1) as count', [futureFixtureIds]);
                  await pool.query('SELECT calculate_elos_incremental($1) as count', [futureFixtureIds]);
                  await pool.query('SELECT populate_adjusted_rolling_xg_batch($1) as count', [futureFixtureIds]);
                  await pool.query('SELECT populate_adjusted_rolling_market_xg_batch($1) as count', [futureFixtureIds]);
                  console.log('Statistics calculated');

                  // Step 5: Generate predictions and odds
                  sendProgress('Step 5/5: Generating predictions...', 5, 5);
                  console.log('Generating predictions...');
                  const { predictFixtures } = await import('@/lib/ml-predict');
                  await predictFixtures({ fixtureIds: futureFixtureIds });
                  console.log('Predictions generated');

                  console.log('Calculating odds...');
                  const { calculateOddsFromPredictions } = await import('@/calculators/prediction-odds.js');
                  await calculateOddsFromPredictions(futureFixtureIds);
                  console.log('Odds calculated');
                } else {
                  console.log('No future fixtures found, skipping predictions');
                }
              } catch (calcError) {
                console.error('Error in calculation chain:', calcError);
                sendProgress(`Error in calculations: ${calcError instanceof Error ? calcError.message : 'Unknown error'}`, 3, 5);
                throw calcError;
              }
            } else {
              console.log('No xG updates, skipping calculations');
              sendProgress('Step 3/5: No xG updates, skipping calculations...', 3, 5);
            }

            // Send completion message
            console.log(`✅ Chain Complete: ${fixturesUpdated} fixtures fetched, ${xgUpdated} xG values updated`);
            const completionData = {
              type: 'complete',
              success: true,
              message: `Chain completed: ${fixturesUpdated} fixtures fetched, ${xgUpdated} xG values updated, calculations complete`,
              fixturesUpdated,
              xgUpdated
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`));
            controller.close();

          } catch (error) {
            const errorData = {
              type: 'error',
              success: false,
              message: error instanceof Error ? error.message : 'An error occurred'
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
            controller.close();
          }
        };

        processChain();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
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
