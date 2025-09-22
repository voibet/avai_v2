import axios from 'axios';
import { executeQuery, executeTransaction } from './db-utils';
import { League } from '../types/database';


interface SeasonData {
  start: string;
  end: string;
  current: boolean;
}

interface ApiFootballFixture {
  fixture: {
    id: number;
    referee: string;
    timezone: string;
    date: string;
    timestamp: number;
    periods: {
      first: number;
      second: number;
    };
    venue: {
      id: number;
      name: string;
      city: string;
    };
    status: {
      long: string;
      short: string;
      elapsed: number;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    round: string;
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo: string;
      winner: boolean;
    };
    away: {
      id: number;
      name: string;
      logo: string;
      winner: boolean;
    };
  };
  goals: {
    home: number;
    away: number;
  };
  score: {
    halftime: {
      home: number;
      away: number;
    };
    fulltime: {
      home: number;
      away: number;
    };
    extratime: {
      home: number;
      away: number;
    };
    penalty: {
      home: number;
      away: number;
    };
  };
}

interface ApiFootballTeam {
  team: {
    id: number;
    name: string;
    country: string;
    national: boolean;
    logo: string;
  };
  venue: {
    id: number;
    name: string;
    address: string;
    city: string;
    capacity: number;
    surface: string;
    image: string;
  };
}

export class FixtureFetcher {
  private readonly apiKey = process.env.API_KEY;
  private readonly apiBaseUrl = process.env.API_BASE_URL;

  async fetchAndUpdateFixtures(
    onProgress?: (league: string, index: number, total: number) => void,
    selectedSeasons?: Record<string, string[]>
  ): Promise<{ success: boolean; message: string; updatedCount?: number }> {
    try {
      console.log('Starting fixture fetch process...');

      let leaguesToProcess: Array<{id: number, name: string, season: number}> = [];

      if (selectedSeasons && Object.keys(selectedSeasons).length > 0) {

        // Get league names for the selected league IDs
        const leagueIds = Object.keys(selectedSeasons).map(id => parseInt(id));
        const leagueResult = await executeQuery(`
          SELECT id, name FROM football_leagues WHERE id = ANY($1)
        `, [leagueIds]);

        const leagueMap = new Map(leagueResult.rows.map(row => [row.id, row.name]));

        // Create processing list from selected seasons
        Object.entries(selectedSeasons).forEach(([leagueId, seasons]) => {
          const leagueIdNum = parseInt(leagueId);
          const leagueName = leagueMap.get(leagueIdNum) || `League ${leagueId}`;

          seasons.forEach(season => {
            leaguesToProcess.push({
              id: leagueIdNum,
              name: leagueName,
              season: parseInt(season)
            });
          });
        });
      } else {
        // Fall back to current seasons
        console.log('No selected seasons provided, using current seasons');
        leaguesToProcess = await this.getCurrentLeaguesAndSeasons();
      }

      console.log(`Found ${leaguesToProcess.length} leagues to process`);

      if (leaguesToProcess.length === 0) {
        console.log('No leagues to process');
        return {
          success: false,
          message: 'No leagues selected or no current seasons found'
        };
      }

      // Fetch fixtures for each league
      let totalUpdated = 0;
      const totalLeagues = leaguesToProcess.length;

      for (let i = 0; i < leaguesToProcess.length; i++) {
        const leagueInfo = leaguesToProcess[i];
        console.log(`Processing league: ${leagueInfo.name} (ID: ${leagueInfo.id}, Season: ${leagueInfo.season})`);

        // Report progress if callback provided
        if (onProgress) {
          onProgress(leagueInfo.name, i + 1, totalLeagues);
        }

        try {
          const apiFixtures = await this.fetchFixturesFromAPI(leagueInfo.id, leagueInfo.season);
          console.log(`Fetched ${apiFixtures.length} fixtures from API for ${leagueInfo.name}`);

          const updated = await this.updateDatabaseWithFixtures(apiFixtures, leagueInfo.name);

          totalUpdated += updated;
        } catch (error) {
          const errorMessage = `Failed to process league ${leagueInfo.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMessage);

          // Re-throw the error to propagate it to the UI
          throw new Error(errorMessage);
        }
      }

      console.log(`Fixture fetch process completed. Total updated: ${totalUpdated}`);
      return {
        success: true,
        message: `Updated ${totalUpdated} fixtures`,
        updatedCount: totalUpdated
      };
    } catch (error) {
      console.error('Fixture fetch process failed:', error instanceof Error ? error.message : error);
      return {
        success: false,
        message: `Failed to fetch fixtures: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async getCurrentLeaguesAndSeasons(): Promise<Array<{id: number, name: string, season: number}>> {
    // Get all leagues
    const result = await executeQuery<League>('SELECT id, name, seasons FROM football_leagues');
    const leagues: League[] = result.rows;

    const currentLeagues: Array<{id: number, name: string, season: number}> = [];

    for (const league of leagues) {
      if (!league.seasons) continue;

      const seasons: Record<string, SeasonData> = typeof league.seasons === 'string'
        ? JSON.parse(league.seasons)
        : league.seasons;

      for (const [seasonYear, seasonData] of Object.entries(seasons)) {
        if (seasonData.current) {
          currentLeagues.push({
            id: league.id,
            name: league.name,
            season: parseInt(seasonYear)
          });
          break; // Only add the first current season found for this league
        }
      }
    }
    return currentLeagues;
  }

  private async fetchMissingTeamCountries(teamIds: number[]): Promise<Map<number, string>> {
    if (teamIds.length === 0) return new Map();

    // Get all teams in one query - existing teams will have countries, missing ones won't
    const teamsResult = await executeQuery<{ id: number; country: string | null }>(
      'SELECT id, country FROM football_teams WHERE id = ANY($1)',
      [teamIds]
    );

    const teamCountryMap = new Map<number, string>();
    const existingTeams = new Map<number, string>();
    const missingTeamIds: number[] = [];

    // Separate existing and missing teams
    teamIds.forEach(teamId => {
      const teamRow = teamsResult.rows.find(row => row.id === teamId);
      if (teamRow && teamRow.country) {
        existingTeams.set(teamId, teamRow.country);
        teamCountryMap.set(teamId, teamRow.country);
      } else {
        missingTeamIds.push(teamId);
      }
    });

    if (missingTeamIds.length === 0) {
      // All teams exist with countries - return immediately
      return teamCountryMap;
    }

    console.log(`Fetching ${missingTeamIds.length} missing teams from API...`);

    // Fetch missing teams from API-Football Teams endpoint
    const apiTeams = await this.fetchTeamsFromAPI(missingTeamIds);

    // Store missing teams in database
    if (apiTeams.length > 0) {
      await this.addTeamsToDatabase(apiTeams);

      // Add API-fetched teams to our map
      apiTeams.forEach(apiTeam => {
        teamCountryMap.set(apiTeam.team.id, apiTeam.team.country);
      });
    }

    return teamCountryMap;
  }

  private async fetchTeamsFromAPI(teamIds: number[]): Promise<ApiFootballTeam[]> {
    const allTeams: ApiFootballTeam[] = [];

    for (const teamId of teamIds) {
      try {
        const response = await axios.get(`${this.apiBaseUrl}/teams`, {
          headers: {
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': 'v3.football.api-sports.io'
          },
          params: {
            id: teamId
          }
        });

        const teams = response.data.response || [];
        allTeams.push(...teams);

        // Respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        console.error(`Failed to fetch team ${teamId}:`, error.response?.data || error.message);
        // Continue with next team
      }
    }

    return allTeams;
  }

  private async addTeamsToDatabase(apiTeams: ApiFootballTeam[]): Promise<void> {
    if (apiTeams.length === 0) return;

    const queries = apiTeams.map((apiTeam) => {
      // Validate required fields
      if (!apiTeam.team.id || !apiTeam.team.name) {
        throw new Error(`Invalid team data: missing id or name for team ${apiTeam.team.id}`);
      }

      return {
        query: `
          INSERT INTO football_teams (id, name, country, venue)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            country = EXCLUDED.country,
            venue = EXCLUDED.venue,
            updated_at = NOW()
        `,
        params: [
          apiTeam.team.id,
          apiTeam.team.name,
          apiTeam.team.country || null,
          apiTeam.venue?.name || null
        ]
      };
    });

    await executeTransaction(queries);
    console.log(`Added/updated ${apiTeams.length} teams in database`);
  }

  private async fetchFixturesFromAPI(leagueId?: number, season?: number): Promise<ApiFootballFixture[]> {
    const params: any = {};

    if (leagueId) params.league = leagueId;
    if (season) params.season = season;

    // Don't filter by status initially to get all fixtures
    // The API will return fixtures for the current season by default

    try {
      const response = await axios.get(`${this.apiBaseUrl}/fixtures`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        },
        params
      });

      const fixtures = response.data.response || [];

      if (fixtures.length === 0) {
        console.log('No fixtures returned. API response:', response.data);
      }

      return fixtures;
    } catch (error: any) {
      console.error('API call failed:', error.response?.data || error.message);
      throw error;
    }
  }

  private async updateDatabaseWithFixtures(apiFixtures: ApiFootballFixture[], leagueName: string): Promise<number> {
    let updatedCount = 0;

    if (apiFixtures.length === 0) return 0;

    // Get all unique team IDs from fixtures
    const allTeamIds = Array.from(new Set([
      ...apiFixtures.map(f => f.teams.home.id),
      ...apiFixtures.map(f => f.teams.away.id)
    ]));

    // Fetch team countries for all teams in these fixtures
    const teamCountryMap = await this.fetchMissingTeamCountries(allTeamIds);

    // Get league data including xg_source for this league
    const leagueResult = await executeQuery(`
      SELECT xg_source FROM football_leagues WHERE id = $1
    `, [apiFixtures[0]?.league.id]);

    let xgSourceData: Record<string, { rounds: Record<string, { url: string }> }> = {};
    if (leagueResult.rows.length > 0 && leagueResult.rows[0].xg_source) {
      xgSourceData = typeof leagueResult.rows[0].xg_source === 'string'
        ? JSON.parse(leagueResult.rows[0].xg_source)
        : leagueResult.rows[0].xg_source;
    }

    // Helper function to get xg_source for a specific fixture
    const getXGSourceForFixture = (season: number, round: string): string | null => {
      const seasonStr = season.toString();

      if (xgSourceData[seasonStr]?.rounds) {
        const seasonRounds = xgSourceData[seasonStr].rounds;

        // First check for specific round
        if (seasonRounds[round]) {
          return seasonRounds[round].url;
        }
        // Then check for "ALL" round
        else if (seasonRounds["ALL"]) {
          return seasonRounds["ALL"].url;
        }
      }

      return null;
    };

    // Build transaction queries
    const queries = await Promise.all(apiFixtures.map(async (fixture) => {
      // Get existing fixture to preserve xg_home, xg_away (but get xg_source from league)
      let existingXG = null;
      try {
        const existingResult = await executeQuery(`
          SELECT xg_home, xg_away FROM football_fixtures WHERE id = $1
        `, [fixture.fixture.id]);

        existingXG = existingResult.rows[0];
      } catch (error) {
        console.log(`No existing fixture found for ID ${fixture.fixture.id}, will create new`);
      }

      const query = `
        INSERT INTO football_fixtures (
          id, referee, timestamp, date, venue_name, status_long, status_short,
          home_team_id, home_team_name, home_country, away_team_id, away_team_name, away_country,
          goals_home, goals_away,
          score_halftime_home, score_halftime_away,
          score_fulltime_home, score_fulltime_away,
          score_extratime_home, score_extratime_away,
          score_penalty_home, score_penalty_away,
          league_id, league_name, league_country, season, round,
          xg_home, xg_away
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )
        ON CONFLICT (id) DO UPDATE SET
          referee = EXCLUDED.referee,
          timestamp = EXCLUDED.timestamp,
          date = EXCLUDED.date,
          venue_name = EXCLUDED.venue_name,
          status_long = EXCLUDED.status_long,
          status_short = EXCLUDED.status_short,
          home_team_id = EXCLUDED.home_team_id,
          home_team_name = EXCLUDED.home_team_name,
          home_country = EXCLUDED.home_country,
          away_team_id = EXCLUDED.away_team_id,
          away_team_name = EXCLUDED.away_team_name,
          away_country = EXCLUDED.away_country,
          goals_home = EXCLUDED.goals_home,
          goals_away = EXCLUDED.goals_away,
          score_halftime_home = EXCLUDED.score_halftime_home,
          score_halftime_away = EXCLUDED.score_halftime_away,
          score_fulltime_home = EXCLUDED.score_fulltime_home,
          score_fulltime_away = EXCLUDED.score_fulltime_away,
          score_extratime_home = EXCLUDED.score_extratime_home,
          score_extratime_away = EXCLUDED.score_extratime_away,
          score_penalty_home = EXCLUDED.score_penalty_home,
          score_penalty_away = EXCLUDED.score_penalty_away,
          league_id = EXCLUDED.league_id,
          league_name = EXCLUDED.league_name,
          league_country = EXCLUDED.league_country,
          season = EXCLUDED.season,
          round = EXCLUDED.round,
          xg_home = COALESCE(EXCLUDED.xg_home, football_fixtures.xg_home),
          xg_away = COALESCE(EXCLUDED.xg_away, football_fixtures.xg_away),
          updated_at = NOW()
      `;

      const params = [
        fixture.fixture.id,
        fixture.fixture.referee,
        fixture.fixture.timestamp,
        fixture.fixture.date,
        fixture.fixture.venue?.name,
        fixture.fixture.status.long,
        fixture.fixture.status.short,
        fixture.teams.home.id,
        fixture.teams.home.name,
        teamCountryMap.get(fixture.teams.home.id) || null, // home_country
        fixture.teams.away.id,
        fixture.teams.away.name,
        teamCountryMap.get(fixture.teams.away.id) || null, // away_country
        fixture.goals.home,
        fixture.goals.away,
        fixture.score.halftime?.home,
        fixture.score.halftime?.away,
        fixture.score.fulltime?.home,
        fixture.score.fulltime?.away,
        fixture.score.extratime?.home,
        fixture.score.extratime?.away,
        fixture.score.penalty?.home,
        fixture.score.penalty?.away,
        fixture.league.id,
        fixture.league.name,
        fixture.league.country,
        fixture.league.season,
        fixture.league.round,
        existingXG?.xg_home || null,
        existingXG?.xg_away || null
      ];

      return { query, params };
    }));

    // Execute all queries in a transaction
    const results = await executeTransaction(queries);

    // Count updated rows
    for (const result of results) {
      if (result.rowCount && result.rowCount > 0) {
        updatedCount++;
      }
    }

    return updatedCount;
  }
}
