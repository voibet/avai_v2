import { NextResponse } from 'next/server';
import axios from 'axios';
import { executeTransaction, withErrorHandler } from '@/lib/database/db-utils';

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

async function addLeagues(request: Request) {
  const apiKey = process.env.API_KEY;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!apiKey || !apiBaseUrl) {
    return NextResponse.json(
      { success: false, message: 'API credentials not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { selectedLeagues, selectedSeasons } = body;

    if (!selectedLeagues || !Array.isArray(selectedLeagues) || selectedLeagues.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No leagues selected' },
        { status: 400 }
      );
    }

    // Fetch detailed league data from API-Football for the selected leagues
    const leagueDetailsPromises = selectedLeagues.map(async (leagueId: number) => {
      try {
        const response = await axios.get(`${apiBaseUrl}/leagues`, {
          headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'v3.football.api-sports.io'
          },
          params: {
            id: leagueId
          }
        });

        return response.data.response?.[0] || null;
      } catch (error) {
        console.error(`Failed to fetch details for league ${leagueId}:`, error);
        return null;
      }
    });

    const leagueDetails = await Promise.all(leagueDetailsPromises);
    const validLeagueDetails = leagueDetails.filter(detail => detail !== null);

    if (validLeagueDetails.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Failed to fetch league details from API' },
        { status: 500 }
      );
    }

    // Build transaction queries to insert leagues
    const queries = validLeagueDetails.map((apiLeague: ApiFootballLeague) => {
      const leagueId = apiLeague.league.id;
      const selectedSeasonsForLeague = selectedSeasons?.[leagueId] || [];

      // Build seasons object for the selected seasons
      const seasons: Record<string, any> = {};
      apiLeague.seasons.forEach(season => {
        if (selectedSeasonsForLeague.includes(season.year.toString())) {
          seasons[season.year.toString()] = {
            start: season.start,
            end: season.end,
            current: season.current
          };
        }
      });

      const query = `
        INSERT INTO football_leagues (id, name, type, country, seasons, xg_source)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          country = EXCLUDED.country,
          seasons = COALESCE(football_leagues.seasons, '{}'::jsonb) || EXCLUDED.seasons,
          updated_at = NOW()
      `;

      const params = [
        apiLeague.league.id,
        apiLeague.league.name,
        apiLeague.league.type,
        apiLeague.country.name,
        JSON.stringify(seasons),
        JSON.stringify({}) // Empty xg_source object
      ];

      return { query, params };
    });

    // Execute all queries in a transaction
    const results = await executeTransaction(queries);

    const addedCount = results.filter((result: { rowCount?: number }) => result.rowCount && result.rowCount > 0).length;

    return NextResponse.json({
      success: true,
      message: `Successfully added ${addedCount} league(s) to database`,
      addedCount
    });

  } catch (error) {
    console.error('Failed to add leagues:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to add leagues: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const POST = withErrorHandler(addLeagues);
