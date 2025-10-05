import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';
import { hasCachedModel, getCachedModel } from '../../../../lib/ml-cache';
import { startPredictionWorker } from '../../../../lib/ml-worker';


export const dynamic = 'force-dynamic';

/**
 * POST - Make predictions in background process
 * Query parameters:
 * - fixtureIds: Comma-separated list of fixture IDs to predict (optional)
 * Examples:
 * - POST /api/mlp/predict - Predict all upcoming fixtures
 * - POST /api/mlp/predict?fixtureIds=123 - Predict fixture 123
 * - POST /api/mlp/predict?fixtureIds=123,456,789 - Predict fixtures 123, 456, 789
 */
export async function POST(request: Request) {
  try {
    // Check if model is cached
    const hasModel = await hasCachedModel();
    if (!hasModel) {
      return NextResponse.json({
        error: 'No model cached. Please call /api/mlp/train first and wait for it to complete.',
      }, { status: 503 })
    }

    const modelData = await getCachedModel();
    if (!modelData) {
      return NextResponse.json({
        error: 'Failed to load model from cache.',
      }, { status: 500 })
    }
    
    const features = modelData.features;

    // Parse fixture IDs from query parameters
    const { searchParams } = new URL(request.url);
    const fixtureIdsParam = searchParams.get('fixtureIds');
    let fixtureIds: number[] | null = null;

    if (fixtureIdsParam) {
      fixtureIds = fixtureIdsParam.split(',').map(id => {
        const parsed = parseInt(id.trim());
        return isNaN(parsed) ? null : parsed;
      }).filter(id => id !== null) as number[];

      if (fixtureIds.length === 0) {
        return NextResponse.json({
          error: 'Invalid fixture IDs provided. Use comma-separated numbers.',
        }, { status: 400 })
      }
    }

    // Fetch prediction data
    let predictionQuery = `
      SELECT DISTINCT ON (f.id)
        f.id,
        f.home_team_name,
        f.away_team_name,
        s.home_advantage,
        s.adjusted_rolling_xg_home,
        s.adjusted_rolling_xga_home,
        s.adjusted_rolling_xg_away,
        s.adjusted_rolling_xga_away,
        s.adjusted_rolling_market_xg_home,
        s.adjusted_rolling_market_xga_home,
        s.adjusted_rolling_market_xg_away,
        s.adjusted_rolling_market_xga_away,
        s.avg_goals_league
      FROM football_fixtures f
      INNER JOIN football_stats s ON f.id = s.fixture_id
      WHERE f.status_short = 'NS'
    `;

    const params: any[] = [];
    if (fixtureIds && fixtureIds.length > 0) {
      predictionQuery += ` AND f.id = ANY($1::bigint[])`;
      params.push(fixtureIds);
    }

    predictionQuery += ` ORDER BY f.id, f.date ASC LIMIT 100000`;

    const predictionResult = await pool.query(predictionQuery, params)
    console.log(`Fetched ${predictionResult.rows.length} prediction fixtures`)

    // Start prediction in background process
    startPredictionWorker(predictionResult.rows, features);

    // Return immediately
    const message = fixtureIds && fixtureIds.length > 0
      ? `Predictions started in background for ${fixtureIds.length} specific fixture(s): ${fixtureIds.join(', ')}. Check console logs for progress.`
      : 'Predictions started in background for all upcoming fixtures. Check console logs for progress.';

    return NextResponse.json({
      success: true,
      message,
      fixtureCount: predictionResult.rows.length,
      fixtureIds: fixtureIds || null,
      modelStats: modelData.stats
    })
  } catch (error) {
    console.error('Prediction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prediction failed' },
      { status: 500 }
    );
  }
}

