// Shared MLP prediction logic
import pool from './db';
import { getCachedModel, hasCachedModel } from './ml-cache';
import { makePredictions } from './ml-trainer';
import { savePredictions } from './db-utils';


export interface PredictOptions {
  fixtureIds?: number[];
}

export interface PredictResult {
  success: boolean;
  message?: string;
  error?: string;
  fixtureCount: number;
  predictionsGenerated: number;
  predictionsSaved: number;
}

export async function predictFixtures(options: PredictOptions = {}): Promise<PredictResult> {
  const { fixtureIds } = options;

  // Check if model is cached
  const hasModel = await hasCachedModel();
  if (!hasModel) {
    return {
      success: false,
      error: 'No model cached. Please train the model first.',
      fixtureCount: 0,
      predictionsGenerated: 0,
      predictionsSaved: 0
    };
  }

  // Load model
  const modelData = await getCachedModel();
  if (!modelData) {
    return {
      success: false,
      error: 'Failed to load model from cache.',
      fixtureCount: 0,
      predictionsGenerated: 0,
      predictionsSaved: 0
    };
  }

  const features = modelData.features;

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
      s.avg_goals_league,
      s.hours_since_last_match_home,
      s.hours_since_last_match_away,
      s.elo_home,
      s.elo_away,
      s.league_elo
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

  const predictionResult = await pool.query(predictionQuery, params);

  if (predictionResult.rows.length === 0) {
    return {
      success: true,
      message: 'No fixtures found to predict',
      fixtureCount: 0,
      predictionsGenerated: 0,
      predictionsSaved: 0
    };
  }

  // Make predictions
  const predictions = await makePredictions(
    modelData.model,
    modelData.minVals,
    modelData.maxVals,
    modelData.range,
    features,
    predictionResult.rows
  );

  // Save to database
  const savedCount = await savePredictions(predictions);

  return {
    success: true,
    message: `Predictions completed for ${predictions.length} fixtures`,
    fixtureCount: predictionResult.rows.length,
    predictionsGenerated: predictions.length,
    predictionsSaved: savedCount
  };
}
