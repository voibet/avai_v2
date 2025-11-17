import axios from 'axios';
import { executeQuery } from '../../database/db-utils';
import { findMatchingFixture } from '../../utils/fixture-matching';
import { IN_FUTURE } from '../../constants';

interface PinnacleMarket {
  sport_id: number;
  sport_name: string;
  last: number;
  last_call: number;
  events: PinnacleEvent[];
}

interface PinnacleEvent {
  event_id: number;
  sport_id: number;
  league_id: number;
  league_name: string;
  starts: string;
  last: number;
  home: string;
  away: string;
  event_type: string;
  live_status_id: number;
  parent_id?: number;
  resulting_unit: string;
  is_actual: boolean;
  home_team_type: string;
  is_have_odds: boolean;
  is_have_periods: boolean;
  is_have_open_markets: boolean;
  periods: {
    num_0: PinnaclePeriod;
  };
}

interface PinnaclePeriod {
  line_id: number;
  number: number;
  description: string;
  cutoff: string;
  period_status: number;
  money_line: {
    home: number;
    draw: number;
    away: number;
  };
  spreads: {
    [key: string]: PinnacleSpread;
  };
  totals: {
    [key: string]: PinnacleTotal;
  };
  meta: {
    number: number;
    max_money_line: number;
    max_spread: number;
    max_total: number;
    max_team_total: number;
    open_money_line: boolean;
    open_spreads: boolean;
    open_totals: boolean;
    open_team_total: boolean;
  };
}

interface PinnacleSpread {
  hdp: number;
  alt_line_id?: number;
  home: number;
  away: number;
  max: number;
}

interface PinnacleTotal {
  points: number;
  alt_line_id?: number;
  over: number;
  under: number;
  max: number;
}

class PinnacleOddsService {
  private readonly rapidApiKey = process.env.RAPID_API_KEY;
  private readonly baseUrl = 'https://pinnacle-odds.p.rapidapi.com';
  private readonly headers = {
    'x-rapidapi-key': this.rapidApiKey,
    'x-rapidapi-host': 'pinnacle-odds.p.rapidapi.com'
  };

  private lastTimestamp: number | null = null;
  private knownPinnacleLeagues: Set<number> = new Set();
  private isRunning: boolean = false;
  private runInterval: NodeJS.Timeout | null = null;

  /**
   * Helper for consistent logging with timestamp and service prefix
   */
  private log(message: string): void {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
    console.log(`${time} Pinnacle: ${message}`);
  }

  /**
   * Loads known pinnacle league IDs from database
   */
  private async loadKnownPinnacleLeagues(): Promise<void> {
    try {
      const query = `
        SELECT pinnacle_league_id
        FROM football_leagues
        WHERE pinnacle_league_id IS NOT NULL
      `;
      const result = await executeQuery(query);

      this.knownPinnacleLeagues = new Set(
        result.rows
          .map(row => row.pinnacle_league_id)
          .filter(id => id !== null)
      );

      this.log(`Loaded ${this.knownPinnacleLeagues.size} known league IDs`);
    } catch (error) {
      console.error('Error loading known Pinnacle leagues:', error);
      this.knownPinnacleLeagues = new Set();
    }
  }

  /**
   * Fetches odds from Pinnacle API
   */
  async fetchOdds(): Promise<PinnacleMarket | null> {
    try {
      const params: any = {
        event_type: 'prematch',
        sport_id: 1, // Football
      };

      // Use last timestamp if available, otherwise use current timestamp
      if (this.lastTimestamp) {
        params.since = this.lastTimestamp;
      } else {
        params.since = Math.floor(Date.now() / 1000);
      }

      const response = await axios.get(`${this.baseUrl}/kit/v1/markets`, {
        headers: this.headers,
        params,
        timeout: 1000 // 1 second timeout
      });

      if (response.data && response.data.last !== undefined) {
        // Update last timestamp for next call
        this.lastTimestamp = response.data.last;
      }

      return response.data;
    } catch (error) {
      console.error('Pinnacle API timeout');
      return null;
    }
  }

  /**
   * Processes and stores odds data for matching fixtures
   */
  async processAndStoreOdds(marketData: PinnacleMarket): Promise<{
    eventsProcessed: number;
    fixturesUpdated: number;
  }> {

    if (!marketData.events || marketData.events.length === 0) {
      return { eventsProcessed: 0, fixturesUpdated: 0 };
    }

    // Load leagues once
    if (this.knownPinnacleLeagues.size === 0) {
      await this.loadKnownPinnacleLeagues();
    }

    // Filter events to only those with known league IDs
    const filteredEvents = marketData.events.filter(event =>
      this.knownPinnacleLeagues.has(event.league_id)
    );

    let eventsProcessed = 0;
    let fixturesUpdated = 0;

    for (const event of filteredEvents) {
      try {
        const result = await this.processEventOdds(event);
        eventsProcessed++;
        if (result.updated) {
          fixturesUpdated++;
        }
      } catch (error) {
        console.error(`Error processing event ${event.event_id}:`, error);
      }
    }

    return { eventsProcessed, fixturesUpdated };
  }

  /**
   * Processes odds for a single event
   */
  private async processEventOdds(event: PinnacleEvent): Promise<{ updated: boolean }> {

    const period = event.periods?.num_0;
    if (!period) {
      return { updated: false };
    }

    // Check if market is open for betting (all criteria must be true)
    const hasOdds = period.money_line || period.spreads || period.totals;
    const cutoffInFuture = period.cutoff && new Date(period.cutoff) > new Date();
    const metaOpenFlags = period.meta?.open_money_line || period.meta?.open_spreads || period.meta?.open_totals;

    const isMarketOpen = period.period_status === 1 &&
                        hasOdds &&
                        cutoffInFuture &&
                        metaOpenFlags;

    // Only process if market is open
    if (!isMarketOpen) {
      return { updated: false };
    }

    // Check if we already have odds for this Pinnacle event
    const existingOddsQuery = `
      SELECT fixture_id
      FROM football_odds
      WHERE bookie_id = $1 AND bookie = 'Pinnacle'
    `;
    const existingOddsResult = await executeQuery(existingOddsQuery, [event.event_id]);

    if (existingOddsResult.rows.length > 0) {
      // Update existing odds
      await this.updateExistingOdds(event.event_id, period);
      return { updated: true };
    }

    // No existing odds found - create new entry
    this.log(`No existing odds for event ${event.event_id}, searching for fixture match...`);

    // Parse start time
    const startTime = new Date(event.starts);

    // Find matching fixture using global helper
    const fixtureId = await this.findMatchingFixture(
      startTime,
      event.home,
      event.away,
      event.league_id
    );

    if (!fixtureId) {
      this.log(`No matching fixture found for event ${event.event_id}: ${event.home} vs ${event.away}`);
      return { updated: false };
    }

    this.log(`Found matching fixture ${fixtureId} for event ${event.event_id}`);

    // Create new odds entry
    await this.createNewOddsEntry(fixtureId, event.event_id, period);
    return { updated: true };
  }

  /**
   * Finds a matching fixture based on criteria using global helper
   */
  private async findMatchingFixture(
    startTime: Date,
    homeTeam: string,
    awayTeam: string,
    pinnacleLeagueId: number
  ): Promise<number | null> {
    try {
      // Find league by pinnacle_league_id
      const leagueQuery = `
        SELECT id FROM football_leagues
        WHERE pinnacle_league_id = $1
      `;
      const leagueResult = await executeQuery(leagueQuery, [pinnacleLeagueId]);

      if (leagueResult.rows.length === 0) {
        this.log(`No league found for pinnacle_league_id ${pinnacleLeagueId}`);
        return null;
      }

      const leagueId = leagueResult.rows[0].id;

      // Use global helper function
      return await findMatchingFixture({
        startTime,
        homeTeam,
        awayTeam,
        leagueId
      });
    } catch (error) {
      console.error('Error finding matching fixture:', error);
      return null;
    }
  }

  /**
   * Updates existing odds for a Pinnacle event
   */
  private async updateExistingOdds(eventId: number, period: PinnaclePeriod): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Transform Pinnacle odds to our format (decimals = 3, multiply by 1000)
    const transformOdds = (odds: number): number => {
      return Math.round(odds * 1000);
    };

    // Get current odds data from database
    const selectQuery = `
      SELECT fixture_id, odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t
      FROM football_odds
      WHERE bookie_id = $1 AND bookie = 'Pinnacle'
    `;
    const selectResult = await executeQuery(selectQuery, [eventId]);

    if (selectResult.rows.length === 0) {
      throw new Error(`No existing odds found for event ${eventId}`);
    }

    const row = selectResult.rows[0];
    const fixtureId = row.fixture_id;

    // Parse existing data
    const parseJsonArray = (value: any): any[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    let x12Odds = parseJsonArray(row.odds_x12);
    let ahOdds = parseJsonArray(row.odds_ah);
    let ouOdds = parseJsonArray(row.odds_ou);
    let lines = parseJsonArray(row.lines);
    let ids = parseJsonArray(row.ids);
    let maxStakes = parseJsonArray(row.max_stakes);
    let latestT = row.latest_t || {};

    // Update X12 odds
    if (period.money_line) {
      const newX12Entry = {
        t: timestamp,
        x12: [
          transformOdds(period.money_line.home),
          transformOdds(period.money_line.draw),
          transformOdds(period.money_line.away)
        ]
      };
      x12Odds.push(newX12Entry);
      latestT.x12_ts = timestamp;
    }

    // Collect line data for both AH and OU
    let combinedLineEntry: any = { t: timestamp };
    let combinedIdEntry: any = { t: timestamp, line_id: period.line_id, line_ids: {} };

    // Update AH odds
    if (period.spreads && Object.keys(period.spreads).length > 0) {
      const spreadKeys = Object.keys(period.spreads).sort((a, b) => parseFloat(a) - parseFloat(b));

      const ahHome: number[] = [];
      const ahAway: number[] = [];
      const ahLineValues: number[] = [];
      const ahAltLineIds: number[] = [];

      spreadKeys.forEach(key => {
        const spread = period.spreads[key];
        ahHome.push(transformOdds(spread.home));
        ahAway.push(transformOdds(spread.away));
        ahLineValues.push(spread.hdp);
        ahAltLineIds.push(spread.alt_line_id || 0);
      });

      const newAhEntry = {
        t: timestamp,
        ah_h: ahHome,
        ah_a: ahAway
      };

      ahOdds.push(newAhEntry);
      combinedLineEntry.ah = ahLineValues;
      combinedIdEntry.line_ids.ah = ahAltLineIds;
      latestT.ah_ts = timestamp;
    }

    // Update OU odds
    if (period.totals && Object.keys(period.totals).length > 0) {
      const totalKeys = Object.keys(period.totals).sort((a, b) => parseFloat(a) - parseFloat(b));

      const ouOver: number[] = [];
      const ouUnder: number[] = [];
      const ouLineValues: number[] = [];
      const ouAltLineIds: number[] = [];

      totalKeys.forEach(key => {
        const total = period.totals[key];
        ouOver.push(transformOdds(total.over));
        ouUnder.push(transformOdds(total.under));
        ouLineValues.push(total.points);
        ouAltLineIds.push(total.alt_line_id || 0);
      });

      const newOuEntry = {
        t: timestamp,
        ou_o: ouOver,
        ou_u: ouUnder
      };

      ouOdds.push(newOuEntry);
      combinedLineEntry.ou = ouLineValues;
      combinedIdEntry.line_ids.ou = ouAltLineIds;
      latestT.ou_ts = timestamp;
    }

    // Add combined line entry if we have any lines
    if (combinedLineEntry.ah || combinedLineEntry.ou) {
      lines.push(combinedLineEntry);
      latestT.lines_ts = timestamp;
    }

    // Add combined ID entry if we have any IDs
    if (Object.keys(combinedIdEntry.line_ids).length > 0) {
      ids.push(combinedIdEntry);
      latestT.ids_ts = timestamp;
    }

    // Update max stakes
    if (period.meta) {
      const newMaxStakeEntry = {
        t: timestamp,
        max_stake_x12: period.meta.max_money_line ? [period.meta.max_money_line] : [],
        max_stake_ah: period.meta.max_spread ? { h: [period.meta.max_spread], a: [period.meta.max_spread] } : {},
        max_stake_ou: period.meta.max_total ? { o: [period.meta.max_total], u: [period.meta.max_total] } : {}
      };
      maxStakes.push(newMaxStakeEntry);
      latestT.stakes_ts = timestamp;
    }

    // Update the database
    const updateQuery = `
      UPDATE football_odds
      SET odds_x12 = $1, odds_ah = $2, odds_ou = $3, lines = $4, ids = $5, max_stakes = $6, latest_t = $7, updated_at = now()
      WHERE bookie_id = $8 AND bookie = 'Pinnacle'
    `;

    await executeQuery(updateQuery, [
      x12Odds.length > 0 ? JSON.stringify(x12Odds) : null,
      ahOdds.length > 0 ? JSON.stringify(ahOdds) : null,
      ouOdds.length > 0 ? JSON.stringify(ouOdds) : null,
      lines.length > 0 ? JSON.stringify(lines) : null,
      ids.length > 0 ? JSON.stringify(ids) : null,
      maxStakes.length > 0 ? JSON.stringify(maxStakes) : null,
      JSON.stringify(latestT),
      eventId
    ]);

    this.log(`Updated event ${eventId}`);
  }

  /**
   * Creates new odds entry for a fixture
   */
  private async createNewOddsEntry(
    fixtureId: number,
    eventId: number,
    period: PinnaclePeriod
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Transform Pinnacle odds to our format (decimals = 3, multiply by 1000)
    const transformOdds = (odds: number): number => {
      return Math.round(odds * 1000);
    };

    // Prepare X12 odds (money line)
    let x12Odds: any[] = [];
    if (period.money_line) {
      x12Odds.push({
        t: timestamp,
        x12: [
          transformOdds(period.money_line.home),
          transformOdds(period.money_line.draw),
          transformOdds(period.money_line.away)
        ]
      });
    }

    // Prepare AH odds (spreads)
    let ahOdds: any[] = [];
    let ouOdds: any[] = [];
    let lines: any[] = [];
    let ids: any[] = [];

    // Collect combined line data
    let combinedLineEntry: any = { t: timestamp };
    let combinedIdEntry: any = { t: timestamp, line_id: period.line_id, line_ids: {} };

    if (period.spreads && Object.keys(period.spreads).length > 0) {
      const spreadKeys = Object.keys(period.spreads).sort((a, b) => parseFloat(a) - parseFloat(b));

      const ahHome: number[] = [];
      const ahAway: number[] = [];
      const ahLineValues: number[] = [];
      const ahAltLineIds: number[] = [];

      spreadKeys.forEach(key => {
        const spread = period.spreads[key];
        ahHome.push(transformOdds(spread.home));
        ahAway.push(transformOdds(spread.away));
        ahLineValues.push(spread.hdp);
        ahAltLineIds.push(spread.alt_line_id || 0);
      });

      ahOdds.push({
        t: timestamp,
        ah_h: ahHome,
        ah_a: ahAway
      });

      combinedLineEntry.ah = ahLineValues;
      combinedIdEntry.line_ids.ah = ahAltLineIds;
    }

    if (period.totals && Object.keys(period.totals).length > 0) {
      const totalKeys = Object.keys(period.totals).sort((a, b) => parseFloat(a) - parseFloat(b));

      const ouOver: number[] = [];
      const ouUnder: number[] = [];
      const ouLineValues: number[] = [];
      const ouAltLineIds: number[] = [];

      totalKeys.forEach(key => {
        const total = period.totals[key];
        ouOver.push(transformOdds(total.over));
        ouUnder.push(transformOdds(total.under));
        ouLineValues.push(total.points);
        ouAltLineIds.push(total.alt_line_id || 0);
      });

      ouOdds.push({
        t: timestamp,
        ou_o: ouOver,
        ou_u: ouUnder
      });

      combinedLineEntry.ou = ouLineValues;
      combinedIdEntry.line_ids.ou = ouAltLineIds;
    }

    // Add combined entries
    if (combinedLineEntry.ah || combinedLineEntry.ou) {
      lines.push(combinedLineEntry);
    }

    if (Object.keys(combinedIdEntry.line_ids).length > 0) {
      ids.push(combinedIdEntry);
    }

    // Prepare max stakes
    let maxStakes: any[] = [];
    if (period.meta) {
      maxStakes.push({
        t: timestamp,
        max_stake_x12: period.meta.max_money_line ? [period.meta.max_money_line] : [],
        max_stake_ah: period.meta.max_spread ? { h: [period.meta.max_spread], a: [period.meta.max_spread] } : {},
        max_stake_ou: period.meta.max_total ? { o: [period.meta.max_total], u: [period.meta.max_total] } : {}
      });
    }

    // Prepare latest_t
    const latestT: any = {};
    if (x12Odds.length > 0) latestT.x12_ts = timestamp;
    if (ahOdds.length > 0) latestT.ah_ts = timestamp;
    if (ouOdds.length > 0) latestT.ou_ts = timestamp;
    if (lines.length > 0) latestT.lines_ts = timestamp;
    if (ids.length > 0) latestT.ids_ts = timestamp;
    if (maxStakes.length > 0) latestT.stakes_ts = timestamp;

    // Insert new record
    const insertQuery = `
      INSERT INTO football_odds (
        fixture_id, bookie_id, bookie, decimals,
        odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    await executeQuery(insertQuery, [
      fixtureId,
      eventId,
      'Pinnacle',
      3, // decimals = 3
      x12Odds.length > 0 ? JSON.stringify(x12Odds) : null,
      ahOdds.length > 0 ? JSON.stringify(ahOdds) : null,
      ouOdds.length > 0 ? JSON.stringify(ouOdds) : null,
      lines.length > 0 ? JSON.stringify(lines) : null,
      ids.length > 0 ? JSON.stringify(ids) : null,
      maxStakes.length > 0 ? JSON.stringify(maxStakes) : null,
      JSON.stringify(latestT)
    ]);

    this.log(`Created new odds entry for fixture ${fixtureId}, event ${eventId}`);
  }


  /**
   * Main method to fetch and process odds
   */
  async fetchAndProcessOdds(): Promise<{
    eventsProcessed: number;
    fixturesUpdated: number;
  }> {

    const marketData = await this.fetchOdds();
    if (!marketData) {
      this.log('No market data received');
      return { eventsProcessed: 0, fixturesUpdated: 0 };
    }

    const result = await this.processAndStoreOdds(marketData);
    return result;
  }

  /**
   * Starts continuous odds fetching every ~1 second
   */
  async startContinuousFetching(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    const runFetch = async () => {
      if (!this.isRunning) return;

      const startTime = Date.now();

      try {
        await this.fetchAndProcessOdds();
      } catch (error) {
        console.error('Error in continuous fetch:', error);
      }

      if (!this.isRunning) return;

      // Calculate time to wait (1 second minus processing time)
      const processingTime = Date.now() - startTime;
      const waitTime = Math.max(0, 1000 - processingTime);

      // option log: console.log(`Processing took ${processingTime}ms, waiting ${waitTime}ms`);

      this.runInterval = setTimeout(runFetch, waitTime);
    };

    // Start immediately
    await runFetch();
  }

  /**
   * Stops continuous odds fetching
   */
  stopContinuousFetching(): void {
    if (!this.isRunning) {
      this.log('Service is not running');
      return;
    }

    this.isRunning = false;
    if (this.runInterval) {
      clearTimeout(this.runInterval);
      this.runInterval = null;
    }

    this.log('Service stopped');
  }


  /**
   * Gets the current running status
   */
  isContinuousFetchingRunning(): boolean {
    return this.isRunning;
  }
}

export const pinnacleOddsService = new PinnacleOddsService();
