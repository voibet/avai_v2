import { NextResponse } from 'next/server';
import pool from '../../../../lib/database/db';
import { trainModel, makePredictions } from '../../../../lib/ml/ml-trainer';


export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 minutes timeout for training

// POST - Train model and evaluate on test set
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      batchSize = 1024, 
      epochs = 150, 
      features = [
        'home_advantage',
        'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
        'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
        'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
        'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
        'avg_goals_league'
      ]
    } = body;

    console.log('Starting MLP test training...');
    console.log(`Hyperparameters: batchSize=${batchSize}, epochs=${epochs}`);
    console.log(`Features (${features.length}):`, features);

    // Build feature selection SQL
    const allFeatureColumns = features.map((f: string) => `s.${f}`).join(',\n        ');
    
    // Fetch ALL FT fixtures with stats
    const dataQuery = `
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
        ${allFeatureColumns}
      FROM football_fixtures f
      INNER JOIN football_stats s ON f.id = s.fixture_id
      WHERE f.status_short = 'FT'
        AND f.goals_home IS NOT NULL
        AND f.goals_away IS NOT NULL
        AND f.season >= 2022
      ORDER BY f.id, f.date ASC
      LIMIT 100000
    `;

    const dataResult = await pool.query(dataQuery);
    console.log(`Fetched ${dataResult.rows.length} FT fixtures`);

    if (dataResult.rows.length < 100) {
      throw new Error('Insufficient data for training');
    }

    // Split into 80% training, 20% test
    const splitIndex = Math.floor(dataResult.rows.length * 0.8);
    const trainingData = dataResult.rows.slice(0, splitIndex);
    const testData = dataResult.rows.slice(splitIndex);

    console.log(`Training set: ${trainingData.length} fixtures`);
    console.log(`Test set: ${testData.length} fixtures`);

    // Train model
    const modelData = await trainModel(trainingData, features);
    console.log(`Model trained with final loss: ${modelData.stats.finalLoss.toFixed(4)}`);

    // Make predictions on test set
    const predictions = await makePredictions(
      modelData.model,
      modelData.minVals,
      modelData.maxVals,
      modelData.range,
      features,
      testData
    );

    console.log(`Generated ${predictions.length} test predictions`);

    // Calculate evaluation metrics
    const evaluations = predictions.map(pred => {
      const actual = testData.find(d => d.id === pred.id);
      if (!actual) return null;

      return {
        id: pred.id,
        home_team_name: pred.home_team_name,
        away_team_name: pred.away_team_name,
        predicted_home: pred.predicted_home,
        predicted_away: pred.predicted_away,
        actual_home: Number(actual.goals_home),
        actual_away: Number(actual.goals_away),
        xg_home: actual.xg_home != null ? Number(actual.xg_home) : null,
        xg_away: actual.xg_away != null ? Number(actual.xg_away) : null,
        market_xg_home: actual.market_xg_home != null ? Number(actual.market_xg_home) : null,
        market_xg_away: actual.market_xg_away != null ? Number(actual.market_xg_away) : null,
        // Errors vs actual score
        error_home_actual: Math.abs(pred.predicted_home - actual.goals_home),
        error_away_actual: Math.abs(pred.predicted_away - actual.goals_away),
        error_total_actual: Math.abs(pred.predicted_home - actual.goals_home) + 
                           Math.abs(pred.predicted_away - actual.goals_away),
        // Errors vs xG (if available)
        error_home_xg: actual.xg_home != null ? Math.abs(pred.predicted_home - actual.xg_home) : null,
        error_away_xg: actual.xg_away != null ? Math.abs(pred.predicted_away - actual.xg_away) : null,
        error_total_xg: (actual.xg_home != null && actual.xg_away != null) ?
                       Math.abs(pred.predicted_home - actual.xg_home) + 
                       Math.abs(pred.predicted_away - actual.xg_away) : null,
        // Errors vs market xG (if available)
        error_home_market_xg: actual.market_xg_home != null ? 
                             Math.abs(pred.predicted_home - actual.market_xg_home) : null,
        error_away_market_xg: actual.market_xg_away != null ? 
                             Math.abs(pred.predicted_away - actual.market_xg_away) : null,
        error_total_market_xg: (actual.market_xg_home != null && actual.market_xg_away != null) ?
                              Math.abs(pred.predicted_home - actual.market_xg_home) + 
                              Math.abs(pred.predicted_away - actual.market_xg_away) : null,
        // Market xG errors vs actual score
        market_xg_error_home_actual: actual.market_xg_home != null ?
                                     Math.abs(actual.market_xg_home - actual.goals_home) : null,
        market_xg_error_away_actual: actual.market_xg_away != null ?
                                     Math.abs(actual.market_xg_away - actual.goals_away) : null,
        market_xg_error_total_actual: (actual.market_xg_home != null && actual.market_xg_away != null) ?
                                      Math.abs(actual.market_xg_home - actual.goals_home) +
                                      Math.abs(actual.market_xg_away - actual.goals_away) : null,
        // Market xG errors vs actual xG
        market_xg_error_home_xg: (actual.market_xg_home != null && actual.xg_home != null) ?
                                 Math.abs(actual.market_xg_home - actual.xg_home) : null,
        market_xg_error_away_xg: (actual.market_xg_away != null && actual.xg_away != null) ?
                                 Math.abs(actual.market_xg_away - actual.xg_away) : null,
        market_xg_error_total_xg: (actual.market_xg_home != null && actual.market_xg_away != null && 
                                   actual.xg_home != null && actual.xg_away != null) ?
                                  Math.abs(actual.market_xg_home - actual.xg_home) +
                                  Math.abs(actual.market_xg_away - actual.xg_away) : null,
      };
    }).filter(e => e !== null);

    // Calculate aggregate metrics
    const metrics = {
      test_size: evaluations.length,
      // MAE (Mean Absolute Error) vs actual scores
      mae_home_actual: evaluations.reduce((sum, e) => sum + e.error_home_actual, 0) / evaluations.length,
      mae_away_actual: evaluations.reduce((sum, e) => sum + e.error_away_actual, 0) / evaluations.length,
      mae_total_actual: evaluations.reduce((sum, e) => sum + e.error_total_actual, 0) / evaluations.length,
      // MAE vs xG
      mae_home_xg: evaluations.filter(e => e.error_home_xg != null).length > 0 ?
                   evaluations.filter(e => e.error_home_xg != null)
                             .reduce((sum, e) => sum + e.error_home_xg!, 0) / 
                   evaluations.filter(e => e.error_home_xg != null).length : null,
      mae_away_xg: evaluations.filter(e => e.error_away_xg != null).length > 0 ?
                   evaluations.filter(e => e.error_away_xg != null)
                             .reduce((sum, e) => sum + e.error_away_xg!, 0) / 
                   evaluations.filter(e => e.error_away_xg != null).length : null,
      mae_total_xg: evaluations.filter(e => e.error_total_xg != null).length > 0 ?
                    evaluations.filter(e => e.error_total_xg != null)
                              .reduce((sum, e) => sum + e.error_total_xg!, 0) / 
                    evaluations.filter(e => e.error_total_xg != null).length : null,
      // MAE vs market xG
      mae_home_market_xg: evaluations.filter(e => e.error_home_market_xg != null).length > 0 ?
                          evaluations.filter(e => e.error_home_market_xg != null)
                                    .reduce((sum, e) => sum + e.error_home_market_xg!, 0) / 
                          evaluations.filter(e => e.error_home_market_xg != null).length : null,
      mae_away_market_xg: evaluations.filter(e => e.error_away_market_xg != null).length > 0 ?
                          evaluations.filter(e => e.error_away_market_xg != null)
                                    .reduce((sum, e) => sum + e.error_away_market_xg!, 0) / 
                          evaluations.filter(e => e.error_away_market_xg != null).length : null,
      mae_total_market_xg: evaluations.filter(e => e.error_total_market_xg != null).length > 0 ?
                           evaluations.filter(e => e.error_total_market_xg != null)
                                     .reduce((sum, e) => sum + e.error_total_market_xg!, 0) / 
                           evaluations.filter(e => e.error_total_market_xg != null).length : null,
      // Market xG MAE vs actual scores
      mae_market_xg_home_actual: evaluations.filter(e => e.market_xg_error_home_actual != null).length > 0 ?
                                 evaluations.filter(e => e.market_xg_error_home_actual != null)
                                           .reduce((sum, e) => sum + e.market_xg_error_home_actual!, 0) /
                                 evaluations.filter(e => e.market_xg_error_home_actual != null).length : null,
      mae_market_xg_away_actual: evaluations.filter(e => e.market_xg_error_away_actual != null).length > 0 ?
                                 evaluations.filter(e => e.market_xg_error_away_actual != null)
                                           .reduce((sum, e) => sum + e.market_xg_error_away_actual!, 0) /
                                 evaluations.filter(e => e.market_xg_error_away_actual != null).length : null,
      mae_market_xg_total_actual: evaluations.filter(e => e.market_xg_error_total_actual != null).length > 0 ?
                                  evaluations.filter(e => e.market_xg_error_total_actual != null)
                                            .reduce((sum, e) => sum + e.market_xg_error_total_actual!, 0) /
                                  evaluations.filter(e => e.market_xg_error_total_actual != null).length : null,
      // Market xG MAE vs actual xG
      mae_market_xg_home_xg: evaluations.filter(e => e.market_xg_error_home_xg != null).length > 0 ?
                             evaluations.filter(e => e.market_xg_error_home_xg != null)
                                       .reduce((sum, e) => sum + e.market_xg_error_home_xg!, 0) /
                             evaluations.filter(e => e.market_xg_error_home_xg != null).length : null,
      mae_market_xg_away_xg: evaluations.filter(e => e.market_xg_error_away_xg != null).length > 0 ?
                             evaluations.filter(e => e.market_xg_error_away_xg != null)
                                       .reduce((sum, e) => sum + e.market_xg_error_away_xg!, 0) /
                             evaluations.filter(e => e.market_xg_error_away_xg != null).length : null,
      mae_market_xg_total_xg: evaluations.filter(e => e.market_xg_error_total_xg != null).length > 0 ?
                              evaluations.filter(e => e.market_xg_error_total_xg != null)
                                        .reduce((sum, e) => sum + e.market_xg_error_total_xg!, 0) /
                              evaluations.filter(e => e.market_xg_error_total_xg != null).length : null,
      // Average values for comparison
      avg_predicted_home: evaluations.reduce((sum, e) => sum + e.predicted_home, 0) / evaluations.length,
      avg_predicted_away: evaluations.reduce((sum, e) => sum + e.predicted_away, 0) / evaluations.length,
      avg_predicted_total: evaluations.reduce((sum, e) => sum + e.predicted_home + e.predicted_away, 0) / evaluations.length,
      avg_actual_home: evaluations.reduce((sum, e) => sum + e.actual_home, 0) / evaluations.length,
      avg_actual_away: evaluations.reduce((sum, e) => sum + e.actual_away, 0) / evaluations.length,
      avg_actual_total: evaluations.reduce((sum, e) => sum + e.actual_home + e.actual_away, 0) / evaluations.length,
      avg_xg_home: evaluations.filter(e => e.xg_home != null).length > 0 ?
                   evaluations.filter(e => e.xg_home != null).reduce((sum, e) => sum + e.xg_home!, 0) /
                   evaluations.filter(e => e.xg_home != null).length : null,
      avg_xg_away: evaluations.filter(e => e.xg_away != null).length > 0 ?
                   evaluations.filter(e => e.xg_away != null).reduce((sum, e) => sum + e.xg_away!, 0) /
                   evaluations.filter(e => e.xg_away != null).length : null,
      avg_xg_total: evaluations.filter(e => e.xg_home != null && e.xg_away != null).length > 0 ?
                    evaluations.filter(e => e.xg_home != null && e.xg_away != null)
                              .reduce((sum, e) => sum + e.xg_home! + e.xg_away!, 0) /
                    evaluations.filter(e => e.xg_home != null && e.xg_away != null).length : null,
      avg_market_xg_home: evaluations.filter(e => e.market_xg_home != null).length > 0 ?
                          evaluations.filter(e => e.market_xg_home != null).reduce((sum, e) => sum + e.market_xg_home!, 0) /
                          evaluations.filter(e => e.market_xg_home != null).length : null,
      avg_market_xg_away: evaluations.filter(e => e.market_xg_away != null).length > 0 ?
                          evaluations.filter(e => e.market_xg_away != null).reduce((sum, e) => sum + e.market_xg_away!, 0) /
                          evaluations.filter(e => e.market_xg_away != null).length : null,
      avg_market_xg_total: evaluations.filter(e => e.market_xg_home != null && e.market_xg_away != null).length > 0 ?
                           evaluations.filter(e => e.market_xg_home != null && e.market_xg_away != null)
                                     .reduce((sum, e) => sum + e.market_xg_home! + e.market_xg_away!, 0) /
                           evaluations.filter(e => e.market_xg_home != null && e.market_xg_away != null).length : null,
    };

    console.log('Evaluation metrics:', metrics);

    return NextResponse.json({
      success: true,
      stats: modelData.stats,
      metrics,
      evaluations,
      config: {
        batchSize,
        epochs,
        features
      }
    });
  } catch (error) {
    console.error('MLP test training error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Training failed' },
      { status: 500 }
    );
  }
}

