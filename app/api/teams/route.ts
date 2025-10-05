import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/db-utils';


interface Team {
  id: number;
  name: string;
  country: string;
  venue: string;
  created_at: string;
  updated_at: string;
}

async function getTeams(_request: Request) {
  try {
    const result = await executeQuery<Team>('SELECT * FROM football_teams ORDER BY name');

    return NextResponse.json({
      success: true,
      teams: result.rows
    });

  } catch (error) {
    console.error('Failed to fetch teams:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to fetch teams: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getTeams);

