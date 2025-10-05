import { NextResponse } from 'next/server';
import { XGFetcher } from '@/lib/xg-fetcher';


async function fetchXGData(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { type, leagueId } = body;

    if (!type || !['league', 'all'].includes(type)) {
      return NextResponse.json(
        { success: false, message: 'Invalid type. Must be "league" or "all"' },
        { status: 400 }
      );
    }

    if (type === 'league' && !leagueId) {
      return NextResponse.json(
        { success: false, message: 'League ID is required when type is "league"' },
        { status: 400 }
      );
    }

    const xgFetcher = new XGFetcher();

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

        const processXGFetch = async () => {
          try {
            let result;

            if (type === 'league') {
              result = await xgFetcher.fetchXGDataForLeague(
                parseInt(leagueId),
                (message: string, current: number, total: number) => sendProgress(message, current, total)
              );
            } else {
              result = await xgFetcher.fetchXGDataForAllLeagues(
                (league: string, current: number, total: number) => sendProgress(`Processing ${league}`, current, total)
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

        processXGFetch();
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
    console.error('XG fetch endpoint error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'An error occurred' 
      },
      { status: 500 }
    );
  }
}

export const POST = fetchXGData;