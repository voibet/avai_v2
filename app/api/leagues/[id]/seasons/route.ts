import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../../lib/db-utils';

async function getLeagueSeasons(request: Request, { params }: { params: { id: string } }) {
  const leagueId = parseInt(params.id);

  // Get available seasons for this league
  const result = await executeQuery(
    'SELECT DISTINCT season FROM football_fixtures WHERE league_id = $1 ORDER BY season DESC',
    [leagueId]
  );

  const seasons = result.rows.map(row => row.season);

  return NextResponse.json(seasons);
}

export const GET = withErrorHandler(getLeagueSeasons);
