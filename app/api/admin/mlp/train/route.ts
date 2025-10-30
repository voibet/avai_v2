import { NextResponse } from 'next/server';
import pool from '../../../../../lib/database/db';
import { isCurrentlyTraining, setTrainingFlag } from '../../../../../lib/ml/ml-cache';
import { startTrainingWorker } from '../../../../../lib/ml/ml-worker';
import { IN_FUTURE } from '../../../../../lib/constants';


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
    console.log('[Train] Starting training in background worker...')

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
        s.adjusted_rolling_market_xga_away,
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
        s.avg_goals_league,
        s.hours_since_last_match_home,
        s.hours_since_last_match_away,
        s.elo_home,
        s.elo_away,
        s.league_elo
      FROM football_fixtures f
      INNER JOIN football_stats s ON f.id = s.fixture_id
      WHERE LOWER(f.status_short) = ANY($1)
      ORDER BY f.id, f.date ASC
      LIMIT 100000
    `;

    const [trainingResult, predictionResult] = await Promise.all([
      pool.query(trainingQuery),
      pool.query(predictionQuery, [IN_FUTURE])
    ]);

    console.log(`[Train] Fetched ${trainingResult.rows.length} training fixtures`)
    console.log(`[Train] Fetched ${predictionResult.rows.length} prediction fixtures`)

    const features = ['home_advantage', 'adjusted_rolling_xg_home', 'adjusted_rolling_xga_home',
                      'adjusted_rolling_xg_away', 'adjusted_rolling_xga_away',
                      'adjusted_rolling_market_xg_home', 'adjusted_rolling_market_xga_home',
                      'adjusted_rolling_market_xg_away', 'adjusted_rolling_market_xga_away',
                      'avg_goals_league', 'hours_since_last_match_home', 'hours_since_last_match_away',
                      'elo_home', 'elo_away', 'league_elo'];

    // Start training in background worker (non-blocking)
    startTrainingWorker(
      trainingResult.rows,
      predictionResult.rows,
      features
    );

    // Return immediately
    return NextResponse.json({
      success: true,
      message: 'Training started in background. Model will be saved to disk when complete.',
      trainingSize: trainingResult.rows.length,
      predictionSize: predictionResult.rows.length
    })
  } catch (error) {
    setTrainingFlag(false)
    console.error('[Train] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Training failed' },
      { status: 500 }
    );
  }
}

