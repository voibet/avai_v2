import axios from 'axios';
import { executeQuery } from '../database/db-utils';
import { Fixture } from '@/types';
import { IN_PAST } from '../constants';
import { shouldSkipXGFetch, recordXGFetchAttempt, getXGCacheExpiry } from './xg-fetch-cache';

/**
 * Helper for consistent logging with timestamp and service prefix
 */
function log(message: string): void {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
  console.log(`${time} XGFetcher: ${message}`);
}

interface XGData {
  home: number;
  away: number;
}

interface SofascoreMatch {
  events: Array<{
    tournament: {
      name: string;
      slug: string;
      category: {
        name: string;
        slug: string;
      };
      uniqueTournament: {
        name: string;
        slug: string;
        id: number;
      };
      season: {
        name: string;
        year: string;
        id: number;
      };
    };
    status: {
      code: number;
      description: string;
      type: string;
    };
    homeTeam: {
      id: number;
      name: string;
      slug: string;
      shortName: string;
    };
    awayTeam: {
      id: number;
      name: string;
      slug: string;
      shortName: string;
    };
    homeScore: {
      current: number;
      display: number;
      period1: number;
      period2: number;
      normaltime: number;
    };
    awayScore: {
      current: number;
      display: number;
      period1: number;
      period2: number;
      normaltime: number;
    };
    hasXg: boolean;
    id: number;
    startTimestamp: number;
  }>;
}

interface SofascoreStatistics {
  statistics: Array<{
    period: string;
    groups: Array<{
      groupName: string;
      statisticsItems: Array<{
        name: string;
        home: string;
        away: string;
        homeValue: number;
        awayValue: number;
        key: string;
      }>;
    }>;
  }>;
}

interface FlashliveMatch {
  DATA: Array<{
    NAME: string;
    TOURNAMENT_STAGE_ID: string;
    EVENTS: Array<{
      EVENT_ID: string;
      START_TIME: number;
      START_UTIME: number;
      STAGE_TYPE: string;
      STAGE: string;
      HOME_NAME: string;
      SHORTNAME_HOME: string;
      AWAY_NAME: string;
      SHORTNAME_AWAY: string;
      HOME_SCORE_CURRENT: string;
      AWAY_SCORE_CURRENT: string;
      WINNER?: number;
    }>;
  }>;
}

interface FlashliveStatistics {
  DATA: Array<{
    STAGE_NAME: string;
    GROUPS: Array<{
      GROUP_LABEL: string;
      ITEMS: Array<{
        INCIDENT_NAME: string;
        VALUE_HOME: string;
        VALUE_AWAY: string;
      }>;
    }>;
  }>;
}

export class XGFetcher {
  private readonly rapidApiKey = process.env.RAPID_API_KEY;
  private readonly apiKey = process.env.API_KEY;
  private readonly apiBaseUrl = process.env.API_BASE_URL;

  // Cache for tournament data to avoid refetching for same league/season
  private sofascoreCache = new Map<string, any[]>();
  private flashliveCache = new Map<string, any[]>();

  async fetchXGDataForLeague(
    leagueId: number,
    onProgress?: (message: string, current: number, total: number) => void
  ): Promise<{ success: boolean; message: string; updatedCount?: number; updatedFixtureIds?: number[] }> {
    try {

      // Clear caches to ensure fresh data for new league
      this.clearCaches();

      // Get finished fixtures without XG data for this league
      const allFixtures = await this.getFixturesNeedingXG(leagueId);

      // Deduplicate fixtures by ID
      const seenIds = new Set<number>();
      const fixtures = allFixtures.filter(f => {
        if (seenIds.has(f.id)) return false;
        seenIds.add(f.id);
        return true;
      });

      if (fixtures.length === 0) {
        return {
          success: true,
          message: 'No fixtures found that need XG data',
          updatedCount: 0,
          updatedFixtureIds: []
        };
      }

      let totalUpdated = 0;
      const allUpdatedIds: number[] = [];
      const batchSize = 10; // Process fixtures in batches to avoid overwhelming APIs

      for (let i = 0; i < fixtures.length; i += batchSize) {
        const batch = fixtures.slice(i, i + batchSize);

        if (onProgress) {
          onProgress(
            `Processing fixtures ${i + 1}-${Math.min(i + batchSize, fixtures.length)}`,
            i,
            fixtures.length
          );
        }

        try {
          const batchResult = await this.processBatch(batch);
          totalUpdated += batchResult.count;
          allUpdatedIds.push(...batchResult.updatedIds);

          // Rate limiting - small delay between batches
          if (i + batchSize < fixtures.length) {
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        } catch (error) {
          console.error(`Error processing batch ${i + 1}-${Math.min(i + batchSize, fixtures.length)}:`, error);
          // Continue with next batch instead of failing completely
        }
      }

      return {
        success: true,
        message: `Updated XG data for ${totalUpdated} fixtures`,
        updatedCount: totalUpdated,
        updatedFixtureIds: allUpdatedIds
      };
    } catch (error) {
      console.error('XG fetch process failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async fetchXGDataForAllLeagues(
    onProgress?: (league: string, current: number, total: number) => void
  ): Promise<{ success: boolean; message: string; updatedCount?: number; updatedFixtureIds?: number[] }> {
    try {
      log('Starting XG fetch for all leagues...');

      // Get all leagues with XG source configuration
      const leagues = await this.getLeaguesWithXGConfig();

      if (leagues.length === 0) {
        return {
          success: true,
          message: 'No leagues found with XG source configuration',
          updatedCount: 0,
          updatedFixtureIds: []
        };
      }

      let totalUpdated = 0;
      const allUpdatedFixtureIds: number[] = [];

      for (let i = 0; i < leagues.length; i++) {
        const league = leagues[i];

        if (onProgress) {
          onProgress(league.name, i + 1, leagues.length);
        }

        try {
          const result = await this.fetchXGDataForLeague(league.id);
          totalUpdated += result.updatedCount || 0;
          if (result.updatedFixtureIds) {
            allUpdatedFixtureIds.push(...result.updatedFixtureIds);
          }
        } catch (error) {
          console.error(`Error processing league ${league.name}:`, error);
          // Continue with next league
        }

        // Rate limiting between leagues
        if (i + 1 < leagues.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return {
        success: true,
        message: `Updated XG data for ${totalUpdated} fixtures across ${leagues.length} leagues`,
        updatedCount: totalUpdated,
        updatedFixtureIds: allUpdatedFixtureIds
      };
    } catch (error) {
      console.error('Global XG fetch process failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async getFixturesNeedingXG(leagueId?: number): Promise<Fixture[]> {
    let query = `
      SELECT f.* FROM football_fixtures f
      JOIN football_leagues l ON f.league_id = l.id
      WHERE f.date < NOW() AND f.date > NOW() - INTERVAL '5 days'
      AND LOWER(f.status_short) IN ('${IN_PAST.join("', '")}')
      AND (f.xg_home IS NULL OR f.xg_away IS NULL)
      AND l.seasons::jsonb ? f.season::text
    `;
    const params: any[] = [];

    if (leagueId) {
      query += ' AND f.league_id = $1';
      params.push(leagueId);
    }

    query += ' ORDER BY f.timestamp DESC';

    const result = await executeQuery<Fixture>(query, params);
    return result.rows;
  }

  private async getLeagueXGConfig(leagueId: number): Promise<any> {
    const result = await executeQuery(`
      SELECT xg_source, seasons FROM football_leagues WHERE id = $1
    `, [leagueId]);

    if (result.rows.length === 0) return null;

    const league = result.rows[0];
    if (!league.xg_source) return null;

    const xgSource = typeof league.xg_source === 'string'
      ? JSON.parse(league.xg_source)
      : league.xg_source;

    const seasons = typeof league.seasons === 'string'
      ? JSON.parse(league.seasons)
      : league.seasons;

    return { xgSource, seasons };
  }

  private async getLeaguesWithXGConfig(): Promise<Array<{ id: number; name: string }>> {
    const result = await executeQuery(`
      SELECT id, name FROM football_leagues 
      WHERE xg_source IS NOT NULL 
      AND jsonb_typeof(xg_source) = 'object'
      ORDER BY name
    `);

    return result.rows;
  }

  private async processBatch(fixtures: Fixture[]): Promise<{ count: number; updatedIds: number[] }> {
    let updatedCount = 0;
    const updatedIds: number[] = [];

    for (const fixture of fixtures) {
      try {
        const xgData = await this.fetchXGForFixture(fixture, fixtures);
        if (xgData) {
          console.log(`Found XG data for fixture ${fixture.id}: Home ${xgData.home}, Away ${xgData.away}`);
          await this.updateFixtureXG(fixture.id, xgData);
          updatedCount++;
          updatedIds.push(fixture.id);
        }
      } catch (error) {
        console.error(`Error processing fixture ${fixture.id}:`, error);
        // Continue with next fixture
      }

      // Rate limiting: 4 requests per second (250ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    return { count: updatedCount, updatedIds };
  }

  private async fetchXGForFixture(fixture: Fixture, allFixtures?: Fixture[]): Promise<XGData | null> {
    try {
      // Get the xg_source URL for this fixture's round
      const xgSourceUrl = await this.getXGSourceUrlForFixture(fixture);

      // Determine cache expiry based on source
      // If no source found (null), use default 60 min expiry to avoid repeated config lookups for unconfigured leagues
      // If NATIVE, use default
      // If Sofascore/Flashlive, use specific expiry
      const cacheExpiry = xgSourceUrl ? getXGCacheExpiry(xgSourceUrl) : 60 * 60 * 1000;

      // Check cache to prevent repeated attempts
      if (shouldSkipXGFetch(fixture.id, cacheExpiry)) {
        return null;
      }

      let result: XGData | null = null;

      if (!xgSourceUrl) {
        return null;
      }

      if (xgSourceUrl === 'NATIVE') {
        // Use native API (football-api-sports.io)
        result = await this.fetchNativeXG(fixture);
      } else if (xgSourceUrl.includes('-')) {
        // Sofascore format: "55-71183" (tournamentId-seasonId)
        result = await this.fetchSofascoreXG(fixture, xgSourceUrl, allFixtures);
      } else {
        // Flashlive format: "8poTvlIq" (tournamentStageId)
        result = await this.fetchFlashliveXG(fixture, xgSourceUrl, allFixtures);
      }

      // Record the attempt result
      recordXGFetchAttempt(fixture.id, !!result);
      return result;
    } catch (error) {
      console.error(`Error fetching XG for fixture ${fixture.id}:`, error);
      recordXGFetchAttempt(fixture.id, false);
      return null;
    }
  }

  /**
   * Gets the xg_source URL for a fixture based on its league, season, and round
   * Returns null if no xg_source is configured, or the URL string if found
   */
  private async getXGSourceUrlForFixture(fixture: Fixture): Promise<string | null> {
    try {
      const leagueConfig = await this.getLeagueXGConfig(fixture.league_id);
      if (!leagueConfig || !leagueConfig.xgSource) {
        log(`No XG config found for league ${fixture.league_id}`);
        return null;
      }

      const seasonKey = fixture.season.toString();
      const seasonConfig = leagueConfig.xgSource[seasonKey];

      if (!seasonConfig || !seasonConfig.rounds) {
        return null;
      }

      // First, try to find a specific round match
      if (fixture.round) {
        // 1. Exact match
        const roundConfig = seasonConfig.rounds[fixture.round];
        if (roundConfig && roundConfig.url) {
          return roundConfig.url;
        }

        // 2. Base round match (e.g. "Regular Season" matches "Regular Season - 1")
        const roundKeys = Object.keys(seasonConfig.rounds);
        for (const key of roundKeys) {
          if (key !== 'ALL' && fixture.round.startsWith(key + ' - ')) {
            const baseMatchConfig = seasonConfig.rounds[key];
            if (baseMatchConfig && baseMatchConfig.url) {
              return baseMatchConfig.url;
            }
          }
        }

        // 3. Partial match (e.g. "Placement Group" matches "Placement Group - 6") - fallback
        for (const key of roundKeys) {
          if (key !== 'ALL' && fixture.round.includes(key)) {
            const partialMatchConfig = seasonConfig.rounds[key];
            if (partialMatchConfig && partialMatchConfig.url) {
              return partialMatchConfig.url;
            }
          }
        }
      }

      // If no specific round match, check for "ALL" round
      const allRoundConfig = seasonConfig.rounds['ALL'];
      if (allRoundConfig && allRoundConfig.url) {
        return allRoundConfig.url;
      }

      return null;
    } catch (error) {
      console.error(`Error getting xg_source URL for fixture ${fixture.id}:`, error);
      return null;
    }
  }

  private async fetchNativeXG(fixture: Fixture): Promise<XGData | null> {
    try {
      log(`Fetching native XG from API-Football for fixture ${fixture.id}`);
      const response = await axios.get(`${this.apiBaseUrl}/fixtures/statistics`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        },
        params: {
          fixture: fixture.id
        },
        timeout: 15000 // 15 second timeout
      });

      const statistics = response.data.response || [];

      // Extract both home and away xG from the full statistics
      let homeXG = 0;
      let awayXG = 0;

      // Convert fixture team IDs to numbers for comparison
      const fixtureHomeTeamId = parseInt(fixture.home_team_id.toString());
      const fixtureAwayTeamId = parseInt(fixture.away_team_id.toString());

      for (const teamStats of statistics) {
        const teamId = teamStats.team.id;
        const isHome = teamId === fixtureHomeTeamId;
        const isAway = teamId === fixtureAwayTeamId;

        if (teamStats.statistics) {
          for (const stat of teamStats.statistics) {
            if (stat.type === 'expected_goals') {
              const xgValue = parseFloat(stat.value) || 0;

              if (isHome) {
                homeXG = xgValue;
              } else if (isAway) {
                awayXG = xgValue;
              }
            }
          }
        }
      }

      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));

      if (homeXG > 0 || awayXG > 0) {
        return { home: homeXG, away: awayXG };
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  private async fetchSofascoreXG(fixture: Fixture, sourceConfig: string, allFixturesForSource?: Fixture[]): Promise<XGData | null> {
    try {
      const [tournamentIdStr, seasonIdStr] = sourceConfig.split('-');
      const tournamentId = parseInt(tournamentIdStr);
      const seasonId = parseInt(seasonIdStr);
      const cacheKey = `${tournamentId}-${seasonId}`;

      // Check cache first
      let allMatches = this.sofascoreCache.get(cacheKey);

      if (!allMatches) {
        allMatches = [];

        // If we have fixtures to match, track which ones we've found
        const fixturesToFind = allFixturesForSource ? new Set(allFixturesForSource.map(f => f.id)) : null;
        const foundFixtures = new Set<number>();
        let teamMappings: Map<number, string[]> | null = null;

        // Fetch multiple pages until we find matches for all target fixtures or hit limits
        let lastPageSize = 0;
        const seenMatchIds = new Set<number>();
        const maxPages = 5;

        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
          log(`Fetching Sofascore matches: tournament=${tournamentId}, season=${seasonId}, page=${pageIndex}`);
          const matchesResponse = await axios.get('https://sofascore.p.rapidapi.com/tournaments/get-last-matches', {
            headers: {
              'x-rapidapi-key': this.rapidApiKey,
              'x-rapidapi-host': 'sofascore.p.rapidapi.com'
            },
            params: {
              tournamentId: tournamentId,
              seasonId: seasonId,
              pageIndex: pageIndex
            },
            timeout: 15000 // 15 second timeout
          });

          const matchData: SofascoreMatch = matchesResponse.data;
          const matches = matchData.events || [];

          // Rate limiting: 5 requests per second (200ms between requests)
          await new Promise(resolve => setTimeout(resolve, 250));

          // Stop if no matches found
          if (matches.length === 0) {
            break;
          }

          // Filter out duplicate matches
          const newMatches = matches.filter(match => !seenMatchIds.has(match.id));
          if (newMatches.length === 0) {
            break;
          }

          // Add new match IDs to seen set
          newMatches.forEach(match => seenMatchIds.add(match.id));
          allMatches.push(...newMatches);

          // If we have target fixtures, check if we've found matches for all of them
          if (fixturesToFind && allFixturesForSource) {
            // Load team mappings once for all fixtures
            if (!teamMappings) {
              teamMappings = await this.getTeamMappingsForFixtures(allFixturesForSource);
            }

            for (const targetFixture of allFixturesForSource) {
              if (!foundFixtures.has(targetFixture.id)) {
                const matchingEvent = this.findMatchingSofascoreFixture(targetFixture, newMatches, teamMappings);
                if (matchingEvent) {
                  foundFixtures.add(targetFixture.id);
                }
              }
            }

            // Stop if we've found matches for all target fixtures
            if (foundFixtures.size === fixturesToFind.size) {
              log(`Found matches for all ${fixturesToFind.size} target fixtures, stopping pagination`);
              break;
            }
          }

          // Stop if we got fewer matches than the previous page (indicates end of data)
          if (pageIndex > 0 && matches.length < lastPageSize) {
            break;
          }

          lastPageSize = matches.length;
        }

        // Cache the results
        this.sofascoreCache.set(cacheKey, allMatches);
      }

      // Get team mappings for more accurate matching
      const teamMappings = await this.getTeamMappings(fixture.home_team_id, fixture.away_team_id);

      // Find matching fixture using mappings + fuzzy matching
      const matchingEvent = await this.findMatchingSofascoreFixture(fixture, allMatches, teamMappings);
      if (!matchingEvent) {
        log(`No matching Sofascore fixture found for fixture ${fixture.id}`);
        return null;
      }

      // Get statistics for the matched event
      log(`Fetching Sofascore statistics for match ${matchingEvent.id}`);
      const statsResponse = await axios.get('https://sofascore.p.rapidapi.com/matches/get-statistics', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'sofascore.p.rapidapi.com'
        },
        params: {
          matchId: matchingEvent.id
        },
        timeout: 15000 // 15 second timeout
      });

      const statsData: SofascoreStatistics = statsResponse.data;

      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));

      // Check if statistics exists and is iterable
      if (!statsData.statistics || !Array.isArray(statsData.statistics)) {
        log(`No xG statistics available for match ${matchingEvent.id}`);
        return null;
      }

      // Extract XG data from statistics
      for (const period of statsData.statistics) {
        if (period.period === 'ALL') {
          for (const group of period.groups) {
            for (const item of group.statisticsItems) {
              if (item.key === 'expectedGoals') {
                return {
                  home: item.homeValue || 0,
                  away: item.awayValue || 0
                };
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error fetching Sofascore XG:');
      return null;
    }
  }

  private async fetchFlashliveXG(fixture: Fixture, tournamentStageId: string, allFixturesForSource?: Fixture[]): Promise<XGData | null> {
    try {
      const cacheKey = tournamentStageId;

      // Check cache first
      let allEvents = this.flashliveCache.get(cacheKey);

      if (!allEvents) {
        allEvents = [];

        // If we have fixtures to match, track which ones we've found
        const fixturesToFind = allFixturesForSource ? new Set(allFixturesForSource.map(f => f.id)) : null;
        const foundFixtures = new Set<number>();
        let teamMappings: Map<number, string[]> | null = null;

        // Fetch multiple pages until we find matches for all target fixtures or hit limits
        let lastPageSize = 0;
        const seenEventIds = new Set<string>();
        const maxPages = 5; // Reduced from 10 to prevent long hangs

        for (let page = 1; page <= maxPages; page++) {
          try {
            log(`Fetching Flashlive results: tournament_stage=${tournamentStageId}, page=${page}`);
            const matchesResponse = await axios.get('https://flashlive-sports.p.rapidapi.com/v1/tournaments/results', {
              headers: {
                'x-rapidapi-key': this.rapidApiKey,
                'x-rapidapi-host': 'flashlive-sports.p.rapidapi.com'
              },
              params: {
                page: page,
                locale: 'en_INT',
                tournament_stage_id: tournamentStageId
              },
              timeout: 15000 // 15 second timeout
            });

            const matchData: FlashliveMatch = matchesResponse.data;
            const tournaments = matchData.DATA || [];

            // Rate limiting: 5 requests per second (200ms between requests)
            await new Promise(resolve => setTimeout(resolve, 250));

            let pageEvents: any[] = [];
            for (const tournament of tournaments) {
              if (tournament.EVENTS) {
                pageEvents.push(...tournament.EVENTS);
              }
            }

            // Stop if no events found
            if (pageEvents.length === 0) {
              break;
            }

            // Filter out duplicate events
            const newEvents = pageEvents.filter(event => !seenEventIds.has(event.EVENT_ID));
            if (newEvents.length === 0) {
              break;
            }

            // Add new event IDs to seen set
            newEvents.forEach(event => seenEventIds.add(event.EVENT_ID));
            allEvents.push(...newEvents);

            // If we have target fixtures, check if we've found matches for all of them
            if (fixturesToFind && allFixturesForSource) {
              // Load team mappings once for all fixtures
              if (!teamMappings) {
                teamMappings = await this.getTeamMappingsForFixtures(allFixturesForSource);
              }

              for (const targetFixture of allFixturesForSource) {
                if (!foundFixtures.has(targetFixture.id)) {
                  const matchingEvent = this.findMatchingFlashliveFixture(targetFixture, newEvents, teamMappings);
                  if (matchingEvent) {
                    foundFixtures.add(targetFixture.id);
                  }
                }
              }

              // Stop if we've found matches for all target fixtures
              if (foundFixtures.size === fixturesToFind.size) {
                log(`Found matches for all ${fixturesToFind.size} target fixtures, stopping pagination`);
                break;
              }
            }

            // Stop if we got fewer events than the previous page (indicates end of data)
            if (page > 1 && pageEvents.length < lastPageSize) {
              break;
            }

            lastPageSize = pageEvents.length;
          } catch (error) {

            // Check if it's a 404 error - if so, the tournament stage ID is invalid, no point trying more pages
            if (axios.isAxiosError(error) && error.response?.status === 404) {
              break; // Stop trying more pages for this invalid tournament stage
            }

            // Reset lastPageSize and continue to next page
            lastPageSize = 0;
            continue;
          }
        }

        // Cache the results
        this.flashliveCache.set(cacheKey, allEvents);
      }

      // Get team mappings for more accurate matching
      const teamMappings = await this.getTeamMappings(fixture.home_team_id, fixture.away_team_id);

      // Find matching fixture using mappings + fuzzy matching
      const matchingEvent = await this.findMatchingFlashliveFixture(fixture, allEvents, teamMappings);
      if (!matchingEvent) {
        return null;
      }

      console.log(`Found matching Flashlive event: ${matchingEvent.EVENT_ID}`);

      // Get statistics for the matched event
      log(`Fetching Flashlive statistics for event ${matchingEvent.EVENT_ID}`);
      const statsResponse = await axios.get('https://flashlive-sports.p.rapidapi.com/v1/events/statistics', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'flashlive-sports.p.rapidapi.com'
        },
        params: {
          event_id: matchingEvent.EVENT_ID,
          locale: 'en_INT'
        },
        timeout: 15000 // 15 second timeout
      });

      const statsData: FlashliveStatistics = statsResponse.data;

      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));

      // Check if DATA exists and is iterable
      if (!statsData.DATA || !Array.isArray(statsData.DATA)) {
        return null;
      }

      // Extract XG data from statistics
      for (const stage of statsData.DATA) {
        if (!stage.GROUPS || !Array.isArray(stage.GROUPS)) {
          continue;
        }

        for (const group of stage.GROUPS) {
          if (!group.ITEMS || !Array.isArray(group.ITEMS)) {
            continue;
          }

          for (const item of group.ITEMS) {
            if (item.INCIDENT_NAME === 'Expected Goals (xG)') {
              return {
                home: parseFloat(item.VALUE_HOME) || 0,
                away: parseFloat(item.VALUE_AWAY) || 0
              };
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`Error fetching Flashlive XG for fixture ${fixture.id} (tournament stage: ${tournamentStageId}):`);

      // Check if it's a 404 error indicating invalid tournament stage ID
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.error(`Flashlive tournament stage ID '${tournamentStageId}' appears to be invalid (404 - Object not found). Please verify the tournament stage ID is correct for this league/season.`);
      }

      return null;
    }
  }

  private async findMatchingSofascoreFixture(fixture: Fixture, matches: any[], teamMappings: Map<number, string[]>): Promise<any> {
    const fixtureTime = fixture.timestamp;
    const homeScore = fixture.goals_home;
    const awayScore = fixture.goals_away;

    for (const match of matches) {
      // Check if finished
      if (match.status.type !== 'finished') continue;

      // Check time (within 1 hour window)
      const timeDiff = Math.abs(match.startTimestamp - fixtureTime);
      if (timeDiff > 3600) continue; // 3600 seconds = 1 hour

      // Check scores
      if (match.homeScore.current !== homeScore || match.awayScore.current !== awayScore) continue;

      // Check team names using mappings first, then fuzzy matching
      const homeTeamId = parseInt(fixture.home_team_id.toString());
      const awayTeamId = parseInt(fixture.away_team_id.toString());

      const homeMatch = this.matchTeamName(
        teamMappings.get(homeTeamId) || [fixture.home_team_name],
        [match.homeTeam.name, match.homeTeam.shortName].filter(name => name != null)
      );
      const awayMatch = this.matchTeamName(
        teamMappings.get(awayTeamId) || [fixture.away_team_name],
        [match.awayTeam.name, match.awayTeam.shortName].filter(name => name != null)
      );

      if (homeMatch && awayMatch) {
        return match;
      }
    }

    return null;
  }

  private async findMatchingFlashliveFixture(fixture: Fixture, events: any[], teamMappings: Map<number, string[]>): Promise<any> {
    const fixtureTime = fixture.timestamp;
    const homeScore = fixture.goals_home;
    const awayScore = fixture.goals_away;

    for (const event of events) {
      // Check if finished
      if (event.STAGE_TYPE !== 'FINISHED') continue;

      // Check time (within 1 hour window)
      const timeDiff = Math.abs(event.START_UTIME - fixtureTime);
      if (timeDiff > 3600) continue; // 3600 seconds = 1 hour

      // Check scores
      const eventHomeScore = parseInt(event.HOME_SCORE_CURRENT) || 0;
      const eventAwayScore = parseInt(event.AWAY_SCORE_CURRENT) || 0;
      if (eventHomeScore !== homeScore || eventAwayScore !== awayScore) continue;

      // Check team names using mappings first, then fuzzy matching
      const homeTeamId = parseInt(fixture.home_team_id.toString());
      const awayTeamId = parseInt(fixture.away_team_id.toString());

      const homeMatch = this.matchTeamName(
        teamMappings.get(homeTeamId) || [fixture.home_team_name],
        [event.HOME_NAME, event.SHORTNAME_HOME].filter(name => name != null)
      );
      const awayMatch = this.matchTeamName(
        teamMappings.get(awayTeamId) || [fixture.away_team_name],
        [event.AWAY_NAME, event.SHORTNAME_AWAY].filter(name => name != null)
      );

      if (homeMatch && awayMatch) {
        return event;
      }
    }

    return null;
  }

  private matchTeamName(knownNames: string[], candidateNames: string[]): boolean {
    // Filter out null/undefined values and ensure we have strings
    const validKnownNames = knownNames.filter(name => name != null && typeof name === 'string');
    const validCandidateNames = candidateNames.filter(name => name != null && typeof name === 'string');

    // If no valid names to compare, return false
    if (validKnownNames.length === 0 || validCandidateNames.length === 0) {
      return false;
    }

    // First try exact matches (case-insensitive) with known mappings
    for (const knownName of validKnownNames) {
      for (const candidateName of validCandidateNames) {
        if (knownName.toLowerCase().trim() === candidateName.toLowerCase().trim()) {
          return true;
        }
      }
    }

    // If no exact match found, fall back to fuzzy matching
    for (const knownName of validKnownNames) {
      if (this.fuzzyMatchTeamName(knownName, validCandidateNames)) {
        return true;
      }
    }

    return false;
  }

  private fuzzyMatchTeamName(originalName: string, candidateNames: string[]): boolean {
    // Filter out null/undefined values and ensure we have strings
    const validCandidateNames = candidateNames.filter(name => name != null && typeof name === 'string');

    // If no valid candidates, return false
    if (validCandidateNames.length === 0) {
      return false;
    }

    const normalize = (name: string) => name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const originalNormalized = normalize(originalName);

    for (const candidate of validCandidateNames) {
      const candidateNormalized = normalize(candidate);

      // Exact match
      if (originalNormalized === candidateNormalized) return true;

      // Check if one contains the other (for cases like "Manchester City" vs "Man City")
      if (originalNormalized.includes(candidateNormalized) || candidateNormalized.includes(originalNormalized)) {
        return true;
      }

      // Check common abbreviations and variations
      const originalWords = originalNormalized.split(' ');
      const candidateWords = candidateNormalized.split(' ');

      // If both have multiple words, check if they share significant words
      if (originalWords.length > 1 && candidateWords.length > 1) {
        const commonWords = originalWords.filter(word =>
          candidateWords.some(cWord => word.includes(cWord) || cWord.includes(word))
        );
        if (commonWords.length >= Math.min(originalWords.length, candidateWords.length) - 1) {
          return true;
        }
      }
    }

    return false;
  }

  private async updateFixtureXG(fixtureId: number, xgData: XGData): Promise<void> {
    await executeQuery(`
      UPDATE football_fixtures 
      SET xg_home = $1, xg_away = $2, updated_at = NOW()
      WHERE id = $3
    `, [xgData.home, xgData.away, fixtureId]);
  }

  private async getTeamMappings(homeTeamId: number, awayTeamId: number): Promise<Map<number, string[]>> {
    const teamIds = [parseInt(homeTeamId.toString()), parseInt(awayTeamId.toString())];

    const result = await executeQuery(`
      SELECT id, name, mappings FROM football_teams
      WHERE id = ANY($1)
    `, [teamIds]);

    const mappings = new Map<number, string[]>();

    for (const team of result.rows) {
      const teamMappings = [team.name].filter((name: any) => name != null && typeof name === 'string');

      if (team.mappings && Array.isArray(team.mappings)) {
        const validMappings = team.mappings.filter((name: any) => name != null && typeof name === 'string');
        teamMappings.push(...validMappings);
      }

      mappings.set(team.id, teamMappings);
    }

    return mappings;
  }

  private async getTeamMappingsForFixtures(fixtures: Fixture[]): Promise<Map<number, string[]>> {
    const teamIds = fixtures.flatMap(f => [
      parseInt(f.home_team_id.toString()),
      parseInt(f.away_team_id.toString())
    ]);

    const uniqueTeamIds = [...new Set(teamIds)];

    const result = await executeQuery(`
      SELECT id, name, mappings FROM football_teams
      WHERE id = ANY($1)
    `, [uniqueTeamIds]);

    const mappings = new Map<number, string[]>();

    for (const team of result.rows) {
      const teamMappings = [team.name].filter((name: any) => name != null && typeof name === 'string');

      if (team.mappings && Array.isArray(team.mappings)) {
        const validMappings = team.mappings.filter((name: any) => name != null && typeof name === 'string');
        teamMappings.push(...validMappings);
      }

      mappings.set(team.id, teamMappings);
    }

    return mappings;
  }

  private clearCaches(): void {
    this.sofascoreCache.clear();
    this.flashliveCache.clear();
  }

  // New methods for fetching XG by EVENT_ID directly (for manual entry in edit modal)
  async fetchFlashliveXGByEventId(eventId: string): Promise<XGData | null> {
    try {

      // Get statistics for the event
      const statsResponse = await axios.get('https://flashlive-sports.p.rapidapi.com/v1/events/statistics', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'flashlive-sports.p.rapidapi.com'
        },
        params: {
          event_id: eventId,
          locale: 'en_INT'
        },
        timeout: 15000 // 15 second timeout
      });

      const statsData: FlashliveStatistics = statsResponse.data;

      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));

      // Check if DATA exists and is iterable
      if (!statsData.DATA || !Array.isArray(statsData.DATA)) {
        return null;
      }

      // Extract XG data from statistics
      for (const stage of statsData.DATA) {
        if (!stage.GROUPS || !Array.isArray(stage.GROUPS)) {
          continue;
        }

        for (const group of stage.GROUPS) {
          if (!group.ITEMS || !Array.isArray(group.ITEMS)) {
            continue;
          }

          for (const item of group.ITEMS) {
            if (item.INCIDENT_NAME === 'Expected Goals (xG)') {
              return {
                home: parseFloat(item.VALUE_HOME) || 0,
                away: parseFloat(item.VALUE_AWAY) || 0
              };
            }
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async fetchNativeXGByFixtureId(fixtureId: number): Promise<XGData | null> {
    try {
      // Fetch the actual fixture data to get team IDs
      const fixtureResult = await executeQuery<Fixture>(
        'SELECT id, home_team_id, away_team_id FROM football_fixtures WHERE id = $1',
        [fixtureId]
      );

      if (fixtureResult.rows.length === 0) {
        return null;
      }

      const fixture = fixtureResult.rows[0];
      return await this.fetchNativeXG(fixture);
    } catch (error) {
      return null;
    }
  }

  async fetchSofascoreOddsByEventId(eventId: number): Promise<any> {
    try {
      // Get all odds for the match
      const oddsResponse = await axios.get('https://sofascore.p.rapidapi.com/matches/get-all-odds', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'sofascore.p.rapidapi.com'
        },
        params: {
          matchId: eventId
        },
        timeout: 15000 // 15 second timeout
      });

      const oddsData = oddsResponse.data;

      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));

      // The odds data is wrapped in a "markets" property
      const markets = oddsData.markets;
      if (!markets || !Array.isArray(markets)) {
        return null;
      }

      return this.parseSofascoreOdds(markets);
    } catch (error) {
      return null;
    }
  }

  private parseSofascoreOdds(oddsData: any[]): any {
    const result = {
      opening_x12_home: '',
      opening_x12_draw: '',
      opening_x12_away: '',
      opening_ou25_over: '',
      opening_ou25_under: '',
      closing_x12_home: '',
      closing_x12_draw: '',
      closing_x12_away: '',
      closing_ou25_over: '',
      closing_ou25_under: ''
    };

    for (const market of oddsData) {
      // X12 odds - marketId 1 represents the main match result (1X2)
      if (market.marketId === 1) {
        for (const choice of market.choices || []) {
          const openingDecimal = this.fractionalToDecimal(choice.initialFractionalValue);
          const closingDecimal = this.fractionalToDecimal(choice.fractionalValue);

          if (choice.name === '1' || choice.name === 'Home') {
            result.opening_x12_home = openingDecimal;
            result.closing_x12_home = closingDecimal;
          } else if (choice.name === 'X' || choice.name === 'Draw') {
            result.opening_x12_draw = openingDecimal;
            result.closing_x12_draw = closingDecimal;
          } else if (choice.name === '2' || choice.name === 'Away') {
            result.opening_x12_away = openingDecimal;
            result.closing_x12_away = closingDecimal;
          }
        }
      }

      // Over/Under 2.5 goals
      if (market.marketId === 9 && market.choiceGroup === '2.5') {
        for (const choice of market.choices || []) {
          const openingDecimal = this.fractionalToDecimal(choice.initialFractionalValue);
          const closingDecimal = this.fractionalToDecimal(choice.fractionalValue);

          if (choice.name === 'Over') {
            result.opening_ou25_over = openingDecimal;
            result.closing_ou25_over = closingDecimal;
          } else if (choice.name === 'Under') {
            result.opening_ou25_under = openingDecimal;
            result.closing_ou25_under = closingDecimal;
          }
        }
      }
    }

    return result;
  }

  private fractionalToDecimal(fractional: string): string {
    if (!fractional || !fractional.includes('/')) {
      return '';
    }

    const [numerator, denominator] = fractional.split('/').map(Number);
    if (isNaN(numerator) || isNaN(denominator) || denominator === 0) {
      return '';
    }

    const decimal = (numerator / denominator) + 1;
    return decimal.toFixed(2);
  }

  async fetchSofascoreXGByEventId(eventId: number): Promise<XGData | null> {
    try {

      // Get statistics for the event
      const statsResponse = await axios.get('https://sofascore.p.rapidapi.com/matches/get-statistics', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'sofascore.p.rapidapi.com'
        },
        params: {
          matchId: eventId
        },
        timeout: 15000 // 15 second timeout
      });

      const statsData: SofascoreStatistics = statsResponse.data;

      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 250));

      // Check if statistics exists and is iterable
      if (!statsData.statistics || !Array.isArray(statsData.statistics)) {
        console.log(`No statistics data available for Sofascore event ${eventId}`);
        return null;
      }

      // Extract XG data from statistics
      for (const period of statsData.statistics) {
        if (period.period === 'ALL') {
          for (const group of period.groups) {
            for (const item of group.statisticsItems) {
              if (item.key === 'expectedGoals') {
                return {
                  home: item.homeValue || 0,
                  away: item.awayValue || 0
                };
              }
            }
          }
        }
      }

      console.log(`No xG statistics found for Sofascore event ${eventId}`);
      return null;
    } catch (error) {
      console.error(`Error fetching Sofascore XG for event ${eventId}:`, error);
      return null;
    }
  }
}