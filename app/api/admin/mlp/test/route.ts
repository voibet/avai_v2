import { NextResponse } from 'next/server';
import pool from '../../../../../lib/database/db';
import { trainAndPredict } from '../../../../../lib/ml/ml-evaluation';
import { savePredictions } from '../../../../../lib/database/db-utils';


export const dynamic = 'force-dynamic';

// POST - Test model performance on historical data
// Query parameters:
// - selectedFeatures: Comma-separated list of features to use (default: all)
// - epochs: Number of training epochs (default: 150)
// - batchSize: Training batch size (default: 1024)
export async function POST(request: Request) {
  try {
    console.log('[MLP Test] Starting model performance test...');

    // Parse configuration parameters
    const { searchParams } = new URL(request.url);
    const selectedFeaturesParam = searchParams.get('selectedFeatures');
    const epochsParam = searchParams.get('epochs');
    const batchSizeParam = searchParams.get('batchSize');

    // Default features
    const allFeatures = [
      'home_advantage',
      'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
      'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
      'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
      'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
      'avg_goals_league', 'hours_since_last_match_home', 'hours_since_last_match_away',
      'elo_home', 'elo_away', 'league_elo'
    ];

    // Parse selected features
    let features = allFeatures;
    if (selectedFeaturesParam) {
      const requestedFeatures = selectedFeaturesParam.split(',').map(f => f.trim());
      // Only include features that exist in our available features
      features = requestedFeatures.filter(f => allFeatures.includes(f));
      if (features.length === 0) {
        features = allFeatures; // fallback to all if none valid
      }
    }

    // Parse MLP config
    const epochs = epochsParam ? parseInt(epochsParam) : 150;
    const batchSize = batchSizeParam ? parseInt(batchSizeParam) : 1024;

    console.log(`[MLP Test] Config: features=${features.length}, epochs=${epochs}, batchSize=${batchSize}`);

    // Fetch all past fixtures with stats for testing
    const fixturesQuery = `
      SELECT DISTINCT ON (f.id)
        f.id,
        f.home_team_name,
        f.away_team_name,
        f.goals_home,
        f.goals_away,
        f.xg_home,
        f.xg_away,
        f.market_xg_home,
        f.market_xg_away,
        s.home_advantage,
        s.adjusted_rolling_xg_home,
        s.adjusted_rolling_xga_home,
        s.adjusted_rolling_xg_away,
        s.adjusted_rolling_xga_away,
        s.adjusted_rolling_market_xg_home,
        s.adjusted_rolling_market_xga_home,
        s.adjusted_rolling_market_xg_away,
        s.adjusted_rolling_market_xga_away,
        s.avg_goals_league,
        s.hours_since_last_match_home,
        s.hours_since_last_match_away,
        s.elo_home,
        s.elo_away,
        s.league_elo
      FROM football_fixtures f
      INNER JOIN football_stats s ON f.id = s.fixture_id
      WHERE LOWER(f.status_short) IN ('ft', 'aet', 'pen')
        AND f.goals_home IS NOT NULL
        AND f.goals_away IS NOT NULL
        AND f.season >= 2022
      ORDER BY f.id, f.date ASC
    `;

    const fixturesResult = await pool.query(fixturesQuery);
    const allFixtures = fixturesResult.rows;

    if (allFixtures.length === 0) {
      return NextResponse.json(
        { error: 'No past fixtures found for testing' },
        { status: 404 }
      );
    }

    console.log(`[MLP Test] Found ${allFixtures.length} past fixtures for testing`);

    // Split data: 80% for training/validation, 20% for testing
    const testSize = Math.floor(allFixtures.length * 0.2);
    const trainSize = allFixtures.length - testSize;

    const trainData = allFixtures.slice(0, trainSize);
    const testData = allFixtures.slice(trainSize);

    console.log(`[MLP Test] Training on ${trainData.length} fixtures, testing on ${testData.length} fixtures`);

    // Train model and make predictions with full evaluation metrics
    console.log('[MLP Test] Training model and evaluating performance...');
    const result = await trainAndPredict({
      trainingData: trainData,
      predictionData: testData,
      features,
      epochs,
      batchSize,
      calculateMetrics: true
    });

    // Save test predictions to database
    const savedCount = await savePredictions(result.predictions);
    console.log(`[MLP Test] Saved ${savedCount} test predictions to database`);

    // Clean up TensorFlow resources
    result.modelData.model.dispose();
    result.modelData.minVals.dispose();
    result.modelData.maxVals.dispose();
    result.modelData.range.dispose();

    console.log(`[MLP Test] Test completed with comprehensive evaluation metrics`);

    return NextResponse.json({
      success: true,
      message: 'Model performance test completed successfully',
      config: {
        features,
        epochs,
        batchSize
      },
      metrics: result.metrics,
      data: {
        totalFixtures: allFixtures.length,
        trainFixtures: trainData.length,
        testFixtures: testData.length,
        predictionsSaved: savedCount
      },
      modelStats: result.modelData.stats
    });

  } catch (error) {
    console.error('[MLP Test] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Test failed' },
      { status: 500 }
    );
  }
}
