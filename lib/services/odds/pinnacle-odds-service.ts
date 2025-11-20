import { PinnacleApiClient } from './pinnacle/pinnacle-api-client';
import { PinnacleDatabaseService } from './pinnacle/pinnacle-database-service';
import { PinnacleMarket, PinnacleEvent } from './pinnacle/types';

class PinnacleOddsService {
  private apiClient: PinnacleApiClient;
  private dbService: PinnacleDatabaseService;
  private isRunning: boolean = false;
  private runInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.apiClient = new PinnacleApiClient();
    this.dbService = new PinnacleDatabaseService();
  }

  /**
   * Helper for consistent logging with timestamp and service prefix
   */
  private log(message: string): void {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
    console.log(`${time} Pinnacle: ${message}`);
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
    if (this.dbService.getKnownLeaguesCount() === 0) {
      await this.dbService.loadKnownPinnacleLeagues();
    }

    // Filter events to only those with known league IDs
    const filteredEvents = marketData.events.filter(event =>
      this.dbService.isLeagueKnown(event.league_id)
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
    const hasExisting = await this.dbService.hasExistingOdds(event.event_id);

    if (hasExisting) {
      // Update existing odds
      await this.dbService.updateExistingOdds(event.event_id, period, event.home, event.away);
      return { updated: true };
    }

    // No existing odds found - create new entry
    this.log(`No existing odds for event ${event.event_id}, searching for fixture match...`);

    // Parse start time
    const startTime = new Date(event.starts);

    // Find matching fixture using service
    const fixtureId = await this.dbService.findMatchingFixture(
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
    await this.dbService.createNewOddsEntry(fixtureId, event.event_id, period, event.home, event.away);
    return { updated: true };
  }

  /**
   * Main method to fetch and process odds
   */
  async fetchAndProcessOdds(): Promise<{
    eventsProcessed: number;
    fixturesUpdated: number;
  }> {

    const marketData = await this.apiClient.fetchOdds();
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
}

export const pinnacleOddsService = new PinnacleOddsService();
