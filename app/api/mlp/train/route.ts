import { NextResponse } from 'next/server';
import pool from '../../../../lib/db';
import { isCurrentlyTraining, setTrainingFlag } from '../../../../lib/ml-cache';
import { startTrainingWorker } from '../../../../lib/ml-worker';


export const dynamic = 'force-dynamic';

// POST - Start model training in background worker
export async function POST() {
  try {
    if (isCurrentlyTraining()) {
      return NextResponse.json(
        { error: 'Training already in progress' },
        { status: 429 }
      )
    }

    setTrainingFlag(true)
    console.log('Starting training in background worker...')

    // Fetch training data: finished fixtures with stats
    const trainingQuery = `
      SELECT DISTINCT ON (f.id)
        f.id,
        f.home_team_name,
        f.away_team_name,
        f.goals_home,
        f.goals_away,
        s.home_advantage,
        s.adjusted_rolling_xg_home,
        s.adjusted_rolling_xga_home,
        s.adjusted_rolling_xg_away,
        s.adjusted_rolling_xga_away,
        s.avg_goals_league,
        s.adjusted_rolling_market_xg_home,
        s.adjusted_rolling_market_xga_home,
        s.adjusted_rolling_market_xg_away,
        s.adjusted_rolling_market_xga_away
      FROM football_fixtures f
      INNER JOIN football_stats s ON f.id = s.fixture_id
      WHERE f.status_short = 'FT'
        AND f.goals_home IS NOT NULL
        AND f.goals_away IS NOT NULL
        AND f.season >= 2022
      ORDER BY f.id, f.date ASC
      LIMIT 100000
    `;

    // Fetch prediction data: upcoming fixtures with stats
    const predictionQuery = `
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
      ORDER BY f.id, f.date ASC
      LIMIT 100000
    `;

    const [trainingResult, predictionResult] = await Promise.all([
      pool.query(trainingQuery),
      pool.query(predictionQuery)
    ]);

    console.log(`Fetched ${trainingResult.rows.length} training fixtures`)
    console.log(`Fetched ${predictionResult.rows.length} prediction fixtures`)

    const features = ['home_advantage', 'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
                      'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
                      'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
                      'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
                      'avg_goals_league'];

    // Start training in background worker (non-blocking)
    startTrainingWorker(
      trainingResult.rows,
      predictionResult.rows,
      features
    );

    // Return immediately
    return NextResponse.json({
      success: true,
      message: 'Training started in background. Check console logs for progress.',
      trainingSize: trainingResult.rows.length,
      predictionSize: predictionResult.rows.length
    })
  } catch (error) {
    setTrainingFlag(false)
    console.error('Training initialization error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start training' },
      { status: 500 }
    );
  }
}

