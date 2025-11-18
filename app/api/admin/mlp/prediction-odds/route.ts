import { NextResponse } from 'next/server';
import { calculateOddsFromPredictions } from '@/lib/calculations/prediction-odds';


export const dynamic = 'force-dynamic';

// POST - Calculate odds from saved predictions
// Query parameters:
// - fixtureIds: Comma-separated list of fixture IDs (optional, default: all)
export async function POST(request: Request) {
  try {
    console.log('[Prediction Odds] Starting odds calculation from saved predictions...');

    // Parse fixture IDs from query parameters
    const { searchParams } = new URL(request.url);
    const fixtureIdsParam = searchParams.get('fixtureIds');
    let fixtureIds: number[] | null = null;

    if (fixtureIdsParam) {
      const parsed = fixtureIdsParam.split(',').map(id => {
        const num = parseInt(id.trim());
        return isNaN(num) ? null : num;
      }).filter(id => id !== null) as number[];

      if (parsed.length === 0) {
        return NextResponse.json({
          error: 'Invalid fixture IDs provided. Use comma-separated numbers.',
        }, { status: 400 })
      }

      fixtureIds = parsed;
      console.log(`[Prediction Odds] Calculating odds for ${fixtureIds.length} specific fixtures`);
    } else {
      console.log('[Prediction Odds] Calculating odds for all fixtures with predictions');
    }

    // Calculate odds from predictions
    const calculatedCount = await calculateOddsFromPredictions(fixtureIds);

    console.log(`[Prediction Odds] Successfully calculated odds for ${calculatedCount} fixtures`);

    return NextResponse.json({
      success: true,
      message: `Successfully calculated prediction odds for ${calculatedCount} fixtures`,
      fixturesProcessed: calculatedCount,
      fixtureIds: fixtureIds
    });

  } catch (error) {
    console.error('[Prediction Odds] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Odds calculation failed' },
      { status: 500 }
    );
  }
}
