import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/database/db-utils';
import { Team } from '@/types/database';

interface RouteParams {
  params: {
    id: string;
  };
}

async function getTeam(_request: Request, { params }: RouteParams) {
  try {
    const teamId = parseInt(params.id);

    if (isNaN(teamId)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid team ID'
        },
        { status: 400 }
      );
    }

    // Get the specific team
    const teamResult = await executeQuery<Team>('SELECT id, name, country, venue, mappings FROM football_teams WHERE id = $1', [teamId]);

    if (teamResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'Team not found'
        },
        { status: 404 }
      );
    }

    const team = teamResult.rows[0];

    // Get the latest ELO for this team by finding their most recent fixture
    const eloQuery = `
      WITH team_fixtures AS (
        SELECT
          f.id as fixture_id,
          f.timestamp,
          CASE
            WHEN f.home_team_id = $1 THEN 'home'
            WHEN f.away_team_id = $1 THEN 'away'
          END as home_away,
          ROW_NUMBER() OVER (ORDER BY f.timestamp DESC) as rn
        FROM football_fixtures f
        WHERE (f.home_team_id = $1 OR f.away_team_id = $1)
        AND f.status_long = 'Match Finished'
      ),
      latest_stats AS (
        SELECT
          tf.fixture_id,
          tf.home_away,
          CASE
            WHEN tf.home_away = 'home' THEN fs.elo_home
            WHEN tf.home_away = 'away' THEN fs.elo_away
          END as elo
        FROM team_fixtures tf
        LEFT JOIN football_stats fs ON tf.fixture_id = fs.fixture_id
        WHERE tf.rn = 1
      )
      SELECT elo
      FROM latest_stats
      WHERE elo IS NOT NULL
    `;

    const eloResult = await executeQuery(eloQuery, [teamId]);

    // Add ELO to the team
    const teamWithElo = {
      ...team,
      elo: eloResult.rows.length > 0 ? eloResult.rows[0].elo : null
    };

    return NextResponse.json({
      success: true,
      team: teamWithElo
    });

  } catch (error) {
    console.error('Failed to fetch team:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to fetch team: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getTeam);
