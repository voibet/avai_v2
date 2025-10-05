import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/db-utils';


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
}

async function getLeagues(_request: Request) {
  try {
    const result = await executeQuery<League>('SELECT * FROM football_leagues ORDER BY name');

    return NextResponse.json({
      success: true,
      leagues: result.rows
    });

  } catch (error) {
    console.error('Failed to fetch leagues:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to fetch leagues: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getLeagues);

