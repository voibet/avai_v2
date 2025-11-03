import { executeChain } from '@/lib/services/chain-processor';


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, leagueId, fixtureId, skipFixtureFetch, skipXG, forceStatsUpdate } = body;

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

    try {
      const result = await executeChain({
        type: type as 'league' | 'all',
        leagueId,
        fixtureId,
        onProgress: (message: string, current: number, total: number) => {
          // Progress logging only - no streaming
          console.log(`[${current}/${total}] ${message}`);
        },
        skipFixtureFetch,
        skipXG,
        forceStatsUpdate
      });

      return new Response(JSON.stringify({
        ...result,
        message: result.message + ', calculations complete'
      }), {
        headers: { 'Content-Type': 'application/json' }
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
