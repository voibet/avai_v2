import { NextResponse } from 'next/server';
import pool from '../../../../../lib/database/db';
import { startTestWorker } from '../../../../../lib/ml/ml-worker';


export const dynamic = 'force-dynamic';

// POST - Train model and evaluate on test set in background
export async function POST(request: Request) {
  try {
    // Parse body with defaults if empty
    let body: any = {};
    try {
      body = await request.json();
    } catch (e) {
      // Empty body is fine, use defaults
    }
    
    const {
      batchSize = 1024,
      epochs = 150,
      features = [
        'home_advantage',
        'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
        'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
        'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
        'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
        'avg_goals_league', 'hours_since_last_match_home', 'hours_since_last_match_away',
        'elo_home', 'elo_away', 'league_elo'
      ]
    } = body;

    console.log('[Test] Starting test training...');
    console.log(`[Test] Hyperparameters: batchSize=${batchSize}, epochs=${epochs}`);
    console.log(`[Test] Features (${features.length}):`, features);

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
    console.log(`[Test] Fetched ${dataResult.rows.length} FT fixtures`);

    if (dataResult.rows.length < 100) {
      throw new Error('Insufficient data for training');
    }

    // Split into 80% training, 20% test
    const splitIndex = Math.floor(dataResult.rows.length * 0.8);
    const trainingData = dataResult.rows.slice(0, splitIndex);
    const testData = dataResult.rows.slice(splitIndex);

    console.log(`[Test] Training set: ${trainingData.length} fixtures`);
    console.log(`[Test] Test set: ${testData.length} fixtures`);

    // Start test training in background process
    startTestWorker(trainingData, testData, features, batchSize, epochs);

    // Return immediately
    return NextResponse.json({
      success: true,
      message: 'Test training started in background. Check console logs for metrics.',
      config: {
        features,
        trainingSize: trainingData.length,
        testSize: testData.length
      }
    });
  } catch (error) {
    console.error('[Test] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Test failed' },
      { status: 500 }
    );
  }
}

