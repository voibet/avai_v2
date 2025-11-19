import { findMatchingFixture } from '../../utils/fixture-matching';
import { executeQuery } from '../../database/db-utils';
import { MonacoApiClient } from './monaco/monaco-api-client';
import { MonacoWebSocketClient } from './monaco/monaco-websocket-client';
import { MonacoOrderBook } from './monaco/monaco-order-book';
import { MonacoDatabaseService } from './monaco/monaco-database-service';
import { MonacoMarket, MarketMapping } from './monaco/types';

export class MonacoOddsService {
  private apiClient: MonacoApiClient;
  private wsClient: MonacoWebSocketClient;
  private orderBook: MonacoOrderBook;
  private dbService: MonacoDatabaseService;

  private marketMapping: Map<string, MarketMapping> = new Map();
  private eventIdToMappings: Map<string, MarketMapping[]> = new Map();
  private subscribedMarketKeys: Set<string> = new Set();
  private fixtureUpdateQueues: Map<number, Promise<void>> = new Map();
  private knownMonacoEventGroups: Set<string> = new Set();

  private isRunning: boolean = false;
  private marketRefetchInterval: NodeJS.Timeout | null = null;
  private messageQueue: any[] = [];
  private isProcessingMessages: boolean = false;
  private messageProcessingTimeout: NodeJS.Timeout | null = null;

  constructor() {
    const baseUrl = process.env.MONACO_BASE_URL!;
    const streamUrl = process.env.MONACO_STREAM_URL!;
    const appId = process.env.MONACO_APP_ID!;
    const apiKey = process.env.MONACO_API_KEY!;

    this.apiClient = new MonacoApiClient(baseUrl, appId, apiKey);
    this.wsClient = new MonacoWebSocketClient(streamUrl, this.apiClient);
    this.orderBook = new MonacoOrderBook();
    this.dbService = new MonacoDatabaseService();

    // Setup WebSocket message handler
    this.wsClient.onMessage((message) => {
      if (message.type === 'MarketPriceUpdate') {
        this.queueMessage({ type: 'price', data: message });
      } else if (message.type === 'MarketStatusUpdate') {
        this.queueMessage({ type: 'status', data: message });
      } else if (message.type === 'EventUpdate') {
        this.queueMessage({ type: 'event', data: message });
      }
    });
  }

  private log(message: string): void {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    console.log(`${time} Monaco: ${message}`);
  }

  async startContinuousFetching(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.log('Service starting');

    this.clearState();

    await this.loadKnownMonacoEventGroups();
    await this.fetchAndProcessMarkets();
    this.log(`Loaded ${this.marketMapping.size} market mappings`);
    
    await this.wsClient.connect();

    this.marketRefetchInterval = setInterval(async () => {
      try {
        const oldMarketMapping = new Map(this.marketMapping);
        const oldEventIdToMappings = new Map(this.eventIdToMappings);

        this.clearState();

        await this.fetchAndProcessMarkets(false);
        this.log(`Refetched ${this.marketMapping.size} market mappings`);

        const fixturesWithChanges = this.getFixturesWithMarketChanges(oldMarketMapping, oldEventIdToMappings);

        if (fixturesWithChanges.size > 0) {
          this.log(`Market changes detected for ${fixturesWithChanges.size} fixtures, updating database...`);
          for (const fixtureId of Array.from(fixturesWithChanges)) {
            const eventId = this.getEventIdForFixture(fixtureId);
            if (eventId) {
              const eventMappings = this.eventIdToMappings.get(eventId);
              if (eventMappings) {
                const markets = eventMappings.map(mapping => ({
                  id: mapping.marketId,
                  eventId: mapping.eventId,
                  marketTypeId: mapping.marketTypeId,
                  name: mapping.name,
                  marketOutcomes: mapping.outcomeMappings ? Object.keys(mapping.outcomeMappings).map((outcomeId, index) => ({
                    id: outcomeId,
                    title: `Outcome ${index}`,
                    ordering: mapping.outcomeMappings![outcomeId]
                  })) : [],
                  prices: []
                }));

                this.log(`Triggering database update for fixture ${fixtureId} due to market changes`);
                await this.dbService.ensureFixtureOddsRecord(
                  fixtureId,
                  markets,
                  this.mapMarketType.bind(this),
                  this.getHandicapValue.bind(this),
                  this.getTotalValue.bind(this)
                );
              }
            }
          }
        } else {
          this.log('No market changes detected, skipping database updates');
        }
      } catch (error) {
        console.error('Error refetching Monaco markets:', error);
      }
    }, 60 * 60 * 1000);

    this.log('Service started');
  }

  async stopContinuousFetching(): Promise<void> {
    this.isRunning = false;
    this.wsClient.stop();
    this.apiClient.stop();

    if (this.marketRefetchInterval) {
      clearInterval(this.marketRefetchInterval);
      this.marketRefetchInterval = null;
    }

    if (this.messageProcessingTimeout) {
      clearTimeout(this.messageProcessingTimeout);
      this.messageProcessingTimeout = null;
    }

    this.messageQueue.length = 0;
    this.isProcessingMessages = false;

    const pendingUpdates = Array.from(this.fixtureUpdateQueues.values());
    if (pendingUpdates.length > 0) {
      this.log(`Waiting for ${pendingUpdates.length} pending updates to complete...`);
      await Promise.all(pendingUpdates);
    }

    this.fixtureUpdateQueues.clear();
    this.log('Service stopped');
  }

  private clearState(): void {
    this.marketMapping.clear();
    this.eventIdToMappings.clear();
    this.subscribedMarketKeys.clear();
    this.orderBook.clear();
    this.fixtureUpdateQueues.clear();
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
    this.log(`Loaded ${this.knownMonacoEventGroups.size} event groups`);
  }

  private async fetchAndProcessMarkets(updateDatabase: boolean = true): Promise<void> {
    try {
      const { markets, events } = await this.apiClient.fetchAllMarkets();
      this.log(`Fetched ${markets.length} markets, ${events.length} events`);

      const processedMarkets: MonacoMarket[] = markets.map(market => ({
        id: market.id,
        eventId: (market as any).event?._ids?.[0] || (market as any).eventId,
        marketTypeId: (market as any).marketType?._ids?.[0] || (market as any).marketTypeId,
        name: market.name,
        marketOutcomes: Array.isArray((market as any).marketOutcomes) ? (market as any).marketOutcomes :
                       (market as any).marketOutcomes?._ids?.map((id: string, index: number) => ({ id, title: `Outcome ${index}`, ordering: index })) || [],
        prices: market.prices
      }));

      await this.processMarkets(processedMarkets, events, updateDatabase);
    } catch (error) {
      console.error('Error fetching markets:', error);
    }
  }

  private async processMarkets(markets: MonacoMarket[], events: any[], updateDatabase: boolean = true): Promise<void> {
    const eventMap = new Map(events.map(e => [e.id, e]));
    const marketsByEvent = new Map<string, MonacoMarket[]>();

    for (const market of markets) {
      const event = eventMap.get(market.eventId);
      if (!event) continue;

      const marketType = this.mapMarketType(market.marketTypeId);
      if (!marketType) continue;

      const lineValue = marketType === 'ah' ? this.getHandicapValue(market) :
                      marketType === 'ou' ? this.getTotalValue(market) : undefined;

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

      const eventMappings = this.eventIdToMappings.get(market.eventId) || [];
      eventMappings.push(mapping);
      this.eventIdToMappings.set(market.eventId, eventMappings);

      const eventMarkets = marketsByEvent.get(market.eventId) || [];
      eventMarkets.push(market);
      marketsByEvent.set(market.eventId, eventMarkets);
    }

    const fixturePromises: Promise<void>[] = [];

    marketsByEvent.forEach((eventMarkets, eventId) => {
      const event = eventMap.get(eventId)!;

      fixturePromises.push(
        this.findMatchingFixtureByEvent(event, eventId).then(async (fixtureId) => {
          if (!fixtureId) return;
          await this.processFixtureMarkets(fixtureId, eventMarkets, updateDatabase);
        })
      );
    });

    await Promise.all(fixturePromises);
  }

  private async processFixtureMarkets(fixtureId: number, markets: MonacoMarket[], updateDatabase: boolean = true): Promise<void> {
    const marketsByType: { [key: string]: MonacoMarket[] } = {};
    for (const market of markets) {
      const marketType = this.mapMarketType(market.marketTypeId);
      if (!marketType) continue;
      if (!marketsByType[marketType]) marketsByType[marketType] = [];
      marketsByType[marketType].push(market);
    }

    for (const [marketType, typeMarkets] of Object.entries(marketsByType)) {
      const sortedMarkets = typeMarkets.sort((a, b) => {
        const aValue = marketType === 'ah' ? this.getHandicapValue(a) : this.getTotalValue(a);
        const bValue = marketType === 'ah' ? this.getHandicapValue(b) : this.getTotalValue(b);
        return aValue - bValue;
      });

      sortedMarkets.forEach((market, index) => {
        const mappingKey = `${market.eventId}-${market.id}`;
        const existingMapping = this.marketMapping.get(mappingKey);
        if (existingMapping) {
          existingMapping.lineIndex = index;
          this.marketMapping.set(mappingKey, existingMapping);
        }
      });
    }

    for (const market of markets) {
      const mappingKey = `${market.eventId}-${market.id}`;
      const existingMapping = this.marketMapping.get(mappingKey);
      if (existingMapping) {
        existingMapping.fixtureId = fixtureId;
        this.marketMapping.set(mappingKey, existingMapping);
        this.subscribedMarketKeys.add(mappingKey);
      }
    }

    if (updateDatabase) {
      this.log(`Processing fixture markets for database - fixture ${fixtureId}, ${markets.length} markets`);
      const lineIndexMap = await this.dbService.ensureFixtureOddsRecord(
        fixtureId,
        markets,
        this.mapMarketType.bind(this),
        this.getHandicapValue.bind(this),
        this.getTotalValue.bind(this)
      );

      if (lineIndexMap && markets.length > 0) {
        const eventId = markets[0].eventId;
        lineIndexMap.forEach((index, marketId) => {
          const mappingKey = `${eventId}-${marketId}`;
          const mapping = this.marketMapping.get(mappingKey);
          if (mapping) {
            mapping.lineIndex = index;
            this.marketMapping.set(mappingKey, mapping);
          }
        });
      }
    }

    this.orderBook.initialize(fixtureId, markets, this.mapMarketType.bind(this));
  }

  private async findMatchingFixtureByEvent(event: any, eventId: string): Promise<number | null> {
    try {
      const teams = event.name.split(' v ');
      if (teams.length !== 2) return null;

      const homeTeam = teams[0].trim();
      const awayTeam = teams[1].trim();
      const expectedStartTime = new Date(event.expectedStartTime);
      const eventGroupId = event.eventGroup._ids[0];

      const leagueResult = await executeQuery(`
        SELECT id FROM football_leagues
        WHERE "monaco_eventGroup" = $1 OR "monaco_eventGroup" LIKE $2 OR "monaco_eventGroup" LIKE $3 OR "monaco_eventGroup" LIKE $4
        LIMIT 1
      `, [eventGroupId, `${eventGroupId},%`, `%,${eventGroupId}`, `%,${eventGroupId},%`]);

      if (leagueResult.rows.length === 0) return null;

      const leagueId = leagueResult.rows[0].id;

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

  private mapMarketType(marketTypeId: string): string | null {
    switch (marketTypeId) {
      case 'FOOTBALL_FULL_TIME_RESULT': return 'x12';
      case 'FOOTBALL_FULL_TIME_RESULT_HANDICAP': return 'ah';
      case 'FOOTBALL_OVER_UNDER_TOTAL_GOALS': return 'ou';
      default: return null;
    }
  }

  private getHandicapValue(market: MonacoMarket): number {
    const match = market.name.match(/Goal Handicap ([\+\-\d\.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  private getTotalValue(market: MonacoMarket): number {
    const match = market.name.match(/Total Goals Over\/Under ([\d\.]+)/);
    return match ? parseFloat(match[1]) : 0;
  }

  private queueMessage(message: { type: string; data: any }): void {
    this.messageQueue.push(message);
    this.scheduleMessageProcessing();
  }

  private scheduleMessageProcessing(): void {
    if (this.messageProcessingTimeout) return;

    this.messageProcessingTimeout = setTimeout(() => {
      this.messageProcessingTimeout = null;
      this.processQueuedMessages();
    }, 10);
  }

  private async processQueuedMessages(): Promise<void> {
    if (this.isProcessingMessages || this.messageQueue.length === 0) return;

    this.isProcessingMessages = true;

    try {
      const batchSize = 50;
      const messagesToProcess = this.messageQueue.splice(0, batchSize);
      
      const priceMessages: any[] = [];
      const statusMessages: any[] = [];
      const eventMessages: any[] = [];

      for (const message of messagesToProcess) {
        if (message.type === 'price') priceMessages.push(message.data);
        else if (message.type === 'status') statusMessages.push(message.data);
        else if (message.type === 'event') eventMessages.push(message.data);
      }

      await Promise.allSettled([
        ...priceMessages.map(msg => this.handlePriceUpdate(msg)),
        ...statusMessages.map(msg => this.handleStatusUpdate(msg)),
        ...eventMessages.map(msg => this.handleEventUpdate(msg))
      ]);

    } catch (error) {
      console.error('Error processing message batch:', error);
    } finally {
      this.isProcessingMessages = false;
      if (this.messageQueue.length > 0) {
        this.scheduleMessageProcessing();
      }
    }
  }

  private async handlePriceUpdate(message: any): Promise<void> {
    if (!message.marketId || !message.eventId || !message.prices || message.prices.length === 0) return;
    if (!this.subscribedMarketKeys.has(`${message.eventId}-${message.marketId}`)) return;

    try {
      const mappingKey = `${message.eventId}-${message.marketId}`;
      const marketMapping = this.marketMapping.get(mappingKey)!;
      if (!marketMapping.fixtureId) return;

      const fixtureId = marketMapping.fixtureId;
      const previousUpdate = this.fixtureUpdateQueues.get(fixtureId) || Promise.resolve();

      const currentUpdate = previousUpdate.then(async () => {
        try {
          const updatedOrderBook = this.orderBook.update(fixtureId, message, marketMapping.marketType, marketMapping);
          await this.dbService.updateDatabaseWithBestPrices(fixtureId, marketMapping.marketType, updatedOrderBook, this.marketMapping);
        } catch (error) {
          console.error(`Error processing update for fixture ${fixtureId}:`, error);
        }
      });

      this.fixtureUpdateQueues.set(fixtureId, currentUpdate);
    } catch (error) {
      console.error('Error handling price update:', error);
    }
  }

  private async handleStatusUpdate(message: any): Promise<void> {
    if (!message.marketId || !message.eventId) return;
    if (!this.subscribedMarketKeys.has(`${message.eventId}-${message.marketId}`)) return;

    const shouldZeroOdds = message.status !== 'Open' || message.inPlayStatus !== 'PrePlay';
    if (!shouldZeroOdds) return;

    try {
      const mappingKey = `${message.eventId}-${message.marketId}`;
      const marketMapping = this.marketMapping.get(mappingKey)!;
      if (!marketMapping.fixtureId) return;

      const fixtureId = marketMapping.fixtureId;
      this.log(`Market ${message.marketId} status changed to ${message.status}/${message.inPlayStatus}, zeroing odds for fixture ${fixtureId}`);

      const previousUpdate = this.fixtureUpdateQueues.get(fixtureId) || Promise.resolve();
      const currentUpdate = previousUpdate.then(async () => {
        try {
          this.log(`Triggering database update for fixture ${fixtureId} (${marketMapping.marketType}) - zeroing odds due to status change`);
          await this.dbService.zeroOutMarketOdds(fixtureId, marketMapping.marketType);
        } catch (error) {
          console.error(`Error zeroing odds for fixture ${fixtureId}:`, error);
        }
      });

      this.fixtureUpdateQueues.set(fixtureId, currentUpdate);
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  }

  private async handleEventUpdate(message: any): Promise<void> {
    if (!message.eventId) return;

    try {
      const mappings = this.eventIdToMappings.get(message.eventId);
      if (!mappings || mappings.length === 0) return;

      const fixtureId = mappings[0].fixtureId;
      if (!fixtureId) return;

      this.log(`Event update for fixture ${fixtureId}: ${JSON.stringify(message)}`);
    } catch (error) {
      console.error('Error handling event update:', error);
    }
  }

  private getFixturesWithMarketChanges(oldMapping: Map<string, MarketMapping>, oldEventIdToMappings: Map<string, MarketMapping[]>): Set<number> {
    const fixturesWithChanges = new Set<number>();

    // Check for new markets or changes in existing markets
    this.marketMapping.forEach((newMapping, key) => {
      const old = oldMapping.get(key);
      if (!old) {
        // New market found
        if (newMapping.fixtureId) fixturesWithChanges.add(newMapping.fixtureId);
      } else {
        // Check if critical fields changed
        if (old.lineValue !== newMapping.lineValue || old.lineIndex !== newMapping.lineIndex) {
          if (newMapping.fixtureId) fixturesWithChanges.add(newMapping.fixtureId);
        }
      }
    });

    // Check for removed markets
    oldMapping.forEach((old, key) => {
      if (!this.marketMapping.has(key)) {
        if (old.fixtureId) fixturesWithChanges.add(old.fixtureId);
      }
    });

    return fixturesWithChanges;
  }

  private getEventIdForFixture(fixtureId: number): string | undefined {
    for (const [eventId, mappings] of Array.from(this.eventIdToMappings.entries())) {
      if (mappings.some(m => m.fixtureId === fixtureId)) {
        return eventId;
      }
    }
    return undefined;
  }
}
