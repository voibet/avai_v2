import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../../../lib/database/db-utils';
import axios from 'axios';

interface ApiFootballCoach {
  id: number;
  name: string;
  firstname: string;
  lastname: string;
  age: number;
  birth: {
    date: string;
    place: string;
    country: string;
  };
  nationality: string;
  height: string;
  weight: string;
  photo: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
  career: Array<{
    team: {
      id: number;
      name: string;
      logo: string;
    };
    start: string;
    end: string;
  }>;
}

interface CoachInfo {
  id: number;
  name: string;
  nationality: string;
  photo: string;
  careerStartDate: string;
  team: {
    id: number;
    name: string;
    logo: string;
  };
}

async function getFixtureCoaches(_request: Request, { params }: { params: { id: string } }) {
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

    // First, get the fixture data to get team IDs
    const fixtureResponse = await axios.get(`${apiBaseUrl}/fixtures`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io'
      },
      params: {
        id: fixtureId
      }
    });

    const fixtureData = fixtureResponse.data.response?.[0];
    if (!fixtureData) {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }

    const homeTeamId = fixtureData.teams.home.id;
    const awayTeamId = fixtureData.teams.away.id;

    // Fetch coaches for both teams
    const [homeCoachesResponse, awayCoachesResponse] = await Promise.all([
      axios.get(`${apiBaseUrl}/coachs`, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        },
        params: {
          team: homeTeamId
        }
      }),
      axios.get(`${apiBaseUrl}/coachs`, {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        },
        params: {
          team: awayTeamId
        }
      })
    ]);

    const processCoachData = (coaches: ApiFootballCoach[]): CoachInfo | null => {
      if (!coaches || coaches.length === 0) return null;

      // Find the coach with the most recent career start date on the current team
      let latestCoach = null;
      let latestStartDate = '';

      for (const coach of coaches) {
        // Find career entry for current team
        const currentTeamCareer = coach.career?.find(career =>
          career.team.id === coach.team.id
        );

        if (currentTeamCareer?.start) {
          // Compare dates to find the most recent one
          if (!latestStartDate || currentTeamCareer.start > latestStartDate) {
            latestStartDate = currentTeamCareer.start;
            latestCoach = coach;
          }
        }
      }

      // If no coach with current team career found, use the first coach as fallback
      const currentCoach = latestCoach || coaches[0];

      // Find career entry for current team to get start date
      const currentTeamCareer = currentCoach.career?.find(career =>
        career.team.id === currentCoach.team.id
      );

      return {
        id: currentCoach.id,
        name: currentCoach.name,
        nationality: currentCoach.nationality,
        photo: currentCoach.photo,
        careerStartDate: currentTeamCareer?.start || '',
        team: currentCoach.team
      };
    };

    const homeCoach = processCoachData(homeCoachesResponse.data.response || []);
    const awayCoach = processCoachData(awayCoachesResponse.data.response || []);

    return NextResponse.json({
      home: homeCoach,
      away: awayCoach
    });

  } catch (error: any) {
    console.error('Error fetching coaches:', error);

    if (error.response?.status === 404) {
      // Coaches not available
      return NextResponse.json({
        home: null,
        away: null
      });
    }

    return NextResponse.json(
      { error: 'Failed to fetch coaches', details: error.message },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getFixtureCoaches);
