import axios from 'axios';
import { executeQuery } from '../database/db-utils';
import { findMatchingFixture, FixtureMatchCriteria } from '../utils/fixture-matching';

interface MonacoMarket {
  id: string;
  eventId: string;
  marketTypeId: string;
  name: string;
  marketOutcomes: Array<{ id: string; title: string; ordering: number; }>;
  prices?: Array<{ side: string; outcomeId: string; price: number; liquidity: number; }>;
}

interface MarketMapping {
  eventId: string;
  marketId: string;
  marketTypeId: string;
  marketType: string;
  name: string;
  lineValue?: number;  // The handicap/total value (e.g., -0.25, 2.5)
  lineIndex?: number;  // Index in the lines array
  fixtureId?: number;
  outcomeMappings?: { [outcomeId: string]: number }; // Maps outcomeId to array position
}

interface PriceLevel {
  price: number;
  liquidity: number;
}

interface OrderBook {
  [outcomeId: string]: PriceLevel[];
}

export class MonacoOddsService {
  private baseUrl: string;
  private streamUrl: string;
  private appId: string;
  private apiKey: string;
  private websocket: any = null;
  private isRunning: boolean = false;
  private marketRefetchInterval: NodeJS.Timeout | null = null;
  private tokenRefreshTimeout: NodeJS.Timeout | null = null;
  private knownMonacoEventGroups: Set<string> = new Set();
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private accessExpiresAt: Date | null = null;
  private refreshExpiresAt: Date | null = null;
  private marketMapping: Map<string, MarketMapping> = new Map();
  private eventIdToMappings: Map<string, MarketMapping[]> = new Map();
  private subscribedMarketIds: Set<string> = new Set();
  private subscribedMarketKeys: Set<string> = new Set(); // eventId-marketId keys for O(1) filtering
  // In-memory order books: fixtureId-marketType -> OrderBook
  private orderBooks: Map<string, OrderBook> = new Map();
  // Sequential processing per fixture: fixtureId -> Promise chain
  private fixtureUpdateQueues: Map<number, Promise<void>> = new Map();
  // Asynchronous message processing queue to handle snapshots efficiently
  private messageQueue: any[] = [];
  private isProcessingMessages: boolean = false;
  private messageProcessingTimeout: NodeJS.Timeout | null = null;

  // Rate limiting
  private apiRequestTimestamps: number[] = []; // Timestamps for API calls (1 per second)
  private subscriptionRequestTimestamps: number[] = []; // Timestamps for subscription calls (2 per 60 seconds)

  constructor() {
    this.baseUrl = process.env.MONACO_BASE_URL!;
    this.streamUrl = process.env.MONACO_STREAM_URL!;
    this.appId = process.env.MONACO_APP_ID!;
    this.apiKey = process.env.MONACO_API_KEY!;
  }

  // Rate limiting methods
  private async checkApiRateLimit(): Promise<void> {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove timestamps older than 1 second
    this.apiRequestTimestamps = this.apiRequestTimestamps.filter(timestamp => timestamp > oneSecondAgo);

    // Check if we can make another request (max 1 per second)
    if (this.apiRequestTimestamps.length >= 1) {
      // Wait until the oldest request timestamp is more than 1 second old
      const oldestTimestamp = Math.min(...this.apiRequestTimestamps);
      const waitTime = 1000 - (now - oldestTimestamp);

      if (waitTime > 0) {
        console.log(`Rate limit: Waiting ${waitTime}ms before next API request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Add current timestamp
    this.apiRequestTimestamps.push(Date.now());
  }

  private async checkSubscriptionRateLimit(): Promise<void> {
    const now = Date.now();
    const sixtySecondsAgo = now - (60 * 1000);

    // Remove timestamps older than 60 seconds
    this.subscriptionRequestTimestamps = this.subscriptionRequestTimestamps.filter(timestamp => timestamp > sixtySecondsAgo);

    // Check if we can make another subscription (max 2 per 60 seconds)
    if (this.subscriptionRequestTimestamps.length >= 2) {
      // Wait until the oldest subscription timestamp is more than 60 seconds old
      const oldestTimestamp = Math.min(...this.subscriptionRequestTimestamps);
      const waitTime = (60 * 1000) - (now - oldestTimestamp);

      if (waitTime > 0) {
        console.log(`Rate limit: Waiting ${waitTime}ms before next subscription`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Add current timestamp
    this.subscriptionRequestTimestamps.push(Date.now());
  }

  async startContinuousFetching(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('Starting Monaco odds service');

    // Clear any existing market mappings and order books
    this.marketMapping.clear();
    this.eventIdToMappings.clear();
    this.subscribedMarketIds.clear();
    this.subscribedMarketKeys.clear();
    this.orderBooks.clear();
    this.fixtureUpdateQueues.clear();

    await this.loadKnownMonacoEventGroups();
    await this.fetchAndProcessMarkets();
    console.log(`Loaded ${this.marketMapping.size} market mappings`);
    await this.connectWebSocket();

    this.marketRefetchInterval = setInterval(async () => {
      try {
        // Clear market mappings and order books before refetch to rebuild them
        this.marketMapping.clear();
        this.eventIdToMappings.clear();
        this.subscribedMarketIds.clear();
        this.subscribedMarketKeys.clear();
        this.orderBooks.clear();
        await this.fetchAndProcessMarkets();
        console.log(`Refetched ${this.marketMapping.size} market mappings`);
      } catch (error) {
        console.error('Error refetching Monaco markets:', error);
      }
    }, 10 * 60 * 1000);

    console.log('Monaco odds service started');
  }

  async stopContinuousFetching(): Promise<void> {
    this.isRunning = false;

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    if (this.marketRefetchInterval) {
      clearInterval(this.marketRefetchInterval);
      this.marketRefetchInterval = null;
    }

    if (this.tokenRefreshTimeout) {
      clearTimeout(this.tokenRefreshTimeout);
      this.tokenRefreshTimeout = null;
    }

    if (this.messageProcessingTimeout) {
      clearTimeout(this.messageProcessingTimeout);
      this.messageProcessingTimeout = null;
    }

    // Clear message queue and stop processing
    this.messageQueue.length = 0;
    this.isProcessingMessages = false;

    // Wait for any pending updates to complete
    const pendingUpdates = Array.from(this.fixtureUpdateQueues.values());
    if (pendingUpdates.length > 0) {
      console.log(`Waiting for ${pendingUpdates.length} pending updates to complete...`);
      await Promise.all(pendingUpdates);
    }

    // Clear all state
    this.fixtureUpdateQueues.clear();
    this.accessExpiresAt = null;
    this.refreshExpiresAt = null;

    console.log('Monaco odds service stopped');
  }

  private async loadKnownMonacoEventGroups(): Promise<void> {
    const result = await executeQuery('SELECT id, name, "monaco_eventGroup" FROM football_leagues WHERE "monaco_eventGroup" IS NOT NULL');
    result.rows.forEach(row => {
      if (row.monaco_eventGroup) {
        row.monaco_eventGroup.split(',').forEach((group: string) => {
          this.knownMonacoEventGroups.add(group.trim());
        });
      }
    });
    console.log(`Loaded ${this.knownMonacoEventGroups.size} Monaco event groups`);
  }

  private async authenticate(): Promise<void> {
    try {
      await this.checkApiRateLimit();
      console.log('Authenticating with Monaco...');
      const response = await axios.post(`${this.baseUrl}/sessions`, {
        appId: this.appId,
        apiKey: this.apiKey
      });
      console.log('POST /sessions - Authentication successful');

      // API returns sessions array, get first session
      const session = response.data.sessions?.[0];

      this.accessToken = session.accessToken;
      this.refreshToken = session.refreshToken;
      this.accessExpiresAt = new Date(session.accessExpiresAt);
      this.refreshExpiresAt = new Date(session.refreshExpiresAt);

      // Schedule token refresh 2 minutes before expiry
      this.scheduleTokenRefresh();

      console.log('Monaco authentication successful');
    } catch (error: any) {
      console.error('Monaco: Authentication error:', error.response?.data || error.message);
      throw error;
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken) {
      await this.authenticate();
    } else if (this.accessExpiresAt && new Date() > this.accessExpiresAt) {
      // Access token expired, try to refresh
      await this.refreshTokenIfNeeded();
    }
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this.refreshToken || !this.refreshExpiresAt) {
      // No refresh token or it expired, re-authenticate
      await this.authenticate();
      return;
    }

    if (new Date() > this.refreshExpiresAt) {
      // Refresh token also expired, re-authenticate
      await this.authenticate();
      return;
    }

    // Try to refresh the access token
    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      await this.checkApiRateLimit();
      console.log('Refreshing Monaco access token...');
      const response = await axios.post(`${this.baseUrl}/sessions/refresh`, {
        refreshToken: this.refreshToken
      });

      const session = response.data.sessions?.[0];
      if (!session) {
        throw new Error('Token refresh failed: No session returned');
      }

      this.accessToken = session.accessToken;
      this.refreshToken = session.refreshToken;
      this.accessExpiresAt = new Date(session.accessExpiresAt);
      this.refreshExpiresAt = new Date(session.refreshExpiresAt);

      // Reschedule the next refresh
      this.scheduleTokenRefresh();

      console.log('Monaco access token refreshed successfully');
    } catch (error: any) {
      console.error('Monaco token refresh failed:', error.response?.data || error.message);
      // Fall back to full authentication
      await this.authenticate();
    }
  }

  private scheduleTokenRefresh(): void {
    // Clear any existing refresh timer
    if (this.tokenRefreshTimeout) {
      clearTimeout(this.tokenRefreshTimeout);
    }

    if (!this.accessExpiresAt) return;

    // Calculate refresh time: 2 minutes before expiry
    const refreshTime = new Date(this.accessExpiresAt.getTime() - (2 * 60 * 1000));
    const now = new Date();
    const delay = Math.max(0, refreshTime.getTime() - now.getTime());

    if (delay > 0) {
      console.log(`Scheduling token refresh in ${Math.round(delay / 1000 / 60)} minutes`);
      this.tokenRefreshTimeout = setTimeout(async () => {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          console.error('Scheduled token refresh failed:', error);
        }
      }, delay);
    } else {
      // Already expired, refresh immediately
      console.log('Access token already expired, refreshing now...');
      setImmediate(() => this.refreshAccessToken());
    }
  }

  private async fetchMarkets(page = 0): Promise<any> {
    await this.ensureAuthenticated();

    await this.checkApiRateLimit();
    const response = await axios.get(`${this.baseUrl}/markets`, {
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
      params: {
        marketTypeIds: 'FOOTBALL_OVER_UNDER_TOTAL_GOALS,FOOTBALL_FULL_TIME_RESULT_HANDICAP,FOOTBALL_FULL_TIME_RESULT',
        inPlayStatuses: 'PrePlay,NotApplicable',
        statuses: 'Initializing,Open,Locked,Closed',
        size: 2000,
        page
      }
    });
    console.log(`GET /markets - Fetched page ${page}`);

    return response.data;
  }

  private async fetchAllMarkets(): Promise<{ markets: MonacoMarket[]; events: any[]; eventGroups: any[] }> {
    const allMarkets: MonacoMarket[] = [];
    const allEvents: any[] = [];
    const allEventGroups: any[] = [];
    let page = 0;

    while (true) {
      const data = await this.fetchMarkets(page);
      allMarkets.push(...data.markets);
      allEvents.push(...(data.events || []));
      allEventGroups.push(...(data.eventGroups || []));

      if (data.markets.length < 2000) break;
      page++;
    }

    return { markets: allMarkets, events: allEvents, eventGroups: allEventGroups };
  }

  private async findMatchingFixtureByEvent(event: any, eventId: string): Promise<number | null> {
    try {
      const teams = event.name.split(' v ');
      if (teams.length !== 2) {
        return null;
      }

      const homeTeam = teams[0].trim();
      const awayTeam = teams[1].trim();
      const expectedStartTime = new Date(event.expectedStartTime);
      const eventGroupId = event.eventGroup._ids[0];

      // Find league by Monaco eventGroup
      const leagueResult = await executeQuery(`
        SELECT id FROM football_leagues
        WHERE "monaco_eventGroup" = $1 OR "monaco_eventGroup" LIKE $2 OR "monaco_eventGroup" LIKE $3 OR "monaco_eventGroup" LIKE $4
        LIMIT 1
      `, [eventGroupId, `${eventGroupId},%`, `%,${eventGroupId}`, `%,${eventGroupId},%`]);

      if (leagueResult.rows.length === 0) {
        console.error(`No league found for Monaco eventGroup: ${eventGroupId}`);
        return null;
      }

      const leagueId = leagueResult.rows[0].id;

      // Use the global findMatchingFixture function
      return await findMatchingFixture({
        startTime: expectedStartTime,
        homeTeam,
        awayTeam,
        leagueId
      });
    } catch (error) {
      console.error(`Error finding fixture for ${event.name}:`, error);
      return null;
    }
  }

  private transformPrice(price: number): number {
    return Math.floor(((price - 1) * 0.99 + 1) * 1000);
  }

  private getHandicapValue(market: MonacoMarket): number {
    const match = market.name.match(/Goal Handicap ([\+\-\d\.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  private getTotalValue(market: MonacoMarket): number {
    const match = market.name.match(/Total Goals Over\/Under ([\d\.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  private parseJsonArray(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private async processMarkets(markets: MonacoMarket[], events: any[]): Promise<void> {
    const eventMap = new Map(events.map(e => [e.id, e]));

    // Group markets by event (fixture)
    const marketsByEvent = new Map<string, MonacoMarket[]>();
    let validMarkets = 0;

    for (const market of markets) {
      const event = eventMap.get(market.eventId);
      if (!event) {
        console.log(`No event found for market ${market.id}, eventId: ${market.eventId}`);
        continue;
      }

      // Only process recognized market types
      const marketType = this.mapMarketType(market.marketTypeId);
      if (!marketType) continue;

      validMarkets++;

      // Store market mapping for real-time updates
      const lineValue = marketType === 'ah' ? this.getHandicapValue(market) :
                      marketType === 'ou' ? this.getTotalValue(market) : undefined;

      // Create outcome mappings for incremental updates
      const outcomeMappings: { [outcomeId: string]: number } = {};
      if (market.marketOutcomes) {
        market.marketOutcomes
          .sort((a, b) => a.ordering - b.ordering)
          .forEach((outcome, index) => {
            outcomeMappings[outcome.id] = index;
          });
      }

      const mapping: MarketMapping = {
        eventId: market.eventId,
        marketId: market.id,
        marketTypeId: market.marketTypeId,
        marketType: marketType,
        name: market.name,
        lineValue: lineValue,
        outcomeMappings: outcomeMappings
      };

      const mappingKey = `${market.eventId}-${market.id}`;
      this.marketMapping.set(mappingKey, mapping);

      // Maintain secondary index by eventId
      const eventMappings = this.eventIdToMappings.get(market.eventId) || [];
      eventMappings.push(mapping);
      this.eventIdToMappings.set(market.eventId, eventMappings);

      // Group markets by event
      const eventMarkets = marketsByEvent.get(market.eventId) || [];
      eventMarkets.push(market);
      marketsByEvent.set(market.eventId, eventMarkets);
    }


    // Process each event (fixture) and all its markets together
    const fixturePromises: Promise<void>[] = [];
    let fixturesFound = 0;
    let fixturesProcessed = 0;

    marketsByEvent.forEach((eventMarkets, eventId) => {
      const event = eventMap.get(eventId)!;

      fixturePromises.push(
        this.findMatchingFixtureByEvent(event, eventId).then(async (fixtureId) => {
          if (!fixtureId) {
            console.log(`No fixture found for event ${event.name} (ID: ${eventId})`);
            return;
          }
          fixturesFound++;

          await this.processFixtureMarkets(fixtureId, eventMarkets);
          fixturesProcessed++;
        })
      );
    });

    await Promise.all(fixturePromises);
  }

  private async processFixtureMarkets(fixtureId: number, markets: MonacoMarket[]): Promise<void> {

    // Group markets by type and calculate line indices
    const marketsByType: { [key: string]: MonacoMarket[] } = {};
    for (const market of markets) {
      const marketType = this.mapMarketType(market.marketTypeId);
      if (!marketType) continue;

      if (!marketsByType[marketType]) {
        marketsByType[marketType] = [];
      }
      marketsByType[marketType].push(market);
    }

    // Calculate line indices for each market
    for (const [marketType, typeMarkets] of Object.entries(marketsByType)) {
      // Sort markets by their line values to determine indices
      const sortedMarkets = typeMarkets.sort((a, b) => {
        const aValue = marketType === 'ah' ? this.getHandicapValue(a) : this.getTotalValue(a);
        const bValue = marketType === 'ah' ? this.getHandicapValue(b) : this.getTotalValue(b);
        return aValue - bValue;
      });

      // Assign line indices
      sortedMarkets.forEach((market, index) => {
        const mappingKey = `${market.eventId}-${market.id}`;
        const existingMapping = this.marketMapping.get(mappingKey);
        if (existingMapping) {
          existingMapping.lineIndex = index;
          this.marketMapping.set(mappingKey, existingMapping);
        }
      });
    }

    // Update market mappings with fixture ID and collect market IDs for subscription
    for (const market of markets) {
      const mappingKey = `${market.eventId}-${market.id}`;
      const existingMapping = this.marketMapping.get(mappingKey);
      if (existingMapping) {
        existingMapping.fixtureId = fixtureId;
        this.marketMapping.set(mappingKey, existingMapping);
        // Add to subscription sets
        this.subscribedMarketIds.add(market.id);
        this.subscribedMarketKeys.add(mappingKey);
      }
    }

    await this.ensureFixtureOddsRecord(fixtureId, markets);

    // Initialize order books with current market data
    this.initializeOrderBooks(fixtureId, markets);
  }

  private initializeOrderBooks(fixtureId: number, markets: MonacoMarket[]): void {
    for (const market of markets) {
      const marketType = this.mapMarketType(market.marketTypeId);
      if (!marketType || !market.prices) continue;

      const orderBookKey = `${fixtureId}-${marketType}`;
      if (!this.orderBooks.has(orderBookKey)) {
        this.orderBooks.set(orderBookKey, {});
      }

      const orderBook = this.orderBooks.get(orderBookKey)!;

      // Group prices by outcomeId and sort by liquidity (highest first)
      const pricesByOutcome: { [outcomeId: string]: PriceLevel[] } = {};

      market.prices
        .filter(p => p.side === 'Against') // Only process "against" side for betting prices
        .forEach(price => {
          if (!pricesByOutcome[price.outcomeId]) {
            pricesByOutcome[price.outcomeId] = [];
          }
          pricesByOutcome[price.outcomeId].push({
            price: price.price,
            liquidity: price.liquidity
          });
        });

      // Sort price levels by liquidity (highest first) and store in order book
      Object.keys(pricesByOutcome).forEach(outcomeId => {
        orderBook[outcomeId] = pricesByOutcome[outcomeId].sort((a, b) => b.liquidity - a.liquidity);
      });

    }
  }

  private buildFixtureStructure(markets: MonacoMarket[]) {
    const timestamp = Math.floor(Date.now() / 1000);
    const linesEntry: any = { t: timestamp };
    const idsEntry: any = { t: timestamp, line_id: '', line_ids: {} as Record<string, string[]> };
    const maxStakesEntry: any = { t: timestamp };
    const lineIndexMap = new Map<string, number>();

    const x12Markets: MonacoMarket[] = [];
    const ahLines: Array<{ value: number; market: MonacoMarket }> = [];
    const ouLines: Array<{ value: number; market: MonacoMarket }> = [];

    markets.forEach(market => {
      const marketType = this.mapMarketType(market.marketTypeId);
      if (!marketType) return;

      if (!idsEntry.line_ids[marketType]) {
        idsEntry.line_ids[marketType] = [];
      }
      idsEntry.line_ids[marketType].push(market.id);

      if (marketType === 'x12') {
        x12Markets.push(market);
        return;
      }

      const value = marketType === 'ah' ? this.getHandicapValue(market) : this.getTotalValue(market);
      if (value === null || isNaN(value)) return;

      if (marketType === 'ah') {
        ahLines.push({ value, market });
      } else if (marketType === 'ou') {
        ouLines.push({ value, market });
      }
    });

    const sortedAh = ahLines.sort((a, b) => a.value - b.value);
    const sortedOu = ouLines.sort((a, b) => a.value - b.value);

    if (sortedAh.length > 0) {
      linesEntry.ah = sortedAh.map(item => item.value);
      maxStakesEntry.max_stake_ah = {
        h: new Array(sortedAh.length).fill(0),
        a: new Array(sortedAh.length).fill(0)
      };

      // Calculate max_stakes from actual liquidity data
      sortedAh.forEach((item, lineIndex) => {
        const market = markets.find(m => m.id === item.market.id);
        if (market?.prices) {
          market.prices.forEach(price => {
            if (price.side === 'Against') {
              const outcomeIndex = market.marketOutcomes.findIndex(o => o.id === price.outcomeId);
              if (outcomeIndex >= 0) {
                const isHome = outcomeIndex % 2 === 0;
                if (isHome) {
                  maxStakesEntry.max_stake_ah.h[lineIndex] += price.liquidity;
                } else {
                  maxStakesEntry.max_stake_ah.a[lineIndex] += price.liquidity;
                }
              }
            }
          });
        }
        lineIndexMap.set(item.market.id, lineIndex);
      });
    }

    if (sortedOu.length > 0) {
      linesEntry.ou = sortedOu.map(item => item.value);
      maxStakesEntry.max_stake_ou = {
        o: new Array(sortedOu.length).fill(0),
        u: new Array(sortedOu.length).fill(0)
      };

      // Calculate max_stakes from actual liquidity data
      sortedOu.forEach((item, lineIndex) => {
        const market = markets.find(m => m.id === item.market.id);
        if (market?.prices) {
          market.prices.forEach(price => {
            if (price.side === 'Against') {
              const outcomeIndex = market.marketOutcomes.findIndex(o => o.id === price.outcomeId);
              if (outcomeIndex >= 0) {
                const isOver = outcomeIndex % 2 === 0;
                if (isOver) {
                  maxStakesEntry.max_stake_ou.o[lineIndex] += price.liquidity;
                } else {
                  maxStakesEntry.max_stake_ou.u[lineIndex] += price.liquidity;
                }
              }
            }
          });
        }
        lineIndexMap.set(item.market.id, lineIndex);
      });
    }

    if (x12Markets.length > 0) {
      maxStakesEntry.max_stake_x12 = [0];
      idsEntry.line_id = x12Markets[0].id;

      // Calculate max_stakes from actual liquidity data
      x12Markets.forEach(market => {
        if (market.prices) {
          market.prices.forEach(price => {
            if (price.side === 'Against') {
              maxStakesEntry.max_stake_x12[0] += price.liquidity;
            }
          });
        }
      });
    } else if (markets.length > 0) {
      idsEntry.line_id = markets[0].id;
    }

    const zeroOdds = {
      x12: x12Markets.length > 0 ? JSON.stringify([{
        t: timestamp,
        x12: [0, 0, 0]
      }]) : JSON.stringify([]),
      ah: sortedAh.length > 0 ? JSON.stringify([{
        t: timestamp,
        ah_h: new Array(sortedAh.length).fill(0),
        ah_a: new Array(sortedAh.length).fill(0)
      }]) : JSON.stringify([]),
      ou: sortedOu.length > 0 ? JSON.stringify([{
        t: timestamp,
        ou_o: new Array(sortedOu.length).fill(0),
        ou_u: new Array(sortedOu.length).fill(0)
      }]) : JSON.stringify([])
    };

    return {
      timestamp,
      linesEntry,
      idsEntry,
      zeroOdds,
      maxStakesEntry,
      lineIndexMap
    };
  }

  private async ensureFixtureOddsRecord(fixtureId: number, markets: MonacoMarket[]): Promise<void> {
    if (markets.length === 0) return;

    // Get fixture name for logging
    const fixtureResult = await executeQuery(
      'SELECT home_team_name, away_team_name FROM football_fixtures WHERE id = $1',
      [fixtureId]
    );
    const fixtureInfo = fixtureResult.rows.length > 0 ?
      `${fixtureResult.rows[0].home_team_name} vs ${fixtureResult.rows[0].away_team_name}` :
      `fixture ${fixtureId}`;

    const structure = this.buildFixtureStructure(markets);
    const linesJson = JSON.stringify([structure.linesEntry]);
    const idsJson = JSON.stringify([structure.idsEntry]);
    const maxStakesJson = JSON.stringify([structure.maxStakesEntry]);
    const latestT = JSON.stringify({
      x12_ts: structure.timestamp,
      ah_ts: structure.timestamp,
      ou_ts: structure.timestamp,
      lines_ts: structure.timestamp,
      ids_ts: structure.timestamp,
      stakes_ts: structure.timestamp
    });

    const existing = await executeQuery(
      'SELECT fixture_id FROM football_odds WHERE fixture_id = $1 AND bookie = $2',
      [fixtureId, 'Monaco']
    );

    if (existing.rows.length === 0) {
      console.log(`💾 Creating odds record for ${fixtureInfo}`);
      await executeQuery(`
        INSERT INTO football_odds (
          fixture_id, bookie_id, bookie, decimals,
          odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        fixtureId,
        markets[0].eventId,
        'Monaco',
        3,
        structure.zeroOdds.x12,
        structure.zeroOdds.ah,
        structure.zeroOdds.ou,
        linesJson,
        idsJson,
        maxStakesJson,
        latestT
      ]);
      console.log(`INSERT football_odds - ${fixtureInfo}`);
    } else {
      // For existing records, only update lines and ids, not max_stakes (that's updated during real-time)
      await executeQuery(`
        UPDATE football_odds
        SET
          lines = $1,
          ids = $2,
          latest_t = $3
        WHERE fixture_id = $4 AND bookie = 'Monaco'
      `, [
        linesJson,
        idsJson,
        latestT,
        fixtureId
      ]);
      console.log(`UPDATE football_odds - ${fixtureInfo} (lines, ids)`);
    }

    // Update mapping indexes (in case there were new lines)
    const eventId = markets[0].eventId;
    structure.lineIndexMap.forEach((index, marketId) => {
      const mapping = this.marketMapping.get(`${eventId}-${marketId}`);
      if (mapping) {
        mapping.lineIndex = index;
        this.marketMapping.set(`${eventId}-${marketId}`, mapping);
      }
    });
  }

  private mapMarketType(marketTypeId: string): string | null {
    switch (marketTypeId) {
      case 'FOOTBALL_FULL_TIME_RESULT': return 'x12';
      case 'FOOTBALL_FULL_TIME_RESULT_HANDICAP': return 'ah';
      case 'FOOTBALL_OVER_UNDER_TOTAL_GOALS': return 'ou';
      default: return null;
    }
  }

  private async fetchAndProcessMarkets(): Promise<void> {
    try {
      const { markets, events, eventGroups } = await this.fetchAllMarkets();
      console.log(`Fetched ${markets.length} markets, ${events.length} events, ${eventGroups.length} event groups`);


      const processedMarkets: MonacoMarket[] = markets.map(market => ({
        id: market.id,
        eventId: (market as any).event?._ids?.[0] || (market as any).eventId,
        marketTypeId: (market as any).marketType?._ids?.[0] || (market as any).marketTypeId,
        name: market.name,
        marketOutcomes: Array.isArray((market as any).marketOutcomes) ? (market as any).marketOutcomes :
                       (market as any).marketOutcomes?._ids?.map((id: string, index: number) => ({ id, title: `Outcome ${index}`, ordering: index })) || [],
        prices: market.prices
      }));

      await this.processMarkets(processedMarkets, events);
    } catch (error) {
      console.error('Error fetching markets:', error);
    }
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Dynamically import WebSocket only on server side
      const { default: WebSocket } = await import('ws');
      this.websocket = new WebSocket(this.streamUrl);

      this.websocket.on('open', async () => {
        await this.ensureAuthenticated();
        this.websocket!.send(JSON.stringify({
          action: 'authenticate',
          accessToken: this.accessToken
        }));
        console.log('WebSocket AUTHENTICATE - Sent access token');
      });

      this.websocket.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'AuthenticationUpdate') {
            console.log('WebSocket AUTHENTICATION - Confirmed');
            await this.checkSubscriptionRateLimit();
            this.websocket!.send(JSON.stringify({
              action: 'subscribe',
              subscriptionType: 'MarketPriceUpdate',
              subscriptionIds: ['*']
            }));
            console.log('WebSocket SUBSCRIBE - All market IDs (*)');

            this.websocket!.send(JSON.stringify({
              action: 'subscribe',
              subscriptionType: 'MarketStatusUpdateMessage',
              subscriptionIds: ['*']
            }));
            console.log('WebSocket SUBSCRIBE - Market status updates (*)');
            resolve();
          } else if (message.type === 'MarketPriceUpdate') {
            this.queueMessage({ type: 'price', data: message });
          } else if (message.type === 'MarketStatusUpdateMessage') {
            this.queueMessage({ type: 'status', data: message });
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      this.websocket.on('error', reject);
      this.websocket.on('close', () => {
        this.websocket = null;
      });
    });
  }

  private async handlePriceUpdate(message: any): Promise<void> {
    // 🚀 LIGHTNING FAST PRE-FILTERING (sub-millisecond)
    // Skip irrelevant messages before any processing
    if (!message.marketId || !message.eventId || !message.prices || message.prices.length === 0) {
      return; // Silently ignore invalid messages
    }

    // Check if this market is in our subscribed set (O(1))
    if (!this.subscribedMarketKeys.has(`${message.eventId}-${message.marketId}`)) {
      return; // Silently ignore unsubscribed markets
    }

    try {
      // Find market mapping for this price update
      const mappingKey = `${message.eventId}-${message.marketId}`;
      const marketMapping = this.marketMapping.get(mappingKey)!;

      if (!marketMapping.fixtureId) {
        return;
      }

      const fixtureId = marketMapping.fixtureId;

      // Queue this update to be processed sequentially for this fixture
      const previousUpdate = this.fixtureUpdateQueues.get(fixtureId) || Promise.resolve();

      const currentUpdate = previousUpdate.then(async () => {
        try {
          await this.updateFixtureOddsRealtime(fixtureId, message, marketMapping.marketType);
        } catch (error) {
          console.error(`Error processing update for fixture ${fixtureId}:`, error);
        }
      });

      this.fixtureUpdateQueues.set(fixtureId, currentUpdate);

      // Don't await here - let it process in background
      // This ensures WebSocket handler returns quickly
    } catch (error) {
      console.error('Error handling price update:', error);
    }
  }

  private async handleStatusUpdate(message: any): Promise<void> {
    // 🚀 LIGHTNING FAST PRE-FILTERING (sub-millisecond)
    // Skip irrelevant messages before any processing
    if (!message.marketId || !message.eventId) {
      return; // Silently ignore invalid messages
    }

    // Check if this market is in our subscribed set (O(1))
    if (!this.subscribedMarketKeys.has(`${message.eventId}-${message.marketId}`)) {
      return; // Silently ignore unsubscribed markets
    }

    // Check if status is not "Open" or inPlayStatus is not "PrePlay"
    const shouldZeroOdds = message.status !== 'Open' || message.inPlayStatus !== 'PrePlay';

    if (!shouldZeroOdds) {
      return; // Market is still active, no action needed
    }

    try {
      // Find market mapping for this status update
      const mappingKey = `${message.eventId}-${message.marketId}`;
      const marketMapping = this.marketMapping.get(mappingKey)!;

      if (!marketMapping.fixtureId) {
        return;
      }

      const fixtureId = marketMapping.fixtureId;

      console.log(`Market ${message.marketId} status changed to ${message.status}/${message.inPlayStatus}, zeroing odds for fixture ${fixtureId}`);

      // Queue this update to be processed sequentially for this fixture
      const previousUpdate = this.fixtureUpdateQueues.get(fixtureId) || Promise.resolve();

      const currentUpdate = previousUpdate.then(async () => {
        try {
          await this.zeroOutMarketOdds(fixtureId, message, marketMapping.marketType);
        } catch (error) {
          console.error(`Error zeroing odds for fixture ${fixtureId}:`, error);
        }
      });

      this.fixtureUpdateQueues.set(fixtureId, currentUpdate);

      // Don't await here - let it process in background
      // This ensures WebSocket handler returns quickly
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  }

  // Queue message for asynchronous processing to prevent blocking WebSocket handler
  private queueMessage(message: { type: string; data: any }): void {
    this.messageQueue.push(message);
    this.scheduleMessageProcessing();
  }

  // Schedule asynchronous message processing with debouncing
  private scheduleMessageProcessing(): void {
    if (this.messageProcessingTimeout) {
      return; // Already scheduled
    }

    this.messageProcessingTimeout = setTimeout(() => {
      this.messageProcessingTimeout = null;
      this.processQueuedMessages();
    }, 10); // Process in batches every 10ms
  }

  // Process queued messages asynchronously with controlled concurrency
  private async processQueuedMessages(): Promise<void> {
    if (this.isProcessingMessages || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingMessages = true;

    try {
      // Process messages in batches of up to 50 at a time
      const batchSize = 50;
      const messagesToProcess = this.messageQueue.splice(0, batchSize);

      // Group messages by type for more efficient processing
      const priceMessages: any[] = [];
      const statusMessages: any[] = [];

      for (const message of messagesToProcess) {
        if (message.type === 'price') {
          priceMessages.push(message.data);
        } else if (message.type === 'status') {
          statusMessages.push(message.data);
        }
      }

      // Process price updates in parallel (but still sequentially per fixture)
      const pricePromises = priceMessages.map(msg => this.handlePriceUpdateAsync(msg));
      await Promise.allSettled(pricePromises);

      // Process status updates (these are less frequent)
      const statusPromises = statusMessages.map(msg => this.handleStatusUpdateAsync(msg));
      await Promise.allSettled(statusPromises);

    } catch (error) {
      console.error('Error processing message batch:', error);
    } finally {
      this.isProcessingMessages = false;

      // If more messages arrived during processing, schedule another batch
      if (this.messageQueue.length > 0) {
        this.scheduleMessageProcessing();
      }
    }
  }

  // Async wrapper for price update handling
  private async handlePriceUpdateAsync(message: any): Promise<void> {
    try {
      await this.handlePriceUpdate(message);
    } catch (error) {
      console.error('Error in async price update:', error);
    }
  }

  // Async wrapper for status update handling
  private async handleStatusUpdateAsync(message: any): Promise<void> {
    try {
      await this.handleStatusUpdate(message);
    } catch (error) {
      console.error('Error in async status update:', error);
    }
  }

  private async getFixtureInfo(fixtureId: number): Promise<string> {
    const fixtureResult = await executeQuery(
      'SELECT home_team_name, away_team_name FROM football_fixtures WHERE id = $1',
      [fixtureId]
    );
    return fixtureResult.rows.length > 0 ?
      `${fixtureResult.rows[0].home_team_name} vs ${fixtureResult.rows[0].away_team_name}` :
      `fixture ${fixtureId}`;
  }

  private async zeroOutMarketOdds(fixtureId: number, message: any, marketType: string): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Get fixture info for logging
    const fixtureInfo = await this.getFixtureInfo(fixtureId);

    // Determine the field name based on market type
    let fieldName: string;
    let zeroEntry: any;

    switch (marketType) {
      case 'x12':
        fieldName = 'odds_x12';
        zeroEntry = { t: timestamp, x12: [0, 0, 0] };
        break;
      case 'ah':
        fieldName = 'odds_ah';
        zeroEntry = { t: timestamp, ah_h: [0, 0, 0], ah_a: [0, 0, 0] };
        break;
      case 'ou':
        fieldName = 'odds_ou';
        zeroEntry = { t: timestamp, ou_o: [0, 0, 0], ou_u: [0, 0, 0] };
        break;
      default:
        console.warn(`Unknown market type ${marketType}, skipping zero out`);
        return;
    }

    // Get existing data
    const existingResult = await executeQuery(
      `SELECT o.${fieldName}, o.lines, o.ids, o.max_stakes, o.latest_t,
              f.home_team, f.away_team, l.name as league_name
       FROM football_odds o
       JOIN football_fixtures f ON f.id = o.fixture_id
       LEFT JOIN football_leagues l ON l.id = f.league_id
       WHERE o.fixture_id = $1 AND o.bookie = $2`,
      [fixtureId, 'Monaco']
    );

    if (existingResult.rows.length === 0) {
      console.warn(`No existing odds found for fixture ${fixtureId}, skipping zero out`);
      return;
    }

    let oddsArray = this.parseJsonArray(existingResult.rows[0][fieldName]);
    let maxStakesData = this.parseJsonArray(existingResult.rows[0].max_stakes);
    let linesData = this.parseJsonArray(existingResult.rows[0].lines);
    let idsData = this.parseJsonArray(existingResult.rows[0].ids);
    let latestT = existingResult.rows[0].latest_t || {};

    // Create zero max_stakes entry
    let zeroMaxStakesEntry: any = { t: timestamp };
    if (marketType === 'x12') {
      zeroMaxStakesEntry.max_stake_x12 = [0, 0, 0];
    } else if (marketType === 'ah') {
      zeroMaxStakesEntry.max_stake_ah = { h: [0, 0, 0], a: [0, 0, 0] };
    } else if (marketType === 'ou') {
      zeroMaxStakesEntry.max_stake_ou = { o: [0, 0, 0], u: [0, 0, 0] };
    }

    // Merge zero odds entry
    oddsArray = this.mergeOddsEntry(oddsArray, zeroEntry);

    // Merge zero max_stakes entry
    maxStakesData = this.mergeOddsEntry(maxStakesData, zeroMaxStakesEntry);

    // Update latest_t for this market type
    const tsKey = marketType === 'x12' ? 'x12_ts' : marketType === 'ah' ? 'ah_ts' : 'ou_ts';
    latestT[tsKey] = timestamp;
    latestT.stakes_ts = timestamp; // Always update when max_stakes is updated

    // Convert to JSON
    const jsonData = JSON.stringify(oddsArray);
    const maxStakesJson = JSON.stringify(maxStakesData);
    const linesJson = linesData.length > 0 ? JSON.stringify(linesData) : null;
    const idsJson = idsData.length > 0 ? JSON.stringify(idsData) : null;
    const latestTJson = JSON.stringify(latestT);

    // Update database
    await executeQuery(
      `UPDATE football_odds SET ${fieldName} = $1, max_stakes = $2, latest_t = $3, updated_at = now() WHERE fixture_id = $4 AND bookie = $5`,
      [jsonData, maxStakesJson, latestTJson, fixtureId, 'Monaco']
    );

    console.log(`ZEROED odds - ${fixtureInfo} (${marketType}) - market ${message.marketId} status: ${message.status}/${message.inPlayStatus}`);
  }

  private async updateFixtureOddsRealtime(fixtureId: number, message: any, marketType: string): Promise<void> {

    // Get the market mapping for outcome mappings
    const mappingKey = `${message.eventId}-${message.marketId}`;
    const marketMapping = this.marketMapping.get(mappingKey);

    const orderBookKey = `${fixtureId}-${marketType}`;

    // Initialize order book if it doesn't exist (for markets that become available after initial fetch)
    if (!this.orderBooks.has(orderBookKey)) {

      // Initialize with empty price levels for each outcome based on market mapping
      const initialOrderBook: OrderBook = {};
      if (marketMapping?.outcomeMappings) {
        // Use outcome mappings if available
        Object.keys(marketMapping.outcomeMappings).forEach(outcomeId => {
          initialOrderBook[outcomeId] = [];
        });
      } else {
        // Fallback: initialize with outcomes from the current message
        message.prices?.forEach((price: any) => {
          if (!initialOrderBook[price.outcomeId]) {
            initialOrderBook[price.outcomeId] = [];
          }
        });
      }

      this.orderBooks.set(orderBookKey, initialOrderBook);
    }

    const orderBook = this.orderBooks.get(orderBookKey)!;


    // Process each price change in the incremental update (only "against" side for betting prices)
    message.prices
      .filter((priceUpdate: any) => priceUpdate.side === 'Against')
      .forEach((priceUpdate: any) => {
      const { outcomeId, price, liquidity, change } = priceUpdate;

      if (!orderBook[outcomeId]) {
        orderBook[outcomeId] = [];
      }

      const priceLevels = orderBook[outcomeId];

      // Find existing price level or create new one
      let existingLevelIndex = priceLevels.findIndex(level => level.price === price);

      if (existingLevelIndex >= 0) {
        // Update existing price level
        if (liquidity === 0) {
          // Remove price level if absolute liquidity becomes 0
          priceLevels.splice(existingLevelIndex, 1);
        } else {
          // Update liquidity to the absolute value
          priceLevels[existingLevelIndex].liquidity = liquidity;
        }
      } else if (liquidity > 0) {
        // Add new price level
        priceLevels.push({ price, liquidity });
      }

      // Keep price levels sorted by price descending (highest odds first for customer)
      priceLevels.sort((a, b) => b.price - a.price);
    });

    // Now determine the best prices to store in database
    await this.updateDatabaseWithBestPrices(fixtureId, message, marketType, orderBook, marketMapping);

  }

  private async updateDatabaseWithBestPrices(fixtureId: number, message: any, marketType: string, orderBook: OrderBook, marketMapping?: MarketMapping): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Get existing odds from database (like Pinnacle does)
    const fieldName = marketType === 'x12' ? 'odds_x12' :
                     marketType === 'ah' ? 'odds_ah' : 'odds_ou';

    const existingResult = await executeQuery(
      `SELECT o.${fieldName}, o.lines, o.ids, o.max_stakes, o.latest_t,
              f.home_team_name, f.away_team_name
       FROM football_odds o
       JOIN football_fixtures f ON o.fixture_id = f.id
       WHERE o.fixture_id = $1 AND o.bookie = $2`,
      [fixtureId, 'Monaco']
    );

    // Start with existing arrays, or empty arrays if none exist (like Pinnacle)
    let oddsArray = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0][fieldName]) : [];
    let linesData = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0].lines) : [];
    let idsData = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0].ids) : [];
    let maxStakesData = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0].max_stakes) : [];
    const currentLatestT = existingResult.rows.length > 0 && existingResult.rows[0].latest_t ? existingResult.rows[0].latest_t : {};

    // Get fixture info for logging
    const fixtureInfo = existingResult.rows.length > 0 ?
      `${existingResult.rows[0].home_team_name} vs ${existingResult.rows[0].away_team_name}` :
      `fixture ${fixtureId}`;

    // Generate new odds entry and max_stakes from current order book
    const newOddsEntry: any = { t: timestamp };
    const maxStakesEntry: any = { t: timestamp };

      if (marketType === 'x12') {
        // Generate x12 prices from UPDATED order book (after processing the message)
        const x12Prices = [0, 0, 0];
        Object.keys(orderBook).forEach(outcomeId => {
          const outcomeIndex = marketMapping?.outcomeMappings?.[outcomeId];
          if (outcomeIndex !== undefined && outcomeIndex >= 0 && outcomeIndex < 3) {
            // Use the best available price from the UPDATED order book
            const bestLevel = orderBook[outcomeId]?.[0];
            if (bestLevel) {
              x12Prices[outcomeIndex] = this.transformPrice(bestLevel.price);
            }
          }
        });
        newOddsEntry.x12 = x12Prices;
    } else {
      // For AH/OU, get the lines structure
      const latestLinesEntry = linesData.length > 0 ? linesData[linesData.length - 1] : null;

      if (marketType === 'ah' && latestLinesEntry?.ah) {
        newOddsEntry.ah_h = new Array(latestLinesEntry.ah.length).fill(0);
        newOddsEntry.ah_a = new Array(latestLinesEntry.ah.length).fill(0);

        // Fill from order book using handicap value to find correct line index
        Object.keys(orderBook).forEach(outcomeId => {
          // Find which market this outcome belongs to by checking all mappings
          let outcomeLineValue: number | undefined;
          let outcomeIndex: number | undefined;

          for (const [mappingKey, mapping] of Array.from(this.marketMapping.entries())) {
            if (mapping.outcomeMappings?.[outcomeId] !== undefined && mapping.marketType === 'ah') {
              outcomeLineValue = mapping.lineValue;
              outcomeIndex = mapping.outcomeMappings[outcomeId];
              break;
            }
          }

          if (outcomeLineValue !== undefined && outcomeIndex !== undefined) {
            const lineIndex = latestLinesEntry.ah.findIndex((line: number) => line === outcomeLineValue);
            const isHome = outcomeIndex % 2 === 0;

            if (lineIndex >= 0 && lineIndex < latestLinesEntry.ah.length) {
              // Use the best available price from the UPDATED order book
              const bestLevel = orderBook[outcomeId]?.[0];
              if (bestLevel) {
                const transformedPrice = this.transformPrice(bestLevel.price);
                if (isHome) {
                  newOddsEntry.ah_h[lineIndex] = transformedPrice;
                } else {
                  newOddsEntry.ah_a[lineIndex] = transformedPrice;
                }
              }
            }
          }
        });
      } else if (marketType === 'ou' && latestLinesEntry?.ou) {
        newOddsEntry.ou_o = new Array(latestLinesEntry.ou.length).fill(0);
        newOddsEntry.ou_u = new Array(latestLinesEntry.ou.length).fill(0);

        // Fill from order book using total value to find correct line index
        Object.keys(orderBook).forEach(outcomeId => {
          // Find which market this outcome belongs to by checking all mappings
          let outcomeLineValue: number | undefined;
          let outcomeIndex: number | undefined;

          for (const [mappingKey, mapping] of Array.from(this.marketMapping.entries())) {
            if (mapping.outcomeMappings?.[outcomeId] !== undefined && mapping.marketType === 'ou') {
              outcomeLineValue = mapping.lineValue;
              outcomeIndex = mapping.outcomeMappings[outcomeId];
              break;
            }
          }

          if (outcomeLineValue !== undefined && outcomeIndex !== undefined) {
            const lineIndex = latestLinesEntry.ou.findIndex((line: number) => line === outcomeLineValue);
            const isOver = outcomeIndex % 2 === 0;

            if (lineIndex >= 0 && lineIndex < latestLinesEntry.ou.length) {
              // Use the best available price from the UPDATED order book
              const bestLevel = orderBook[outcomeId]?.[0];
              if (bestLevel) {
                const transformedPrice = this.transformPrice(bestLevel.price);
                if (isOver) {
                  newOddsEntry.ou_o[lineIndex] = transformedPrice;
                } else {
                  newOddsEntry.ou_u[lineIndex] = transformedPrice;
                }
              }
            }
          }
        });
      }
    }

    // Merge with existing entries (like Pinnacle)
    oddsArray = this.mergeOddsEntry(oddsArray, newOddsEntry);

    // Populate max_stakes with total liquidity from order book (like prices)
    if (marketType === 'x12') {
      maxStakesEntry.max_stake_x12 = [0];
      Object.keys(orderBook).forEach(outcomeId => {
        const outcomeIndex = marketMapping?.outcomeMappings?.[outcomeId];
        if (outcomeIndex !== undefined && outcomeIndex >= 0 && outcomeIndex < 3) {
          const bestLevel = orderBook[outcomeId]?.[0]; // Highest price (best odds)
          if (bestLevel) {
            maxStakesEntry.max_stake_x12[0] = Math.max(maxStakesEntry.max_stake_x12[0], bestLevel.liquidity);
          }
        }
      });
    } else {
      const latestLinesEntry = linesData.length > 0 ? linesData[linesData.length - 1] : null;

      if (marketType === 'ah' && latestLinesEntry?.ah) {
        maxStakesEntry.max_stake_ah = {
          h: new Array(latestLinesEntry.ah.length).fill(0),
          a: new Array(latestLinesEntry.ah.length).fill(0)
        };

        Object.keys(orderBook).forEach(outcomeId => {
          let outcomeLineValue: number | undefined;
          let outcomeIndex: number | undefined;

          for (const [mappingKey, mapping] of Array.from(this.marketMapping.entries())) {
            if (mapping.outcomeMappings?.[outcomeId] !== undefined && mapping.marketType === 'ah') {
              outcomeLineValue = mapping.lineValue;
              outcomeIndex = mapping.outcomeMappings[outcomeId];
              break;
            }
          }

          if (outcomeLineValue !== undefined && outcomeIndex !== undefined) {
            const lineIndex = latestLinesEntry.ah.findIndex((line: number) => line === outcomeLineValue);
            if (lineIndex >= 0) {
              const bestLevel = orderBook[outcomeId]?.[0]; // Highest price (best odds)
              if (bestLevel) {
                const isHome = outcomeIndex % 2 === 0;
                if (isHome) {
                  maxStakesEntry.max_stake_ah.h[lineIndex] = bestLevel.liquidity;
                } else {
                  maxStakesEntry.max_stake_ah.a[lineIndex] = bestLevel.liquidity;
                }
              }
            }
          }
        });
      } else if (marketType === 'ou' && latestLinesEntry?.ou) {
        maxStakesEntry.max_stake_ou = {
          o: new Array(latestLinesEntry.ou.length).fill(0),
          u: new Array(latestLinesEntry.ou.length).fill(0)
        };

        Object.keys(orderBook).forEach(outcomeId => {
          let outcomeLineValue: number | undefined;
          let outcomeIndex: number | undefined;

          for (const [mappingKey, mapping] of Array.from(this.marketMapping.entries())) {
            if (mapping.outcomeMappings?.[outcomeId] !== undefined && mapping.marketType === 'ou') {
              outcomeLineValue = mapping.lineValue;
              outcomeIndex = mapping.outcomeMappings[outcomeId];
              break;
            }
          }

          if (outcomeLineValue !== undefined && outcomeIndex !== undefined) {
            const lineIndex = latestLinesEntry.ou.findIndex((line: number) => line === outcomeLineValue);
            if (lineIndex >= 0) {
              const bestLevel = orderBook[outcomeId]?.[0]; // Highest price (best odds)
              if (bestLevel) {
                const isOver = outcomeIndex % 2 === 0;
                if (isOver) {
                  maxStakesEntry.max_stake_ou.o[lineIndex] = bestLevel.liquidity;
                } else {
                  maxStakesEntry.max_stake_ou.u[lineIndex] = bestLevel.liquidity;
                }
              }
            }
          }
        });
      }
    }

    const jsonData = JSON.stringify(oddsArray);

    // Update latest_t timestamps
    const updatedLatestT = { ...currentLatestT };
    if (marketType === 'x12') updatedLatestT.x12_ts = timestamp;
    if (marketType === 'ah') updatedLatestT.ah_ts = timestamp;
    if (marketType === 'ou') updatedLatestT.ou_ts = timestamp;
    updatedLatestT.stakes_ts = timestamp; // Always update when max_stakes is updated

    // Merge max_stakes entry into existing array (like Pinnacle)
    if (Object.keys(maxStakesEntry).length > 1) {
      maxStakesData = this.mergeOddsEntry(maxStakesData, maxStakesEntry);
    }

    // For AH/OU, we might need to update lines if handicap/total values changed, but for now we'll assume they stay the same
    // Pinnacle handles line updates in their combined entries, but Monaco lines are static after initial setup

    const maxStakesJson = maxStakesData.length > 0 ? JSON.stringify(maxStakesData) : null;
    const linesJson = linesData.length > 0 ? JSON.stringify(linesData) : null;
    const idsJson = idsData.length > 0 ? JSON.stringify(idsData) : null;
    const latestTJson = Object.keys(updatedLatestT).length > 0 ? JSON.stringify(updatedLatestT) : null;

    await executeQuery(
      `UPDATE football_odds SET ${fieldName} = $1, max_stakes = $2, lines = $3, ids = $4, latest_t = $5, updated_at = now() WHERE fixture_id = $6 AND bookie = $7`,
      [jsonData, maxStakesJson, linesJson, idsJson, latestTJson, fixtureId, 'Monaco']
    );

    // Log the update with fixture name and market type
    console.log(`UPDATE football_odds - ${fixtureInfo} (${marketType})`);
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
}
