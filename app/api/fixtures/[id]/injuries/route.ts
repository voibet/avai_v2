import { NextResponse } from 'next/server';
import { withErrorHandler, executeQuery } from '../../../../../lib/db-utils';
import axios from 'axios';

export const dynamic = 'force-dynamic';

interface ApiFootballInjury {
  player: {
    id: number;
    name: string;
    photo: string;
    type: string;
    reason: string;
  };
  player_position: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  fixture: {
    id: number;
    timezone: string;
    date: string;
    timestamp: number;
  };
}

async function getFixtureInjuries(request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get('team_id');

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  if (!teamId) {
    return NextResponse.json({ error: 'Team ID is required' }, { status: 400 });
  }

  // First, get the fixture date to use as reference point
  let fixtureDate: Date | null = null;
  try {
    const fixtureResult = await executeQuery('SELECT date FROM football_fixtures WHERE id = $1', [fixtureId]);
    if (fixtureResult.rows.length > 0) {
      fixtureDate = new Date(fixtureResult.rows[0].date);
    }
  } catch (error) {
    console.error('Error fetching fixture date:', error);
  }

  try {
    const apiKey = process.env.API_KEY;
    const apiBaseUrl = process.env.API_BASE_URL;

    if (!apiKey || !apiBaseUrl) {
      throw new Error('API configuration missing');
    }

    // Fetch injuries from API-Football for specific team
    const response = await axios.get(`${apiBaseUrl}/injuries`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      },
      params: {
        team: teamId,
        season: new Date().getFullYear() // Current season
      }
    });

    const apiResponse = response.data.response || [];

    if (apiResponse.length === 0) {
      return NextResponse.json([]);
    }

    // Process the API response and categorize injuries
    let injuries = apiResponse.map((injury: ApiFootballInjury) => {
      const isThisMatch = injury.fixture.id === fixtureId;
      const injuryDate = new Date(injury.fixture.date);

      // Use fixture date as reference point, fallback to current date if not available
      const referenceDate = fixtureDate || new Date();

      // Calculate days since injury relative to match start time (can be negative if future)
      const daysSinceInjury = Math.floor((referenceDate.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24));

      return {
        player: {
          id: injury.player.id,
          name: injury.player.name,
          photo: injury.player.photo
        },
        position: injury.player_position,
        type: injury.player.type,
        reason: injury.player.reason,
        fixture: {
          id: injury.fixture.id,
          date: injury.fixture.date,
          timestamp: injury.fixture.timestamp
        },
        isThisMatch,
        daysSinceInjury,
        injuryDate: injury.fixture.date
      };
    });

    // Filter out:
    // 1. Future injuries (daysSinceInjury < 0)
    // 2. Injuries older than 7 days (daysSinceInjury > 7)
    injuries = injuries.filter((injury: any) => {
      return injury.daysSinceInjury >= 0 && injury.daysSinceInjury <= 8;
    });

    // Remove duplicates: keep only the most recent injury per player
    const playerInjuriesMap = new Map<number, any>();

    injuries.forEach((injury: any) => {
      const playerId = injury.player.id;
      const existingInjury = playerInjuriesMap.get(playerId);

      if (!existingInjury ||
          injury.fixture.timestamp > existingInjury.fixture.timestamp ||
          (injury.isThisMatch && !existingInjury.isThisMatch)) {
        playerInjuriesMap.set(playerId, injury);
      }
    });

    // Convert back to array and sort
    injuries = Array.from(playerInjuriesMap.values());

    // Sort injuries: this match first, then by most recent
    injuries.sort((a: any, b: any) => {
      if (a.isThisMatch && !b.isThisMatch) return -1;
      if (!a.isThisMatch && b.isThisMatch) return 1;
      return b.fixture.timestamp - a.fixture.timestamp;
    });

    return NextResponse.json(injuries);
  } catch (error: any) {
    console.error('Error fetching injuries:', error);

    if (error.response?.status === 404) {
      // No injuries for this fixture
      return NextResponse.json([]);
    }

    return NextResponse.json(
      { error: 'Failed to fetch injuries', details: error.message },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getFixtureInjuries);
