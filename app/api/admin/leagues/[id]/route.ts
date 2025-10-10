import { NextResponse } from 'next/server';
import { executeTransaction, withErrorHandler } from '@/lib/database/db-utils';

async function deleteLeague(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const leagueId = parseInt(params.id);

    if (isNaN(leagueId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid league ID' },
        { status: 400 }
      );
    }

    // Check if league exists
    const leagueCheck = await executeTransaction([{
      query: 'SELECT id FROM football_leagues WHERE id = $1',
      params: [leagueId]
    }]);

    if (leagueCheck[0].rowCount === 0) {
      return NextResponse.json(
        { success: false, message: 'League not found' },
        { status: 404 }
      );
    }

    // Delete league and all associated data in a transaction
    // Note: Foreign key constraints should handle cascading deletes
    const queries = [
      // Delete predictions first (references fixtures)
      {
        query: 'DELETE FROM football_predictions WHERE fixture_id IN (SELECT id FROM football_fixtures WHERE league_id = $1)',
        params: [leagueId]
      },
      // Delete odds (references fixtures)
      {
        query: 'DELETE FROM football_odds WHERE fixture_id IN (SELECT id FROM football_fixtures WHERE league_id = $1)',
        params: [leagueId]
      },
      // Delete fixtures
      {
        query: 'DELETE FROM football_fixtures WHERE league_id = $1',
        params: [leagueId]
      },
      // Delete league
      {
        query: 'DELETE FROM football_leagues WHERE id = $1',
        params: [leagueId]
      }
    ];

    const results = await executeTransaction(queries);

    // Check if any deletions actually occurred
    const totalDeleted = results.reduce((sum: number, result: { rowCount?: number }) => sum + (result.rowCount || 0), 0);

    if (totalDeleted === 0) {
      return NextResponse.json(
        { success: false, message: 'League not found or already deleted' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'League and all associated data deleted successfully'
    });

  } catch (error) {
    console.error('Failed to delete league:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to delete league: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const DELETE = withErrorHandler(deleteLeague);
