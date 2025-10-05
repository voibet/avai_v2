import { FixtureFetcher } from '../../../../lib/fixture-fetcher';


export async function POST() {
  const encoder = new TextEncoder();

  // Create a ReadableStream for Server-Sent Events
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const fetcher = new FixtureFetcher();

        // Progress callback to send updates to client
        const onProgress = (leagueName: string, current: number, total: number) => {
          const progressData = {
            type: 'progress',
            league: leagueName,
            current,
            total,
            message: `Fetching ${leagueName} (${current}/${total})`
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progressData)}\n\n`));
        };

        // Start fetching for all current seasons (no selected seasons)
        const result = await fetcher.fetchAndUpdateFixtures(onProgress);

        // Send final result
        const finalData = {
          type: 'complete',
          success: result.success,
          message: result.message,
          updatedCount: result.updatedCount
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`));

      } catch (error) {
        const errorData = {
          type: 'error',
          message: `Failed to fetch fixtures: ${error instanceof Error ? error.message : 'Unknown error'}`
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
      } finally {
        controller.close();
      }
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
