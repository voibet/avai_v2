import { NextResponse } from 'next/server';
import { predictFixtures } from '../../../../../lib/ml-predict';
import { getCachedModel } from '../../../../../lib/ml-cache';


export const dynamic = 'force-dynamic';

/**
 * POST - Make predictions for all upcoming fixtures
 * Query parameters:
 * - fixtureIds: Comma-separated list of fixture IDs to predict (optional)
 * Examples:
 * - POST /api/admin/mlp/predict - Predict all upcoming fixtures
 * - POST /api/admin/mlp/predict?fixtureIds=123 - Predict fixture 123
 * - POST /api/admin/mlp/predict?fixtureIds=123,456,789 - Predict fixtures 123, 456, 789
 */
export async function POST(request: Request) {
  try {
    console.log('[Predict] Starting prediction request...');
    
    // Parse fixture IDs from query parameters
    const { searchParams } = new URL(request.url);
    const fixtureIdsParam = searchParams.get('fixtureIds');
    let fixtureIds: number[] | undefined = undefined;

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
      console.log(`[Predict] Predicting ${fixtureIds.length} specific fixtures`);
    } else {
      console.log('[Predict] Predicting all upcoming fixtures');
    }

    // Call shared prediction logic
    const result = await predictFixtures({ fixtureIds });

    if (!result.success) {
      console.log(`[Predict] Failed: ${result.error}`);
      return NextResponse.json({
        error: result.error
      }, { status: result.error?.includes('No model') ? 503 : 500 })
    }

    console.log(`[Predict] Success! Generated ${result.predictionsGenerated} predictions`);
    
    // Get model stats for response
    const modelData = await getCachedModel();
    
    const message = fixtureIds && fixtureIds.length > 0
      ? `Predictions completed successfully for ${fixtureIds.length} specific fixture(s)`
      : 'Predictions completed successfully for all upcoming fixtures';

    return NextResponse.json({
      success: true,
      message,
      fixtureCount: result.fixtureCount,
      fixtureIds: fixtureIds || null,
      predictionsGenerated: result.predictionsGenerated,
      predictionsSaved: result.predictionsSaved,
      modelStats: modelData?.stats
    })
  } catch (error) {
    console.error('[Predict] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prediction failed' },
      { status: 500 }
    );
  }
}

