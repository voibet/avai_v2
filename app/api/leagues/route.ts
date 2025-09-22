import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../lib/db-utils';
import { League } from '../../../types/database';

async function getLeagues(request: Request) {
  const result = await executeQuery<League>('SELECT * FROM football_leagues ORDER BY name');

  const leagues: League[] = result.rows;

  return NextResponse.json(leagues);
}

export const GET = withErrorHandler(getLeagues);
