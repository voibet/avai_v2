import axios from 'axios';
import { executeQuery } from './db-utils';
import { Fixture } from '../types/database';

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
      console.log(`Starting XG fetch for league ${leagueId}...`);
      
      // Clear caches to ensure fresh data for new league
      this.clearCaches();

      // Get finished fixtures without XG data for this league
      const fixtures = await this.getFixturesNeedingXG(leagueId);
      
      if (fixtures.length === 0) {
        console.log(`Found ${fixtures.length} fixtures needing XG data`);
        return {
          success: true,
          message: 'No fixtures found that need XG data',
          updatedCount: 0,
          updatedFixtureIds: []
        };
      }

      console.log(`Found ${fixtures.length} fixtures needing XG data`);

      // Get league's XG source configuration
      const leagueConfig = await this.getLeagueXGConfig(leagueId);
      if (!leagueConfig) {
        return {
          success: false,
          message: 'No XG source configuration found for this league'
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
          const batchResult = await this.processBatch(batch, leagueConfig);
          totalUpdated += batchResult.count;
          allUpdatedIds.push(...batchResult.updatedIds);

          // Rate limiting - small delay between batches
          if (i + batchSize < fixtures.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
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
      console.log('Starting XG fetch for all leagues...');

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
      WHERE f.status_short IN ('AET', 'FT', 'PEN') 
      AND (f.xg_home IS NULL OR f.xg_away IS NULL)
      AND l.seasons::jsonb ? f.season::text
      AND (l.seasons::jsonb -> f.season::text ->> 'current')::boolean = true
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

  private async processBatch(fixtures: Fixture[], leagueConfig: any): Promise<{ count: number; updatedIds: number[] }> {
    let updatedCount = 0;
    const updatedIds: number[] = [];

    // Group fixtures by XG source to optimize caching
    const fixturesBySource = new Map<string, Fixture[]>();
    
    for (const fixture of fixtures) {
      const seasonStr = fixture.season.toString();
      const xgSourceConfig = leagueConfig.xgSource[seasonStr];
      
      if (xgSourceConfig && xgSourceConfig.rounds) {
        // Extract base round name by cutting off everything after " - "
        const baseRoundName = fixture.round ? fixture.round.split(' - ')[0] : '';
        const roundConfig = xgSourceConfig.rounds[baseRoundName] || xgSourceConfig.rounds['ALL'];
        
        if (roundConfig) {
          const sourceKey = roundConfig.url;
          if (!fixturesBySource.has(sourceKey)) {
            fixturesBySource.set(sourceKey, []);
          }
          fixturesBySource.get(sourceKey)!.push(fixture);
        }
      }
    }

    // Process each source group efficiently
    for (const [_sourceUrl, sourceFixtures] of Array.from(fixturesBySource.entries())) {
      for (const fixture of sourceFixtures) {
        try {
          console.log(`Processing fixture ${fixture.id}: ${fixture.home_team_name} vs ${fixture.away_team_name} (Season: ${fixture.season}, Round: ${fixture.round})`);
          
          const xgData = await this.fetchXGForFixture(fixture, leagueConfig, sourceFixtures);
          if (xgData) {
            console.log(`Found XG data for fixture ${fixture.id}: Home ${xgData.home}, Away ${xgData.away}`);
            await this.updateFixtureXG(fixture.id, xgData);
            updatedCount++;
            updatedIds.push(fixture.id);
          }
        } catch (error) {
          console.error(`❌ Error processing fixture ${fixture.id}:`, error);
          // Continue with next fixture
        }

        // Rate limiting: 5 requests per second (200ms between requests)
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return { count: updatedCount, updatedIds };
  }

  private async fetchXGForFixture(fixture: Fixture, leagueConfig: any, allFixturesForSource?: Fixture[]): Promise<XGData | null> {
    try {
      const seasonStr = fixture.season.toString();
      const xgSourceConfig = leagueConfig.xgSource[seasonStr];

      if (!xgSourceConfig || !xgSourceConfig.rounds) {
        return null;
      }

      // Extract base round name by cutting off everything after " - "
      const baseRoundName = fixture.round ? fixture.round.split(' - ')[0] : '';
      
      // Check if fixture's base round or ALL rounds have XG source
      const roundConfig = xgSourceConfig.rounds[baseRoundName] || xgSourceConfig.rounds['ALL'];
      
      if (!roundConfig) {
        return null;
      }

      const xgSourceUrl = roundConfig.url;

      if (xgSourceUrl === 'NATIVE') {
        return await this.fetchNativeXG(fixture);
      } else if (xgSourceUrl.includes('-')) {
        // Sofascore format: tournamentId-seasonId
        return await this.fetchSofascoreXG(fixture, xgSourceUrl, allFixturesForSource);
      } else {
        // Flashlive format: tournament_stage_id
        return await this.fetchFlashliveXG(fixture, xgSourceUrl, allFixturesForSource);
      }
    } catch (error) {
      console.error(`Error fetching XG for fixture ${fixture.id}:`, error);
      return null;
    }
  }

  private async fetchNativeXG(fixture: Fixture): Promise<XGData | null> {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/fixtures/statistics`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        },
        params: {
          fixture: fixture.id
        },
        timeout: 30000 // 30 second timeout
      });

      const statistics = response.data.response || [];
      
      // Extract both home and away xG from the full statistics
      let homeXG = 0;
      let awayXG = 0;

      for (const teamStats of statistics) {
        // Convert fixture team IDs to numbers for comparison
        const fixtureHomeTeamId = parseInt(fixture.home_team_id.toString());
        const fixtureAwayTeamId = parseInt(fixture.away_team_id.toString());
        
        const isHome = teamStats.team.id === fixtureHomeTeamId;
        const isAway = teamStats.team.id === fixtureAwayTeamId;
        
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
      await new Promise(resolve => setTimeout(resolve, 200));
      
      return homeXG > 0 || awayXG > 0 ? { home: homeXG, away: awayXG } : null;
    } catch (error) {
      console.error('Error fetching native XG:', error);
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
        
        // Fetch multiple pages (up to 10) to get comprehensive match data
        let lastPageSize = 0;
        const seenMatchIds = new Set<number>();
        const targetFixtureCount = allFixturesForSource?.length || 999; // If not specified, keep old behavior
        
        for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
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
            timeout: 30000 // 30 second timeout
          });

          const matchData: SofascoreMatch = matchesResponse.data;
          const matches = matchData.events || [];
          
          // Rate limiting: 5 requests per second (200ms between requests)
          await new Promise(resolve => setTimeout(resolve, 200));
          
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
          
          // Stop early if we have significantly more matches than fixtures we need
          if (allMatches.length >= targetFixtureCount * 3) {
            break;
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
        console.log(`No matching Sofascore fixture found for fixture ${fixture.id}`);
        return null;
      }

      // Get statistics for the matched event
      const statsResponse = await axios.get('https://sofascore.p.rapidapi.com/matches/get-statistics', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'sofascore.p.rapidapi.com'
        },
        params: {
          matchId: matchingEvent.id
        },
        timeout: 30000 // 30 second timeout
      });

      const statsData: SofascoreStatistics = statsResponse.data;
      
      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Check if statistics exists and is iterable
      if (!statsData.statistics || !Array.isArray(statsData.statistics)) {
        console.log(`❌ No xG statistics available for match ${matchingEvent.id}`);
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
      console.error('Error fetching Sofascore XG:', error);
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
        
        // Fetch multiple pages (up to 10) to get comprehensive match data
        let lastPageSize = 0;
        const seenEventIds = new Set<string>();
        const targetFixtureCount = allFixturesForSource?.length || 999; // If not specified, keep old behavior
        
        for (let page = 1; page <= 10; page++) {
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
            timeout: 30000 // 30 second timeout
          });

          const matchData: FlashliveMatch = matchesResponse.data;
          const tournaments = matchData.DATA || [];
          
          // Rate limiting: 5 requests per second (200ms between requests)
          await new Promise(resolve => setTimeout(resolve, 200));
          
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
          
          // Stop early if we have significantly more events than fixtures we need
          if (allEvents.length >= targetFixtureCount * 3) {
            break;
          }
          
          // Stop if we got fewer events than the previous page (indicates end of data)
          if (page > 1 && pageEvents.length < lastPageSize) {
            break;
          }
          
          lastPageSize = pageEvents.length;
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

      // Get statistics for the matched event
      const statsResponse = await axios.get('https://flashlive-sports.p.rapidapi.com/v1/events/statistics', {
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': 'flashlive-sports.p.rapidapi.com'
        },
        params: {
          event_id: matchingEvent.EVENT_ID,
          locale: 'en_INT'
        },
        timeout: 30000 // 30 second timeout
      });

      const statsData: FlashliveStatistics = statsResponse.data;
      
      // Rate limiting: 5 requests per second (200ms between requests)
      await new Promise(resolve => setTimeout(resolve, 200));
      
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
      console.error('Error fetching Flashlive XG:', error);
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
        [match.homeTeam.name, match.homeTeam.shortName]
      );
      const awayMatch = this.matchTeamName(
        teamMappings.get(awayTeamId) || [fixture.away_team_name],
        [match.awayTeam.name, match.awayTeam.shortName]
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
        [event.HOME_NAME, event.SHORTNAME_HOME]
      );
      const awayMatch = this.matchTeamName(
        teamMappings.get(awayTeamId) || [fixture.away_team_name],
        [event.AWAY_NAME, event.SHORTNAME_AWAY]
      );

      if (homeMatch && awayMatch) {
        return event;
      }
    }

    return null;
  }

  private matchTeamName(knownNames: string[], candidateNames: string[]): boolean {
    // First try exact matches (case-insensitive) with known mappings
    for (const knownName of knownNames) {
      for (const candidateName of candidateNames) {
        if (knownName.toLowerCase().trim() === candidateName.toLowerCase().trim()) {
          return true;
        }
      }
    }
    
    // If no exact match found, fall back to fuzzy matching
    for (const knownName of knownNames) {
      if (this.fuzzyMatchTeamName(knownName, candidateNames)) {
        return true;
      }
    }
    
    return false;
  }

  private fuzzyMatchTeamName(originalName: string, candidateNames: string[]): boolean {
    const normalize = (name: string) => name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const originalNormalized = normalize(originalName);
    
    for (const candidate of candidateNames) {
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
      const teamMappings = [team.name]; // Start with official name
      
      if (team.mappings && Array.isArray(team.mappings)) {
        teamMappings.push(...team.mappings);
      }
      
      mappings.set(team.id, teamMappings);
    }
    
    return mappings;
  }

  private clearCaches(): void {
    this.sofascoreCache.clear();
    this.flashliveCache.clear();
  }
}