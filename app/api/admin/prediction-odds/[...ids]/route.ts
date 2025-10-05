import { NextResponse } from 'next/server';
import { calculateOddsFromPredictions } from '../../../../../calculators/prediction-odds.js';

export const dynamic = 'force-dynamic';

/**
 * POST - Calculate betting odds from MLP predictions for specific fixture IDs
 * URL format: /api/admin/prediction-odds/123,456,789
 * Supports comma-separated fixture IDs
 */
export async function POST(
  request: Request,
  { params }: { params: { ids: string[] } }
) {
  try {
    // Parse fixture IDs from URL path
    const idsParam = params.ids.join('/');
    const fixtureIds: number[] = idsParam.split(',').map(id => {
      const parsed = parseInt(id.trim());
      return isNaN(parsed) ? null : parsed;
    }).filter((id): id is number => id !== null);

    if (fixtureIds.length === 0) {
      return NextResponse.json({
        error: 'Invalid fixture IDs provided. Use comma-separated numbers.',
      }, { status: 400 })
    }

    console.log(`🧮 Starting prediction odds calculation for ${fixtureIds.length} fixture(s): ${fixtureIds.join(', ')}`);

    // Calculate odds for the specified fixtures
    const calculated = await calculateOddsFromPredictions(fixtureIds);

    console.log(`✅ Prediction odds calculation completed: ${calculated} fixtures processed`);

    return NextResponse.json({
      success: true,
      message: `Prediction odds calculated successfully for ${fixtureIds.length} fixture(s)`,
      fixtureIds,
      fixturesProcessed: calculated
    })

  } catch (error) {
    console.error('❌ Error in prediction odds calculation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prediction odds calculation failed' },
      { status: 500 }
    );
  }
}
