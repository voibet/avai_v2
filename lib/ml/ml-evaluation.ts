import { trainModel, makePredictions } from './ml-trainer';

interface EvaluationData {
  id: number;
  home_team_name: string;
  away_team_name: string;
  predicted_home: number;
  predicted_away: number;
  actual_home: number;
  actual_away: number;
  xg_home: number | null;
  xg_away: number | null;
  market_xg_home: number | null;
  market_xg_away: number | null;
  error_home_actual: number;
  error_away_actual: number;
  error_total_actual: number;
  error_home_xg: number | null;
  error_away_xg: number | null;
  error_total_xg: number | null;
  error_home_market_xg: number | null;
  error_away_market_xg: number | null;
  error_total_market_xg: number | null;
  market_xg_error_home_actual: number | null;
  market_xg_error_away_actual: number | null;
  market_xg_error_total_actual: number | null;
  market_xg_error_home_xg: number | null;
  market_xg_error_away_xg: number | null;
  market_xg_error_total_xg: number | null;
}

export interface TrainAndPredictOptions {
  trainingData: any[];
  predictionData: any[];
  features: string[];
  epochs?: number;
  batchSize?: number;
  calculateMetrics?: boolean;
  verbose?: boolean;
}

export interface TrainAndPredictResult {
  modelData: any;
  predictions: any[];
  evaluations?: EvaluationData[];
  metrics?: any;
}

/**
 * Shared function for training model and making predictions
 * Can be used for both production training and test evaluation
 */
export async function trainAndPredict(options: TrainAndPredictOptions): Promise<TrainAndPredictResult> {
  const {
    trainingData,
    predictionData,
    features,
    calculateMetrics = false,
    verbose = false
  } = options;

  console.log(`[Process] Starting ${calculateMetrics ? 'test' : 'training'} with ${trainingData.length} training fixtures, ${predictionData.length} prediction fixtures`);

  // Train model
  const epochs = options.epochs || 150;
  const batchSize = options.batchSize || 1024;
  console.log(`[Process] Training model with epochs=${epochs}, batchSize=${batchSize}, verbose=${verbose}`);
  const modelData = await trainModel(trainingData, features, epochs, batchSize, verbose);

  // Make predictions
  console.log(`[Process] Making predictions on ${predictionData.length} fixtures`);
  const predictions = await makePredictions(
    modelData.model,
    modelData.minVals,
    modelData.maxVals,
    modelData.range,
    features,
    predictionData
  );

  console.log(`[Process] Generated ${predictions.length} predictions`);

  // Calculate evaluation metrics if requested (for test mode)
  if (calculateMetrics) {
    console.log(`[Process] Calculating evaluation metrics for ${predictions.length} predictions`);
    const evaluations = predictions.map(pred => {
      const actual = predictionData.find(d => d.id === pred.id);
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
    }).filter(e => e !== null) as EvaluationData[];

    const metrics = calculateEvaluationMetrics(evaluations);
    console.log(`[Process] Calculated metrics:`, JSON.stringify(metrics, null, 2));

    return {
      modelData,
      predictions,
      evaluations,
      metrics
    };
  }

  return {
    modelData,
    predictions
  };
}

function calculateEvaluationMetrics(evaluations: EvaluationData[]) {
  return {
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
}

