import { NextResponse } from 'next/server';
import { calculateOddsFromPredictions } from '../../../../calculators/prediction-odds.js';

export const dynamic = 'force-dynamic';

/**
 * POST - Calculate betting odds from all MLP predictions
 * URL format: /api/admin/prediction-odds
 */
export async function POST() {
  try {
    console.log('🧮 Starting prediction odds calculation for all fixtures with predictions');

    // Calculate odds for all fixtures (null parameter)
    const calculated = await calculateOddsFromPredictions(null);

    console.log(`✅ Prediction odds calculation completed: ${calculated} fixtures processed`);

    return NextResponse.json({
      success: true,
      message: `Prediction odds calculated successfully for all fixtures`,
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
