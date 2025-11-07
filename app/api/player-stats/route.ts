import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../lib/database/db-utils';
import axios from 'axios';

export const dynamic = 'force-dynamic';

async function getPlayerStats(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('player_id');
  const season = searchParams.get('season');
  const teamId = searchParams.get('team_id');
  const leagueId = searchParams.get('league_id');

  if (!playerId) {
    return NextResponse.json({ error: 'Player ID is required' }, { status: 400 });
  }

  if (!season) {
    return NextResponse.json({ error: 'Season is required' }, { status: 400 });
  }

  try {
    const apiKey = process.env.API_KEY;
    const apiBaseUrl = process.env.API_BASE_URL;

    if (!apiKey || !apiBaseUrl) {
      throw new Error('API configuration missing');
    }

    // Fetch player statistics from API-Football
    const params: any = {
      id: playerId,
      season: season
    };

    // Add team parameter if provided (helps narrow down results)
    if (teamId) {
      params.team = teamId;
    }

    // Add league parameter if provided (helps narrow down results)
    if (leagueId) {
      params.league = leagueId;
    }

    const response = await axios.get(`${apiBaseUrl}/players`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      },
      params
    });

    const apiResponse = response.data.response || [];

    if (apiResponse.length === 0) {
      return NextResponse.json(null);
    }

    // Process the API response
    const playerStats = apiResponse[0];

    const processedStats = {
      player: {
        id: playerStats.player?.id,
        name: playerStats.player?.name,
        firstname: playerStats.player?.firstname,
        lastname: playerStats.player?.lastname,
        age: playerStats.player?.age,
        nationality: playerStats.player?.nationality,
        height: playerStats.player?.height,
        weight: playerStats.player?.weight,
        injured: playerStats.player?.injured,
        photo: playerStats.player?.photo
      },
      statistics: playerStats.statistics ? playerStats.statistics[0] : null
    };

    return NextResponse.json(processedStats);
  } catch (error: any) {
    console.error('Error fetching player stats:', error);

    if (error.response?.status === 404) {
      return NextResponse.json(null);
    }

    return NextResponse.json(
      { error: 'Failed to fetch player stats', details: error.message },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getPlayerStats);
