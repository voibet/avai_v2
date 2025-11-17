import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '@/lib/database/db-utils';


async function getTeamMappings(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  try {
    // Get the fixture to find the team IDs
    const fixtureResult = await executeQuery(
      'SELECT home_team_id, away_team_id FROM football_fixtures WHERE id = $1',
      [fixtureId]
    );

    if (fixtureResult.rows.length === 0) {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }

    const { home_team_id, away_team_id } = fixtureResult.rows[0];

    // Get mappings for both teams
    const teamsResult = await executeQuery(
      'SELECT id, mappings FROM football_teams WHERE id = ANY($1)',
      [[home_team_id, away_team_id].filter(id => id)]
    );

    const mappings: { [key: number]: any[] } = {};
    teamsResult.rows.forEach(team => {
      mappings[team.id] = team.mappings || [];
    });

    return NextResponse.json({
      home_mappings: mappings[home_team_id] || [],
      away_mappings: mappings[away_team_id] || []
    });
  } catch (error) {
    console.error('Error fetching team mappings:', error);
    return NextResponse.json({ error: 'Failed to fetch team mappings' }, { status: 500 });
  }
}

export const GET = withErrorHandler(getTeamMappings);