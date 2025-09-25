import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../../lib/db-utils';


async function getFixtureOdds(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  const result = await executeQuery(
    'SELECT * FROM football_odds WHERE fixture_id = $1 ORDER BY bookie',
    [fixtureId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ odds: [] });
  }

  return NextResponse.json({ odds: result.rows });
}

export const GET = withErrorHandler(getFixtureOdds);
