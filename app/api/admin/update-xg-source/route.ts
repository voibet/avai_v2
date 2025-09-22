import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/db-utils';

async function updateXGSource(request: Request) {
  try {
    const body = await request.json();
    const { leagueId, season, rounds, xgSource } = body;

    if (!leagueId || !season || !rounds || !Array.isArray(rounds)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required parameters: leagueId, season, rounds'
        },
        { status: 400 }
      );
    }

    // Get current league data
    const leagueResult = await executeQuery(
      'SELECT xg_source FROM football_leagues WHERE id = $1',
      [leagueId]
    );

    if (leagueResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'League not found' },
        { status: 404 }
      );
    }

    // Parse current xg_source data
    let currentXGSource: Record<string, { rounds: Record<string, { url: string }> }> = {};
    if (leagueResult.rows[0].xg_source) {
      currentXGSource = typeof leagueResult.rows[0].xg_source === 'string'
        ? JSON.parse(leagueResult.rows[0].xg_source)
        : leagueResult.rows[0].xg_source;
    }

    // Initialize season data if it doesn't exist, or clear existing rounds to replace configuration
    if (!currentXGSource[season]) {
      currentXGSource[season] = { rounds: {} };
    } else {
      // Clear all existing rounds for this season to replace the configuration
      currentXGSource[season].rounds = {};
    }

    // Add only the newly selected rounds with the provided xg_source URL
    rounds.forEach((round: string) => {
      currentXGSource[season].rounds[round] = {
        url: xgSource
      };
    });

    // If no rounds are selected, remove the entire season entry
    if (rounds.length === 0) {
      delete currentXGSource[season];
    }

    // Update the league with new xg_source data
    await executeQuery(
      'UPDATE football_leagues SET xg_source = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(currentXGSource), leagueId]
    );

    return NextResponse.json({
      success: true,
      message: rounds.length > 0
        ? `Successfully updated XG source for ${rounds.length} round(s) in season ${season}`
        : `Successfully cleared all XG source configuration for season ${season}`
    });

  } catch (error) {
    console.error('Failed to update XG source:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to update XG source: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const POST = withErrorHandler(updateXGSource);
