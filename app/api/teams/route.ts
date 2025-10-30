import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/database/db-utils';
import { Team } from '@/types/database';

async function getTeams(_request: Request) {
  try {
    // First get all teams
    const teamsResult = await executeQuery<Team>('SELECT id, name, country, venue, mappings FROM football_teams ORDER BY name');

    // Then get the latest ELO for each team by finding their most recent fixture
    const eloQuery = `
      WITH team_fixtures AS (
        SELECT
          t.id as team_id,
          f.id as fixture_id,
          f.timestamp,
          CASE
            WHEN f.home_team_id = t.id THEN 'home'
            WHEN f.away_team_id = t.id THEN 'away'
          END as home_away,
          ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY f.timestamp DESC) as rn
        FROM football_teams t
        INNER JOIN football_fixtures f ON (f.home_team_id = t.id OR f.away_team_id = t.id)
        WHERE f.status_long = 'Match Finished'
      ),
      latest_stats AS (
        SELECT
          tf.team_id,
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
      SELECT team_id, elo
      FROM latest_stats
      WHERE elo IS NOT NULL
    `;

    const eloResult = await executeQuery(eloQuery);

    // Create a map of team_id to elo
    const eloMap = new Map<number, number>();
    eloResult.rows.forEach((row: any) => {
      eloMap.set(row.team_id, row.elo);
    });

    // Add ELO to each team
    const teamsWithElo = teamsResult.rows.map(team => ({
      ...team,
      elo: eloMap.get(team.id) || null
    }));

    return NextResponse.json({
      success: true,
      teams: teamsWithElo
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

