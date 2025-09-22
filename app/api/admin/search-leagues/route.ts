import { NextResponse } from 'next/server';
import axios from 'axios';
import { executeQuery, withErrorHandler } from '@/lib/db-utils';


interface ApiFootballLeague {
  league: {
    id: number;
    name: string;
    type: string;
    logo: string;
  };
  country: {
    name: string;
    code: string;
    flag: string;
  };
  seasons: Array<{
    year: number;
    start: string;
    end: string;
    current: boolean;
    coverage: {
      fixtures: {
        events: boolean;
        lineups: boolean;
        statistics_fixtures: boolean;
        statistics_players: boolean;
      };
      standings: boolean;
      players: boolean;
      top_scorers: boolean;
      top_assists: boolean;
      top_cards: boolean;
      injuries: boolean;
      predictions: boolean;
      odds: boolean;
    };
  }>;
}

async function getAvailableLeagues(request: Request) {
  const apiKey = process.env.API_KEY;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!apiKey || !apiBaseUrl) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 500 }
    );
  }

  try {
    // Fetch all leagues from API-Football
    const response = await axios.get(`${apiBaseUrl}/leagues`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      }
    });

    const apiLeagues: ApiFootballLeague[] = response.data.response || [];

    // Get existing league IDs to filter out already added leagues
    const existingResult = await executeQuery<{ id: number }>(
      'SELECT id FROM football_leagues'
    );
    const existingLeagueIds = new Set(existingResult.rows.map((row: { id: number }) => row.id));

    // Filter out already existing leagues and transform the data
    const availableLeagues = apiLeagues
      .filter(apiLeague => !existingLeagueIds.has(apiLeague.league.id))
      .map(apiLeague => ({
        id: apiLeague.league.id,
        name: apiLeague.league.name,
        country: apiLeague.country.name,
        seasons: apiLeague.seasons.map(season => season.year.toString())
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      leagues: availableLeagues
    });

  } catch (error) {
    console.error('Failed to fetch available leagues:', error);
    return NextResponse.json(
      { error: 'Failed to fetch available leagues' },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getAvailableLeagues);
