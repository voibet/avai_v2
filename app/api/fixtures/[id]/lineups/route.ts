import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../../../lib/database/db-utils';
import axios from 'axios';

interface ApiFootballLineupPlayer {
  player: {
    id: number;
    name: string;
    number: number;
    pos: string;
    grid: string;
  };
}


interface ApiFootballLineup {
  team: {
    id: number;
    name: string;
    logo: string;
    colors: {
      player: {
        primary: string;
        number: string;
        border: string;
      };
      goalkeeper: {
        primary: string;
        number: string;
        border: string;
      };
    };
  };
  coach: {
    id: number;
    name: string;
    photo: string;
  };
  formation: string;
  startXI: ApiFootballLineupPlayer[];
  substitutes: ApiFootballLineupPlayer[];
}

interface CoachInfo {
  id: number;
  name: string;
  photo: string;
}

async function getFixtureLineups(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  try {
    const apiKey = process.env.API_KEY;
    const apiBaseUrl = process.env.API_BASE_URL;

    if (!apiKey || !apiBaseUrl) {
      throw new Error('API configuration missing');
    }

    // Fetch lineups from API-Football
    const response = await axios.get(`${apiBaseUrl}/fixtures/lineups`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      },
      params: {
        fixture: fixtureId
      }
    });

    const apiResponse = response.data.response || [];

    if (apiResponse.length === 0) {
      return NextResponse.json({
        home: { coach: null, formation: null, startXI: [], substitutes: [] },
        away: { coach: null, formation: null, startXI: [], substitutes: [] }
      });
    }

    // Process the API response
    const lineups = apiResponse.reduce((acc: any, lineup: ApiFootballLineup) => {
      const teamKey = lineup.team.id === apiResponse[0].team.id ? 'home' : 'away';

      acc[teamKey] = {
        coach: lineup.coach ? {
          id: lineup.coach.id,
          name: lineup.coach.name,
          photo: lineup.coach.photo
        } : null,
        formation: lineup.formation,
        startXI: (lineup.startXI || []).map(player => ({
          id: player.player.id,
          name: player.player.name,
          number: player.player.number,
          position: player.player.pos,
          grid: player.player.grid
        })),
        substitutes: (lineup.substitutes || []).map(player => ({
          id: player.player.id,
          name: player.player.name,
          number: player.player.number,
          position: player.player.pos,
          grid: player.player.grid
        }))
      };

      return acc;
    }, {});

    return NextResponse.json(lineups);
  } catch (error: any) {
    console.error('Error fetching lineups:', error);

    if (error.response?.status === 404) {
      // Lineups not available for this fixture
      return NextResponse.json({
        home: { coach: null, formation: null, startXI: [], substitutes: [] },
        away: { coach: null, formation: null, startXI: [], substitutes: [] }
      });
    }

    return NextResponse.json(
      { error: 'Failed to fetch lineups', details: error.message },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getFixtureLineups);
