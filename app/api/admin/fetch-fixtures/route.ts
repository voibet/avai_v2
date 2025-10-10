import { FixtureFetcher } from '@/lib/services/fixture-fetcher';

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  // Create a ReadableStream for Server-Sent Events
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const fetcher = new FixtureFetcher();

        // Parse the request body to get selected seasons
        let selectedSeasons: Record<string, string[]> = {};
        try {
          const body = await request.json();
          if (body.selectedSeasons) {
            selectedSeasons = body.selectedSeasons;
          }
        } catch (error) {
          console.log('No request body or invalid format, using default behavior');
        }

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

        // Start fetching with progress callback and selected seasons
        const result = await fetcher.fetchAndUpdateFixtures(onProgress, selectedSeasons);

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
