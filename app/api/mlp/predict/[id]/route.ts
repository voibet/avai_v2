import { NextResponse } from 'next/server';
import pool from '../../../../../lib/database/db';
import { makePredictions } from '../../../../../lib/ml/ml-trainer';
import { getCachedModel, hasCachedModel } from '../../../../../lib/ml/ml-cache';
import { savePredictions } from '../../../../../lib/database/db-utils';


export const dynamic = 'force-dynamic';

// GET - Predict single fixture by ID
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const fixtureId = parseInt(params.id)
    
    if (isNaN(fixtureId)) {
      return NextResponse.json(
        { error: 'Invalid fixture ID' },
        { status: 400 }
      )
    }

    // Check if model is cached
    const hasModel = await hasCachedModel();
    if (!hasModel) {
      return NextResponse.json(
        { error: 'No model cached. Train a model first at /api/mlp/train' },
        { status: 404 }
      )
    }

    const modelData = await getCachedModel();
    if (!modelData) {
      return NextResponse.json(
        { error: 'Failed to load model from cache.' },
        { status: 500 }
      )
    }

    // Fetch single fixture data
    const query = `
      SELECT DISTINCT ON (f.id)
        f.id,
        f.home_team_name,
        f.away_team_name,
        f.status_short,
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
      WHERE f.id = $1
      ORDER BY f.id
    `

    const result = await pool.query(query, [fixtureId])

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Fixture not found' },
        { status: 404 }
      )
    }

    const fixture = result.rows[0]

    // Check if fixture has all required features
    const missingFeatures = modelData.features.filter(
      feat => fixture[feat] == null
    )

    if (missingFeatures.length > 0) {
      return NextResponse.json(
        { 
          error: 'Fixture missing required features',
          missingFeatures
        },
        { status: 400 }
      )
    }

    // Make prediction
    const predictions = await makePredictions(
      modelData.model,
      modelData.minVals,
      modelData.maxVals,
      modelData.range,
      modelData.features,
      [fixture]
    )

    if (predictions.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate prediction' },
        { status: 500 }
      )
    }

    console.log(`✓ Fixture ${fixtureId} prediction: ${fixture.home_team_name} ${predictions[0].predicted_home.toFixed(2)} - ${predictions[0].predicted_away.toFixed(2)} ${fixture.away_team_name}`)

    // Save prediction to database
    const savedCount = await savePredictions(predictions)
    console.log(`✓ Saved prediction to database`)

    return NextResponse.json({
      success: true,
      fixture: {
        id: fixture.id,
        home_team: fixture.home_team_name,
        away_team: fixture.away_team_name,
        status: fixture.status_short
      },
      prediction: {
        home_goals: predictions[0].predicted_home,
        away_goals: predictions[0].predicted_away
      },
      modelStats: modelData.stats,
      saved: savedCount === 1
    })

  } catch (error) {
    console.error('Single fixture prediction error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prediction failed' },
      { status: 500 }
    );
  }
}

