import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/database/db-utils';
import { createSuccessResponse } from '@/lib/utils/api-utils';


interface League {
  id: number;
  name: string;
  type: string;
  country: string;
  seasons: Record<string, any>;
  xg_source: Record<string, any>;
  updated_at: string;
  pinnacle_league_id?: number;
  betfair_competition_id?: number;
  veikkaus_league_id?: number;
  monaco_eventGroup?: string;
}

async function getLeagues(_request: Request) {
  const result = await executeQuery<League>('SELECT * FROM football_leagues ORDER BY name');
  return createSuccessResponse({ leagues: result.rows });
}

export const GET = withErrorHandler(getLeagues);

