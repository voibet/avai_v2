import axios from 'axios';
import { executeQuery } from '../database/db-utils';
import { findMatchingFixture } from '../utils/fixture-matching';

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

      console.log(`Loaded ${this.knownPinnacleLeagues.size} known Pinnacle league IDs`);
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
      console.error('Error fetching Pinnacle odds:', error);
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

    console.log(`Processing ${filteredEvents.length} events (filtered from ${marketData.events.length})`);

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
      console.log(`No period data for event ${event.event_id}`);
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

    // Always check if we already have odds for this Pinnacle event
    const existingOddsQuery = `
      SELECT fixture_id
      FROM football_odds
      WHERE bookie_id = $1 AND bookie = 'Pinnacle'
    `;
    const existingOddsResult = await executeQuery(existingOddsQuery, [event.event_id]);

    if (existingOddsResult.rows.length > 0) {
      // Update existing odds - if market closed, send empty odds
      const wasUpdated = await this.updateExistingOdds(event.event_id, period, !isMarketOpen);
      return { updated: wasUpdated };
    }

    // No existing odds found - only create new if market is open
    if (!isMarketOpen) {
      console.log(`Skipping new event ${event.event_id} - market closed`);
      return { updated: false };
    }

    console.log(`No existing odds for event ${event.event_id}, searching for fixture match...`);

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
      console.log(`No matching fixture found for event ${event.event_id}: ${event.home} vs ${event.away}`);
      return { updated: false };
    }

    console.log(`Found matching fixture ${fixtureId} for event ${event.event_id}`);

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
        console.log(`No league found for pinnacle_league_id ${pinnacleLeagueId}`);
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
  private async updateExistingOdds(eventId: number, period: PinnaclePeriod, marketClosed: boolean = false): Promise<boolean> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Transform Pinnacle odds to our format (decimals = 3, multiply by 1000)
    const transformOdds = (odds: number): number => {
      return Math.round(odds * 1000);
    };

    // Get existing odds
    const existingQuery = `
      SELECT fixture_id, odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t
      FROM football_odds
      WHERE bookie_id = $1 AND bookie = 'Pinnacle'
    `;
    const existingResult = await executeQuery(existingQuery, [eventId]);

    if (existingResult.rows.length === 0) {
      console.error(`No existing odds found for event ${eventId}`);
      return false;
    }

    const existing = existingResult.rows[0];
    const fixtureId = existing.fixture_id;

    // Prepare odds data
    let x12Odds = existing.odds_x12 ? existing.odds_x12 : [];
    let ahOdds = existing.odds_ah ? existing.odds_ah : [];
    let ouOdds = existing.odds_ou ? existing.odds_ou : [];
    let lines = existing.lines ? existing.lines : [];
    let ids = existing.ids ? existing.ids : [];
    let maxStakes = existing.max_stakes ? existing.max_stakes : [];
    const latestT = existing.latest_t ? existing.latest_t : {};

    if (marketClosed) {
      // Market is closed - append empty arrays to mark closure
      const emptyEntry = { t: timestamp };
      x12Odds = this.mergeOddsEntry(x12Odds, emptyEntry);
      ahOdds = this.mergeOddsEntry(ahOdds, emptyEntry);
      ouOdds = this.mergeOddsEntry(ouOdds, emptyEntry);
      lines = this.mergeOddsEntry(lines, emptyEntry);
      ids = this.mergeOddsEntry(ids, emptyEntry);
      maxStakes = this.mergeOddsEntry(maxStakes, emptyEntry);
      latestT.x12_ts = timestamp;
      latestT.ah_ts = timestamp;
      latestT.ou_ts = timestamp;
      latestT.lines_ts = timestamp;
      latestT.ids_ts = timestamp;
      latestT.stakes_ts = timestamp;

      // For market closure, always update the database
      const { query: updateQuery, params } = this.buildUpdateQuery(existing, {
        odds_x12: x12Odds,
        odds_ah: ahOdds,
        odds_ou: ouOdds,
        lines,
        ids,
        max_stakes: maxStakes,
        latest_t: latestT
      }, fixtureId);

      if (updateQuery) {
        await executeQuery(updateQuery, params);
        console.log(`Market closed for event ${eventId} - updated closure status`);
        return true;
      }
      return false;
    } else {
      // Market is open, update with new odds

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
        x12Odds = this.mergeOddsEntry(x12Odds, newX12Entry);
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

        ahOdds = this.mergeOddsEntry(ahOdds, newAhEntry);
        combinedLineEntry.ah = ahLineValues;
        combinedIdEntry.line_ids.ah = ahAltLineIds;
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

        ouOdds = this.mergeOddsEntry(ouOdds, newOuEntry);
        combinedLineEntry.ou = ouLineValues;
        combinedIdEntry.line_ids.ou = ouAltLineIds;
      }

      // Add combined line entry if we have any lines
      if (combinedLineEntry.ah || combinedLineEntry.ou) {
        lines = this.mergeOddsEntry(lines, combinedLineEntry);
      }

      // Add combined ID entry if we have any IDs
      if (Object.keys(combinedIdEntry.line_ids).length > 0) {
        ids = this.mergeOddsEntry(ids, combinedIdEntry);
      }

      // Update max stakes
      const newMaxStakeEntry = {
        t: timestamp,
        max_stake_x12: period.meta?.max_money_line ? [period.meta.max_money_line] : [],
        max_stake_ah: period.meta?.max_spread ? { h: [period.meta.max_spread], a: [period.meta.max_spread] } : {},
        max_stake_ou: period.meta?.max_total ? { o: [period.meta.max_total], u: [period.meta.max_total] } : {}
      };
      maxStakes = this.mergeOddsEntry(maxStakes, newMaxStakeEntry);

      // Update timestamps
      if (period.money_line) latestT.x12_ts = timestamp;
      if (period.spreads) latestT.ah_ts = timestamp;
      if (period.totals) latestT.ou_ts = timestamp;
      latestT.lines_ts = timestamp;
      latestT.ids_ts = timestamp;
      latestT.stakes_ts = timestamp;
    }

    // Check if anything actually changed
    const hasChanges = this.hasOddsChanged(existing, {
      odds_x12: x12Odds,
      odds_ah: ahOdds,
      odds_ou: ouOdds,
      lines,
      ids,
      max_stakes: maxStakes,
      latest_t: latestT,
      bookie_id: eventId.toString()
    });

    if (!hasChanges) {
      // No changes, skip update silently
      return false;
    }

    // Build dynamic UPDATE query for only changed fields
    const { query: updateQuery, params } = this.buildUpdateQuery(existing, {
      odds_x12: x12Odds,
      odds_ah: ahOdds,
      odds_ou: ouOdds,
      lines,
      ids,
      max_stakes: maxStakes,
      latest_t: latestT
    }, fixtureId);

    if (updateQuery) {
      await executeQuery(updateQuery, params);
      console.log(`Updated changed fields for event ${eventId}`);
      return true;
    }

    return false;

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

    console.log(`Created new odds entry for fixture ${fixtureId}, event ${eventId}`);
  }

  /**
   * Merges new odds entry with existing array, replacing same timestamp
   */
  private mergeOddsEntry(existing: any[], newEntry: any): any[] {
    const merged = [...existing];
    const existingIndex = merged.findIndex(entry => entry.t === newEntry.t);

    if (existingIndex >= 0) {
      merged[existingIndex] = newEntry;
    } else {
      merged.push(newEntry);
    }

    return merged;
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
      console.log('No market data received');
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
      console.log('Pinnacle odds fetching is not running');
      return;
    }

    this.isRunning = false;
    if (this.runInterval) {
      clearTimeout(this.runInterval);
      this.runInterval = null;
    }

    console.log('Stopped continuous Pinnacle odds fetching');
  }

  /**
   * Checks if odds data has actually changed
   */
  private hasOddsChanged(existing: any, newData: any): boolean {
    // Compare arrays as JSON strings for deep equality
    const fields = ['odds_x12', 'odds_ah', 'odds_ou', 'lines', 'ids', 'max_stakes', 'latest_t'];

    for (const field of fields) {
      const existingValue = existing[field];
      const newValue = newData[field];

      // Handle null/undefined cases
      if (!existingValue && !newValue) continue;
      if (!existingValue || !newValue) return true;

      // Compare as JSON strings for arrays/objects
      if (JSON.stringify(existingValue) !== JSON.stringify(newValue)) {
        return true;
      }
    }

    // Check bookie_id change (shouldn't happen but just in case)
    if (existing.bookie_id !== newData.bookie_id) {
      return true;
    }

    return false;
  }

  /**
   * Builds dynamic UPDATE query for only changed fields
   */
  private buildUpdateQuery(existing: any, newData: any, fixtureId: number): { query: string | null, params: any[] } {
    const setParts: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Always update updated_at
    setParts.push('updated_at = now()');

    // Check each field for changes
    const fields = [
      { key: 'odds_x12', json: true },
      { key: 'odds_ah', json: true },
      { key: 'odds_ou', json: true },
      { key: 'lines', json: true },
      { key: 'ids', json: true },
      { key: 'max_stakes', json: true },
      { key: 'latest_t', json: true }
    ];

    for (const field of fields) {
      const existingValue = existing[field.key];
      const newValue = newData[field.key];

      // Skip if no change
      if (JSON.stringify(existingValue) === JSON.stringify(newValue)) {
        continue;
      }

      // Add to SET clause
      const value = field.json && newValue && newValue.length > 0 ? JSON.stringify(newValue) : null;
      setParts.push(`${field.key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }

    // If nothing changed besides updated_at, return null
    if (setParts.length === 1) {
      return { query: null, params: [] };
    }

    // Build the query
    const query = `
      UPDATE football_odds
      SET ${setParts.join(', ')}
      WHERE fixture_id = $${paramIndex} AND bookie = 'Pinnacle'
    `;
    params.push(fixtureId);

    return { query, params };
  }

  /**
   * Gets the current running status
   */
  isContinuousFetchingRunning(): boolean {
    return this.isRunning;
  }
}

export const pinnacleOddsService = new PinnacleOddsService();
