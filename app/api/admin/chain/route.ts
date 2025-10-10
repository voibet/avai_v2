import { executeChain } from '@/lib/services/chain-processor';


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
            const result = await executeChain({
              type: type as 'league' | 'all',
              leagueId,
              onProgress: sendProgress
            });

            // Send completion message
            const completionData = {
              type: 'complete',
              ...result,
              message: result.message + ', calculations complete'
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
