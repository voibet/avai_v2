import { XGFetcher } from '@/lib/xg-fetcher';


export async function POST() {
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
          // Always fetch for all leagues
          const result = await xgFetcher.fetchXGDataForAllLeagues(
            (league: string, current: number, total: number) => sendProgress(`Processing ${league}`, current, total)
          );

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
}
