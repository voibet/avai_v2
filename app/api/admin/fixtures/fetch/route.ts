import { FixtureFetcher } from '@/lib/services/fixture-fetcher';


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

    const fixtureFetcher = new FixtureFetcher();

    // Use Server-Sent Events for progress updates
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

        const processFixtureFetch = async () => {
          try {
            let result;

            if (type === 'league') {
              // Fetch fixtures for a specific league's current season
              const currentSeason = await fixtureFetcher.getCurrentSeasonForLeague(leagueId);
              if (!currentSeason) {
                throw new Error(`No current season found for league ${leagueId}`);
              }
              const selectedSeasons: Record<string, string[]> = {
                [leagueId.toString()]: [currentSeason.toString()]
              };
              result = await fixtureFetcher.fetchAndUpdateFixtures(
                (league: string, index: number, total: number) => sendProgress(`Processing ${league}`, index, total),
                selectedSeasons
              );
            } else {
              // Fetch fixtures for all current seasons
              result = await fixtureFetcher.fetchAndUpdateFixtures(
                (league: string, index: number, total: number) => sendProgress(`Processing ${league}`, index, total)
              );
            }

            // Send completion message
            const completionData = {
              type: 'complete',
              success: result.success,
              message: result.message,
              updatedCount: result.updatedCount
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

        processFixtureFetch();
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
