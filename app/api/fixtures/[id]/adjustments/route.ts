import { NextResponse } from 'next/server';
import pool from '@/lib/database/db.ts';
import { calculateOddsFromPredictions } from '@/lib/calculations/prediction-odds';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const fixtureId = BigInt(params.id);

    // Fetch existing adjustments
    const result = await pool.query(
      `SELECT 
        home_adjustment,
        draw_adjustment,
        away_adjustment,
        adjustment_reason
      FROM football_predictions
      WHERE fixture_id = $1`,
      [fixtureId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        adjustments: null
      });
    }

    return NextResponse.json({
      adjustments: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching adjustments:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const fixtureId = BigInt(params.id);
    const body = await request.json();
    const { homeAdjustment, drawAdjustment, awayAdjustment, reason } = body;

    // Save adjustments to football_predictions table
    const adjustmentResponse = await pool.query(
      `INSERT INTO football_predictions (
        fixture_id,
        home_adjustment,
        draw_adjustment,
        away_adjustment,
        adjustment_reason,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (fixture_id)
      DO UPDATE SET
        home_adjustment = COALESCE($2::numeric, football_predictions.home_adjustment),
        draw_adjustment = COALESCE($3::numeric, football_predictions.draw_adjustment),
        away_adjustment = COALESCE($4::numeric, football_predictions.away_adjustment),
        adjustment_reason = COALESCE($5::text, football_predictions.adjustment_reason),
        updated_at = NOW()
      RETURNING fixture_id`,
      [
        fixtureId,
        homeAdjustment ? parseFloat(homeAdjustment) : null,
        drawAdjustment ? parseFloat(drawAdjustment) : null,
        awayAdjustment ? parseFloat(awayAdjustment) : null,
        reason || null
      ]
    );

    if (adjustmentResponse.rows.length === 0) {
      return NextResponse.json(
        { error: 'Failed to save adjustments' },
        { status: 400 }
      );
    }

    // Recalculate odds for this fixture
    await calculateOddsFromPredictions([Number(fixtureId)]);

    return NextResponse.json({
      success: true,
      message: 'Adjustments saved and odds recalculated'
    });
  } catch (error) {
    console.error('Error saving adjustments:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
