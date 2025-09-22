import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../lib/db-utils';

async function getFixture(request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  const result = await executeQuery(
    'SELECT * FROM football_fixtures WHERE id = $1',
    [fixtureId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
  }

  return NextResponse.json({ fixture: result.rows[0] });
}

async function updateFixture(request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Build dynamic UPDATE query based on provided fields
    const updateFields = [];
    const queryParams = [];
    let paramIndex = 1;

    // Define allowed fields for updating
    const allowedFields = [
      'referee', 'timestamp', 'date', 'venue_name', 'status_long', 'status_short',
      'home_team_id', 'home_team_name', 'home_country',
      'away_team_id', 'away_team_name', 'away_country',
      'xg_home', 'xg_away', 'goals_home', 'goals_away',
      'score_halftime_home', 'score_halftime_away',
      'score_fulltime_home', 'score_fulltime_away',
      'score_extratime_home', 'score_extratime_away',
      'score_penalty_home', 'score_penalty_away',
      'league_id', 'league_name', 'league_country',
      'season', 'round'
    ];

    // Build SET clause dynamically
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramIndex}`);
        queryParams.push(value);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 });
    }

    // Execute update
    const updateQuery = `
      UPDATE football_fixtures
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    queryParams.push(fixtureId);

    const result = await executeQuery(updateQuery, queryParams);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }

    return NextResponse.json({ fixture: result.rows[0] });
  } catch (error) {
    console.error('Error updating fixture:', error);
    return NextResponse.json({ error: 'Failed to update fixture' }, { status: 500 });
  }
}

export const GET = withErrorHandler(getFixture);
export const PUT = withErrorHandler(updateFixture);
