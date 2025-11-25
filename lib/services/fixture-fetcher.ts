import axios from 'axios';
import { executeQuery, executeTransaction } from '../database/db-utils';
import { League } from '@/types';
import { CANCELLED, IN_PAST } from '../constants';
import { shouldSkipFixtureFetch, recordFixtureFetchAttempt } from './fixture-fetch-cache';

/**
 * Helper for consistent logging with timestamp and service prefix
 */
function log(message: string): void {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
  console.log(`${time} FixtureFetcher: ${message}`);
}

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

  // Leagues that should exclude fixtures during July-August
  private readonly EXCLUDED_LEAGUES_SUMMER = [2, 848, 3];

  private isJulyAugust(timestamp: number): boolean {
    const date = new Date(timestamp * 1000); // Convert to milliseconds
    const month = date.getMonth(); // 0-indexed: 6 = July, 7 = August
    return month === 6 || month === 7;
  }

  async fetchAndUpdateFixturesForSelectedSeasons(
    selectedSeasons: Record<string, string[]>,
    onProgress?: (info: string) => void
  ): Promise<{ success: boolean; message: string; updatedCount?: number; statusChangedToPastCount?: number; updatedFixtureIds?: number[] }> {
    const leagueSeasons = await this.convertSelectedSeasonsToLeagueSeasons(selectedSeasons);
    return this.fetchAndUpdateFixtures(leagueSeasons, onProgress);
  }

  async fetchAndUpdateFixturesForCurrentSeasons(
    onProgress?: (info: string) => void
  ): Promise<{ success: boolean; message: string; updatedCount?: number; statusChangedToPastCount?: number; updatedFixtureIds?: number[] }> {
    const leagueSeasons = await this.getCurrentLeaguesAndSeasons();
    return this.fetchAndUpdateFixtures(leagueSeasons, onProgress);
  }

  private async convertSelectedSeasonsToLeagueSeasons(selectedSeasons: Record<string, string[]>): Promise<Array<{ id: number, name: string, season: number }>> {
    const leagueIds = Object.keys(selectedSeasons).map(id => parseInt(id));
    const leagueResult = await executeQuery(`
      SELECT id, name FROM football_leagues WHERE id = ANY($1)
    `, [leagueIds]);

    const leagueMap = new Map(leagueResult.rows.map(row => [row.id, row.name]));
    const leagueSeasons: Array<{ id: number, name: string, season: number }> = [];

    Object.entries(selectedSeasons).forEach(([leagueId, seasons]) => {
      const leagueIdNum = parseInt(leagueId);
      const leagueName = leagueMap.get(leagueIdNum) || `League ${leagueId}`;

      seasons.forEach(season => {
        leagueSeasons.push({
          id: leagueIdNum,
          name: leagueName,
          season: parseInt(season)
        });
      });
    });

    return leagueSeasons;
  }

  async fetchAndUpdateFixtures(
    leagueSeasons: Array<{ id: number, name: string, season: number }>,
    onProgress?: (info: string) => void
  ): Promise<{ success: boolean; message: string; updatedCount?: number; statusChangedToPastCount?: number; updatedFixtureIds?: number[] }> {
    try {
      if (leagueSeasons.length === 0) {
        log('No leagues to process');
        return {
          success: false,
          message: 'No leagues provided'
        };
      }

      let totalUpdated = 0;
      let totalStatusChangedToPast = 0;
      const totalUpdatedFixtureIds: number[] = [];

      for (const leagueInfo of leagueSeasons) {
        const apiFixtures = await this.fetchFixturesFromAPI(leagueInfo.id, leagueInfo.season);

        // If no fixtures returned (due to cache), skip processing for this league
        if (apiFixtures.length === 0) {
          if (onProgress) {
            onProgress(`Cached data used for ${leagueInfo.name} (no API call needed)`);
          }
          continue;
        }

        const result = await this.updateDatabaseWithFixtures(apiFixtures);

        // Remove fixtures from database that are not in the API response (duplicates/outdated)
        const apiFixtureIds = apiFixtures.map(f => f.fixture.id);
        const deletedCount = await this.removeOrphanedFixtures(leagueInfo.id, leagueInfo.season, apiFixtureIds);
        if (deletedCount > 0) {
          log(`Removed ${deletedCount} orphaned fixtures for league ${leagueInfo.id}, season ${leagueInfo.season}`);
        }

        totalUpdated += result.updatedCount;
        totalStatusChangedToPast += result.statusChangedToPastCount;
        totalUpdatedFixtureIds.push(...(result.updatedFixtureIds || []));

        if (onProgress) {
          onProgress(`${apiFixtures.length} fixtures from API for ${leagueInfo.name}`);
        }
      }

      return {
        success: true,
        message: `Updated ${totalUpdated} fixtures`,
        updatedCount: totalUpdated,
        statusChangedToPastCount: totalStatusChangedToPast,
        updatedFixtureIds: totalUpdatedFixtureIds
      };
    } catch (error) {
      console.error('Fixture fetch process failed:', error instanceof Error ? error.message : error);
      return {
        success: false,
        message: `Failed to fetch fixtures: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async getCurrentSeasonForLeague(leagueId: number): Promise<number | null> {
    const result = await executeQuery<League>('SELECT seasons FROM football_leagues WHERE id = $1', [leagueId]);

    if (result.rows.length === 0) {
      return null;
    }

    const league = result.rows[0];
    if (!league.seasons) return null;

    const seasons: Record<string, SeasonData> = typeof league.seasons === 'string'
      ? JSON.parse(league.seasons)
      : league.seasons;

    for (const [seasonYear, seasonData] of Object.entries(seasons)) {
      if (seasonData.current) {
        return parseInt(seasonYear);
      }
    }

    return null;
  }

  private async getCurrentLeaguesAndSeasons(): Promise<Array<{ id: number, name: string, season: number }>> {
    // Get all leagues
    const result = await executeQuery<League>('SELECT id, name, seasons FROM football_leagues');
    const leagues: League[] = result.rows;

    const currentLeagues: Array<{ id: number, name: string, season: number }> = [];

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

    log(`Fetching ${missingTeamIds.length} missing teams from API...`);

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
        log(`Fetching team ${teamId} from API-Football`);
        const response = await axios.get(`${this.apiBaseUrl}/teams`, {
          headers: {
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': 'v3.football.api-sports.io'
          },
          params: {
            id: teamId
          },
          timeout: 15000 // 15 second timeout
        });

        const teams = response.data.response || [];
        allTeams.push(...teams);

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 250));

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
    log(`Added/updated ${apiTeams.length} teams in database`);
  }

  private async fetchFixturesFromAPI(leagueId?: number, season?: number): Promise<ApiFootballFixture[]> {
    const params: any = {};

    if (leagueId) params.league = leagueId;
    if (season) params.season = season;

    // Check cache if we have both leagueId and season
    if (leagueId && season && shouldSkipFixtureFetch(leagueId, season)) {
      log(`Using cached fixture data for league ${leagueId}, season ${season}`);
      return [];
    }

    try {
      log(`Fetching fixtures from API-Football: league=${leagueId}, season=${season}`);
      const response = await axios.get(`${this.apiBaseUrl}/fixtures`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        },
        params,
        timeout: 15000 // 15 second timeout
      });

      const fixtures = response.data.response || [];
      log(`Fetched ${fixtures.length} fixtures from API-Football`);

      // Record the fetch attempt (only if we have both leagueId and season)
      if (leagueId && season) {
        recordFixtureFetchAttempt(leagueId, season, fixtures.length > 0);
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 250));

      return fixtures;
    } catch (error: any) {
      // Record failed attempt if we have both leagueId and season
      if (leagueId && season) {
        recordFixtureFetchAttempt(leagueId, season, false);
      }
      console.error('API call failed');
      throw error;
    }
  }

  private async updateDatabaseWithFixtures(apiFixtures: ApiFootballFixture[]): Promise<{ updatedCount: number; statusChangedToPastCount: number; updatedFixtureIds: number[] }> {
    const validFixtures = this.filterValidFixtures(apiFixtures);
    await this.deleteCancelledFixtures(apiFixtures);

    if (validFixtures.length === 0) {
      return { updatedCount: 0, statusChangedToPastCount: 0, updatedFixtureIds: [] };
    }

    const teamCountryMap = await this.fetchMissingTeamCountries(this.extractTeamIds(validFixtures));
    const { queries, statusChanges } = await this.buildFixtureUpsertQueries(validFixtures, teamCountryMap);
    const results = await executeTransaction(queries, 120000);
    const { updatedCount, statusChangedToPastCount, updatedFixtureIds } = this.processTransactionResults(results, validFixtures, statusChanges);

    return { updatedCount, statusChangedToPastCount, updatedFixtureIds };
  }

  private filterValidFixtures(apiFixtures: ApiFootballFixture[]): ApiFootballFixture[] {
    return apiFixtures.filter(fixture =>
      (!this.EXCLUDED_LEAGUES_SUMMER.includes(fixture.league.id) || !this.isJulyAugust(fixture.fixture.timestamp)) &&
      !CANCELLED.includes(fixture.fixture.status.short.toLowerCase())
    );
  }

  private async deleteCancelledFixtures(apiFixtures: ApiFootballFixture[]): Promise<void> {
    const cancelledFixtures = apiFixtures.filter(fixture =>
      CANCELLED.includes(fixture.fixture.status.short.toLowerCase())
    );

    if (cancelledFixtures.length > 0) {
      const cancelledIds = cancelledFixtures.map(f => f.fixture.id);
      try {
        const result = await executeQuery('DELETE FROM football_fixtures WHERE id = ANY($1)', [cancelledIds]);
        if (result.rowCount > 0) {
          log(`Deleted ${result.rowCount} cancelled fixtures from database`);
        }
      } catch (error) {
        console.error('Error deleting cancelled fixtures:', error);
      }
    }
  }

  private extractTeamIds(fixtures: ApiFootballFixture[]): number[] {
    return Array.from(new Set([
      ...fixtures.map(f => f.teams.home.id),
      ...fixtures.map(f => f.teams.away.id)
    ]));
  }

  private async buildFixtureUpsertQueries(fixtures: ApiFootballFixture[], teamCountryMap: Map<number, string>): Promise<{ queries: any[], statusChanges: boolean[] }> {
    const queries: any[] = [];
    const statusChanges: boolean[] = [];

    // Batch fetch existing fixtures
    const fixtureIds = fixtures.map(f => f.fixture.id);
    const existingFixturesMap = await this.getExistingFixturesMap(fixtureIds);

    for (const fixture of fixtures) {
      const existingFixture = existingFixturesMap.get(fixture.fixture.id);
      const query = this.buildFixtureUpsertQuery(fixture, teamCountryMap, existingFixture);

      const isNewlyInPast = existingFixture &&
        !IN_PAST.includes(existingFixture.status_short.toLowerCase()) &&
        IN_PAST.includes(fixture.fixture.status.short.toLowerCase());
      statusChanges.push(!!isNewlyInPast);

      queries.push(query);
    }

    return { queries, statusChanges };
  }

  private async getExistingFixturesMap(fixtureIds: number[]): Promise<Map<number, { xg_home: number; xg_away: number; status_short: string }>> {
    if (fixtureIds.length === 0) return new Map();

    try {
      const result = await executeQuery<{ id: number; xg_home: number; xg_away: number; status_short: string }>(
        'SELECT id, xg_home, xg_away, status_short FROM football_fixtures WHERE id = ANY($1)',
        [fixtureIds]
      );

      const map = new Map();
      result.rows.forEach(row => {
        map.set(row.id, row);
      });
      return map;
    } catch (error) {
      console.error('Error batch fetching existing fixtures:', error);
      return new Map();
    }
  }

  private async getExistingFixture(fixtureId: number): Promise<{ xg_home: number; xg_away: number; status_short: string } | null> {
    try {
      const result = await executeQuery('SELECT xg_home, xg_away, status_short FROM football_fixtures WHERE id = $1', [fixtureId]);
      return result.rows[0] || null;
    } catch (error) {
      log(`No existing fixture found for ID ${fixtureId}, will create new`);
      return null;
    }
  }

  private buildFixtureUpsertQuery(fixture: ApiFootballFixture, teamCountryMap: Map<number, string>, existingFixture: any): { query: string; params: any[] } {
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
      WHERE (
        football_fixtures.status_short IS DISTINCT FROM EXCLUDED.status_short OR
        football_fixtures.timestamp IS DISTINCT FROM EXCLUDED.timestamp OR
        football_fixtures.goals_home IS DISTINCT FROM EXCLUDED.goals_home OR
        football_fixtures.goals_away IS DISTINCT FROM EXCLUDED.goals_away OR
        football_fixtures.score_halftime_home IS DISTINCT FROM EXCLUDED.score_halftime_home OR
        football_fixtures.score_halftime_away IS DISTINCT FROM EXCLUDED.score_halftime_away OR
        football_fixtures.score_fulltime_home IS DISTINCT FROM EXCLUDED.score_fulltime_home OR
        football_fixtures.score_fulltime_away IS DISTINCT FROM EXCLUDED.score_fulltime_away OR
        football_fixtures.referee IS DISTINCT FROM EXCLUDED.referee OR
        football_fixtures.venue_name IS DISTINCT FROM EXCLUDED.venue_name
      )
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
      teamCountryMap.get(fixture.teams.home.id) || null,
      fixture.teams.away.id,
      fixture.teams.away.name,
      teamCountryMap.get(fixture.teams.away.id) || null,
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
      existingFixture?.xg_home || null,
      existingFixture?.xg_away || null
    ];

    return { query, params };
  }

  private processTransactionResults(results: any[], fixtures: ApiFootballFixture[], statusChanges: boolean[]): { updatedCount: number; statusChangedToPastCount: number; updatedFixtureIds: number[] } {
    const updatedFixtureIds: number[] = [];
    let updatedCount = 0;
    let statusChangedToPastCount = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.rowCount && result.rowCount > 0) {
        updatedCount++;
        updatedFixtureIds.push(fixtures[i].fixture.id);
        if (statusChanges[i]) {
          statusChangedToPastCount++;
        }
      }
    }

    return { updatedCount, statusChangedToPastCount, updatedFixtureIds };
  }

  /**
   * Removes fixtures from database that exist for the given league and season
   * but are not present in the API response (these are duplicates/outdated fixtures)
   */
  private async removeOrphanedFixtures(
    leagueId: number,
    season: number,
    apiFixtureIds: number[]
  ): Promise<number> {
    if (apiFixtureIds.length === 0) {
      // If API returned no fixtures, don't delete anything (might be off-season)
      return 0;
    }

    try {
      const result = await executeQuery<{ id: number }>(
        `SELECT id FROM football_fixtures 
         WHERE league_id = $1 AND season = $2 AND NOT (id = ANY($3))`,
        [leagueId, season, apiFixtureIds]
      );

      const orphanedFixtureIds = result.rows.map(row => row.id);

      if (orphanedFixtureIds.length === 0) {
        return 0;
      }

      // Delete orphaned fixtures
      await executeQuery(
        'DELETE FROM football_fixtures WHERE id = ANY($1)',
        [orphanedFixtureIds]
      );

      return orphanedFixtureIds.length;
    } catch (error) {
      console.error(`Error removing orphaned fixtures for league ${leagueId}, season ${season}:`, error);
      return 0;
    }
  }

  // Static property to track the last run date of the nightly scheduler
  private static lastNightlyRunDate: string | null = null;

  /**
   * Starts a scheduler that checks every 30 minutes if it's between 03:00 and 04:00.
   * If so, and if it hasn't run yet today, it triggers a fixture update for all current seasons.
   */
  public static startNightlyScheduler(): void {
    // Check if CHAIN environment variable is set to true
    if (process.env.CHAIN !== 'true') {
      log('CHAIN environment variable not set to true, skipping nightly fixture scheduler');
      return;
    }

    log('Starting nightly fixture scheduler');

    // Check every 30 minutes
    setInterval(async () => {
      const now = new Date();
      const hours = now.getHours();
      const dateString = now.toDateString();

      // Check if time is between 03:00 and 04:00
      if (hours === 3) {
        // Check if we already ran today
        if (FixtureFetcher.lastNightlyRunDate === dateString) {
          return;
        }

        log('Starting nightly fixture update...');
        FixtureFetcher.lastNightlyRunDate = dateString;

        try {
          const fetcher = new FixtureFetcher();
          const result = await fetcher.fetchAndUpdateFixturesForCurrentSeasons();

          if (result.success) {
            log(`Nightly update completed successfully. Updated: ${result.updatedCount}, Past: ${result.statusChangedToPastCount}`);
          } else {
            log(`Nightly update failed: ${result.message}`);
          }
        } catch (error) {
          console.error('Nightly fixture update encountered an error:', error);
        }
      }
    }, 30 * 60 * 1000); // Check every 30 minutes
  }
}
