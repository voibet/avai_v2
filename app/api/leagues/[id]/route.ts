import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../lib/db-utils';
import { League } from '../../../../types/database';

async function getLeagueDetails(request: Request, { params }: { params: { id: string } }) {
  const leagueId = parseInt(params.id);

  // Get league details
  const leagueResult = await executeQuery<League>(
    'SELECT * FROM football_leagues WHERE id = $1',
    [leagueId]
  );

  if (leagueResult.rows.length === 0) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const league = leagueResult.rows[0];

  // Get available seasons for this league
  const seasonsResult = await executeQuery(
    'SELECT DISTINCT season FROM football_fixtures WHERE league_id = $1 ORDER BY season DESC',
    [leagueId]
  );

  const seasons = seasonsResult.rows.map(row => row.season);

  return NextResponse.json({
    league,
    seasons
  });
}

export const GET = withErrorHandler(getLeagueDetails);
