import { executeQuery } from '../../../database/db-utils';
import { findMatchingFixture } from '../../../utils/fixture-matching';
import { PinnacleEvent, PinnaclePeriod } from './types';

export class PinnacleDatabaseService {
    private knownPinnacleLeagues: Set<number> = new Set();

    /**
     * Helper for consistent logging with timestamp and service prefix
     */
    private log(message: string): void {
        const now = new Date();
        const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
        console.log(`${time} Pinnacle DB: ${message}`);
    }

    /**
     * Loads known pinnacle league IDs from database
     */
    async loadKnownPinnacleLeagues(): Promise<void> {
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

    isLeagueKnown(leagueId: number): boolean {
        return this.knownPinnacleLeagues.has(leagueId);
    }

    getKnownLeaguesCount(): number {
        return this.knownPinnacleLeagues.size;
    }

    /**
     * Batch lookup: Checks which event_ids already have odds in the database
     * @returns Map<eventId, fixtureId> for existing odds
     */
    async getExistingOddsMap(eventIds: number[]): Promise<Map<number, number>> {
        if (eventIds.length === 0) return new Map();

        const query = `
            SELECT bookie_id, fixture_id
            FROM football_odds
            WHERE bookie_id = ANY($1) AND bookie = 'Pinnacle'
        `;
        const result = await executeQuery(query, [eventIds]);

        const map = new Map<number, number>();
        result.rows.forEach(row => {
            // Convert to number to ensure type consistency
            const bookieId = Number(row.bookie_id);
            const fixtureId = Number(row.fixture_id);
            map.set(bookieId, fixtureId);
        });

        return map;
    }

    /**
     * Batch lookup: Gets current odds data for multiple events
     * @returns Map<eventId, oddsData>
     */
    async getBatchExistingOdds(eventIds: number[]): Promise<Map<number, any>> {
        if (eventIds.length === 0) return new Map();

        const query = `
            SELECT 
                bookie_id,
                fixture_id, 
                odds_x12, 
                odds_ah, 
                odds_ou, 
                lines, 
                ids, 
                max_stakes, 
                latest_t
            FROM football_odds
            WHERE bookie_id = ANY($1) AND bookie = 'Pinnacle'
        `;
        const result = await executeQuery(query, [eventIds]);

        const map = new Map();
        result.rows.forEach(row => {
            // Convert bigint to number to ensure type consistency
            const bookieId = Number(row.bookie_id);
            const fixtureId = Number(row.fixture_id);

            map.set(bookieId, {
                fixtureId: fixtureId,
                oddsX12: row.odds_x12,
                oddsAh: row.odds_ah,
                oddsOu: row.odds_ou,
                lines: row.lines,
                ids: row.ids,
                maxStakes: row.max_stakes,
                latestT: row.latest_t
            });
        });

        return map;
    }

    /**
     * Finds a matching fixture based on criteria
     */
    async findMatchingFixture(
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
     * Helper to check if two arrays are deeply equal
     */
    private arraysEqual(a: any[], b: any[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((val, index) => {
            if (Array.isArray(val) && Array.isArray(b[index])) {
                return this.arraysEqual(val, b[index]);
            }
            if (typeof val === 'object' && typeof b[index] === 'object') {
                return JSON.stringify(val) === JSON.stringify(b[index]);
            }
            return val === b[index];
        });
    }

    /**
     * Helper to check if new odds data is different from the last entry
     */
    private isNewDataDifferent(existingArray: any[], newData: any): boolean {
        if (existingArray.length === 0) return true;
        const lastEntry = existingArray[existingArray.length - 1];

        // Remove timestamp from comparison
        const { t: _, ...lastData } = lastEntry;
        const { t: __, ...newDataWithoutTime } = newData;

        return !this.arraysEqual([lastData], [newDataWithoutTime]);
    }

    /**
     * Helper to merge new entry into history, keeping newest first
     */
    private mergeHistory(existing: any[], newEntry: any): any[] {
        const merged = [...(Array.isArray(existing) ? existing : [])];
        const existingIndex = merged.findIndex(entry => entry.t === newEntry.t);

        if (existingIndex >= 0) {
            merged[existingIndex] = newEntry;
        } else {
            merged.push(newEntry);
        }

        // Sort newest first (descending timestamp)
        return merged.sort((a, b) => b.t - a.t);
    }

    /**
     * Creates new odds entry for a fixture
     */
    async createNewOddsEntry(
        fixtureId: number,
        eventId: number,
        period: PinnaclePeriod,
        homeTeam: string,
        awayTeam: string,
        existingData?: any
    ): Promise<void> {
        const timestamp = Math.floor(Date.now() / 1000);

        // Transform Pinnacle odds to our format (decimals = 3, multiply by 1000)
        const transformOdds = (odds: number): number => {
            return Math.round(odds * 1000);
        };

        // Track what was created
        const createdFields: string[] = [];

        // Prepare X12 odds (money line)
        let x12Odds: any[] = existingData?.oddsX12 || [];
        if (period.money_line) {
            const newEntry = {
                t: timestamp,
                x12: [
                    transformOdds(period.money_line.home),
                    transformOdds(period.money_line.draw),
                    transformOdds(period.money_line.away)
                ]
            };
            x12Odds = this.mergeHistory(x12Odds, newEntry);
            createdFields.push('x12');
        }

        // Prepare AH odds (spreads)
        // Prepare AH odds (spreads)
        let ahOdds: any[] = existingData?.oddsAh || [];
        let ouOdds: any[] = existingData?.oddsOu || [];
        let lines: any[] = existingData?.lines || [];
        let ids: any[] = existingData?.ids || [];

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

            ahOdds = this.mergeHistory(ahOdds, {
                t: timestamp,
                ah_h: ahHome,
                ah_a: ahAway
            });

            combinedLineEntry.ah = ahLineValues;
            combinedIdEntry.line_ids.ah = ahAltLineIds;
            createdFields.push('ah');
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

            ouOdds = this.mergeHistory(ouOdds, {
                t: timestamp,
                ou_o: ouOver,
                ou_u: ouUnder
            });

            combinedLineEntry.ou = ouLineValues;
            combinedIdEntry.line_ids.ou = ouAltLineIds;
            createdFields.push('ou');
        }

        // Add combined entries
        if (combinedLineEntry.ah || combinedLineEntry.ou) {
            lines = this.mergeHistory(lines, combinedLineEntry);
            createdFields.push('lines');
        }

        if (Object.keys(combinedIdEntry.line_ids).length > 0) {
            ids = this.mergeHistory(ids, combinedIdEntry);
            createdFields.push('ids');
        }

        // Prepare max stakes
        let maxStakes: any[] = existingData?.maxStakes || [];
        if (period.meta) {
            maxStakes = this.mergeHistory(maxStakes, {
                t: timestamp,
                max_stake_x12: period.meta.max_money_line ? [period.meta.max_money_line] : [],
                max_stake_ah: period.meta.max_spread ? { h: [period.meta.max_spread], a: [period.meta.max_spread] } : {},
                max_stake_ou: period.meta.max_total ? { o: [period.meta.max_total], u: [period.meta.max_total] } : {}
            });
            createdFields.push('max_stakes');
        }

        // Prepare latest_t
        const latestT: any = {};
        if (x12Odds.length > 0) latestT.x12_ts = timestamp;
        if (ahOdds.length > 0) latestT.ah_ts = timestamp;
        if (ouOdds.length > 0) latestT.ou_ts = timestamp;
        if (lines.length > 0) latestT.lines_ts = timestamp;
        if (ids.length > 0) latestT.ids_ts = timestamp;
        if (maxStakes.length > 0) latestT.stakes_ts = timestamp;

        // Insert new record or update if fixture already has Pinnacle odds with different event_id
        const upsertQuery = `
        INSERT INTO football_odds (
            fixture_id, bookie_id, bookie, decimals,
            odds_x12, odds_ah, odds_ou, lines, ids, max_stakes, latest_t
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (fixture_id, bookie) DO UPDATE SET
            bookie_id = EXCLUDED.bookie_id,
            odds_x12 = EXCLUDED.odds_x12,
            odds_ah = EXCLUDED.odds_ah,
            odds_ou = EXCLUDED.odds_ou,
            lines = EXCLUDED.lines,
            ids = EXCLUDED.ids,
            max_stakes = EXCLUDED.max_stakes,
            latest_t = EXCLUDED.latest_t,
            updated_at = NOW()
        `;

        await executeQuery(upsertQuery, [
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

        this.log(`Created/updated odds entry for ${homeTeam} v ${awayTeam} - ${createdFields.join(', ')}`);
    }
}
