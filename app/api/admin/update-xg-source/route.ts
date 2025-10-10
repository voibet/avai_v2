import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/database/db-utils';

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

    // Initialize season data if it doesn't exist
    if (!currentXGSource[season]) {
      currentXGSource[season] = { rounds: {} };
    }

    // Add or update only the specified rounds with the provided xg_source URL
    // This allows multiple different xG sources for different rounds in the same season
    rounds.forEach((round: string) => {
      currentXGSource[season].rounds[round] = {
        url: xgSource
      };
    });

    // If no rounds are selected and no rounds exist, remove the entire season entry
    if (rounds.length === 0 && Object.keys(currentXGSource[season].rounds).length === 0) {
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

async function removeXGSourceRounds(request: Request) {
  try {
    const body = await request.json();
    const { leagueId, season, rounds } = body;

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

    // Check if season exists
    if (!currentXGSource[season]) {
      return NextResponse.json(
        { success: false, message: `No xG source configuration found for season ${season}` },
        { status: 404 }
      );
    }

    // Remove the specified rounds
    rounds.forEach((round: string) => {
      delete currentXGSource[season].rounds[round];
    });

    // If no rounds left in the season, remove the season entry
    if (Object.keys(currentXGSource[season].rounds).length === 0) {
      delete currentXGSource[season];
    }

    // Update the league with new xg_source data
    await executeQuery(
      'UPDATE football_leagues SET xg_source = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(currentXGSource), leagueId]
    );

    return NextResponse.json({
      success: true,
      message: `Successfully removed ${rounds.length} round(s) from season ${season}`
    });

  } catch (error) {
    console.error('Failed to remove XG source rounds:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to remove XG source rounds: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const POST = withErrorHandler(updateXGSource);
export const DELETE = withErrorHandler(removeXGSourceRounds);
