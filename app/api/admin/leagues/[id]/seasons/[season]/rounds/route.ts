import { NextResponse } from 'next/server';
import axios from 'axios';
import { withErrorHandler } from '@/lib/database/db-utils';

async function getLeagueRounds(
  _request: Request,
  { params }: { params: { id: string; season: string } }
) {
  const apiKey = process.env.API_KEY;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!apiKey || !apiBaseUrl) {
    return NextResponse.json(
      { error: 'API credentials not configured' },
      { status: 500 }
    );
  }

  try {
    const leagueId = parseInt(params.id);
    const season = parseInt(params.season);

    if (isNaN(leagueId) || isNaN(season)) {
      return NextResponse.json(
        { error: 'Invalid league ID or season' },
        { status: 400 }
      );
    }

    // Fetch fixtures for the league and season to get available rounds
    const response = await axios.get(`${apiBaseUrl}/fixtures`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      },
      params: {
        league: leagueId,
        season: season
      }
    });

    const fixtures = response.data.response || [];

    // Extract unique rounds from fixtures and group by base name (before " - ")
    const roundMap = new Map<string, string[]>();

    fixtures
      .map((fixture: any) => fixture.league.round)
      .filter((round: string) => round && round.trim() !== '')
      .forEach((round: string) => {
        // Split on " - " and take the first part as the base name
        const baseName = round.split(' - ')[0]?.trim() || round;
        if (!roundMap.has(baseName)) {
          roundMap.set(baseName, []);
        }
        roundMap.get(baseName)!.push(round);
      });

    // Sort base names alphabetically
    const uniqueBaseRounds = Array.from(roundMap.keys()).sort();

    // Return rounds in the expected format with base names
    const roundsData = uniqueBaseRounds.map((baseRound: string) => ({
      round_name: baseRound,
      original_rounds: roundMap.get(baseRound) || []
    }));

    return NextResponse.json(roundsData);

  } catch (error) {
    console.error('Failed to fetch league rounds:', error);
    return NextResponse.json(
      { error: 'Failed to fetch league rounds' },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getLeagueRounds);
