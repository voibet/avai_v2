import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/db-utils';

async function getAdminLeagues(_request: Request) {
  // Get leagues with their season data and xg_source information
  const query = `
    SELECT
      id,
      name,
      country,
      seasons,
      xg_source,
      created_at,
      updated_at
    FROM football_leagues
    ORDER BY name
  `;

  const result = await executeQuery(query);
  const leagues = result.rows;

  return NextResponse.json({
    leagues: leagues
  });
}

export const GET = withErrorHandler(getAdminLeagues);
