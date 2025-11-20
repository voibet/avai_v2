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
     * Checks if odds exist for a Pinnacle event
     */
    async hasExistingOdds(eventId: number): Promise<boolean> {
        const existingOddsQuery = `
      SELECT fixture_id
      FROM football_odds
      WHERE bookie_id = $1 AND bookie = 'Pinnacle'
    `;
        const existingOddsResult = await executeQuery(existingOddsQuery, [eventId]);
        return existingOddsResult.rows.length > 0;
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
     * Updates existing odds for a Pinnacle event
     */
    async updateExistingOdds(eventId: number, period: PinnaclePeriod, homeTeam: string, awayTeam: string): Promise<void> {
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

        // Track what was updated
        const updatedFields: string[] = [];

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

            if (this.isNewDataDifferent(x12Odds, newX12Entry)) {
                x12Odds.push(newX12Entry);
                latestT.x12_ts = timestamp;
                updatedFields.push('x12');
            }
        }

        // Collect line data for both AH and OU
        // First, get the previous lines entry to preserve AH/OU lines that aren't being updated
        const previousLinesEntry = lines.length > 0 ? lines[lines.length - 1] : null;
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

            if (this.isNewDataDifferent(ahOdds, newAhEntry)) {
                ahOdds.push(newAhEntry);
                combinedLineEntry.ah = ahLineValues;
                combinedIdEntry.line_ids.ah = ahAltLineIds;
                latestT.ah_ts = timestamp;
                updatedFields.push('ah');
            } else if (previousLinesEntry?.ah) {
                // Preserve previous AH lines if AH odds didn't change
                combinedLineEntry.ah = previousLinesEntry.ah;
            }
        } else if (previousLinesEntry?.ah) {
            // Preserve previous AH lines if no AH spreads in this update
            combinedLineEntry.ah = previousLinesEntry.ah;
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

            if (this.isNewDataDifferent(ouOdds, newOuEntry)) {
                ouOdds.push(newOuEntry);
                combinedLineEntry.ou = ouLineValues;
                combinedIdEntry.line_ids.ou = ouAltLineIds;
                latestT.ou_ts = timestamp;
                updatedFields.push('ou');
            } else if (previousLinesEntry?.ou) {
                // Preserve previous OU lines if OU odds didn't change
                combinedLineEntry.ou = previousLinesEntry.ou;
            }
        } else if (previousLinesEntry?.ou) {
            // Preserve previous OU lines if no OU totals in this update
            combinedLineEntry.ou = previousLinesEntry.ou;
        }

        // Only add combined line entry if line values have actually changed
        if (combinedLineEntry.ah || combinedLineEntry.ou) {
            if (this.isNewDataDifferent(lines, combinedLineEntry)) {
                lines.push(combinedLineEntry);
                latestT.lines_ts = timestamp;
                updatedFields.push('lines');
            }
        }

        // Preserve previous IDs for markets that weren't updated
        const previousIdEntry = ids.length > 0 ? ids[ids.length - 1] : null;
        if (previousIdEntry?.line_ids) {
            if (!combinedIdEntry.line_ids.ah && previousIdEntry.line_ids.ah) {
                combinedIdEntry.line_ids.ah = previousIdEntry.line_ids.ah;
            }
            if (!combinedIdEntry.line_ids.ou && previousIdEntry.line_ids.ou) {
                combinedIdEntry.line_ids.ou = previousIdEntry.line_ids.ou;
            }
        }

        // Only update ID entry if ID values have actually changed
        if (Object.keys(combinedIdEntry.line_ids).length > 0) {
            if (this.isNewDataDifferent(ids, combinedIdEntry)) {
                // For IDs, overwrite the latest entry instead of keeping history
                if (ids.length > 0) {
                    ids[ids.length - 1] = combinedIdEntry;
                } else {
                    ids.push(combinedIdEntry);
                }
                latestT.ids_ts = timestamp;
                updatedFields.push('ids');
            }
        }

        // Only update max stakes if values have actually changed
        if (period.meta) {
            const newMaxStakeEntry = {
                t: timestamp,
                max_stake_x12: period.meta.max_money_line ? [period.meta.max_money_line] : [],
                max_stake_ah: period.meta.max_spread ? { h: [period.meta.max_spread], a: [period.meta.max_spread] } : {},
                max_stake_ou: period.meta.max_total ? { o: [period.meta.max_total], u: [period.meta.max_total] } : {}
            };

            if (this.isNewDataDifferent(maxStakes, newMaxStakeEntry)) {
                maxStakes.push(newMaxStakeEntry);
                latestT.stakes_ts = timestamp;
                updatedFields.push('max_stakes');
            }
        }

        // Only update database if there were actual changes
        if (updatedFields.length > 0) {
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

            this.log(`Updated ${homeTeam} v ${awayTeam} - ${updatedFields.join(', ')}`);
        } else {
            this.log(`No changes for ${homeTeam} v ${awayTeam} - data unchanged`);
        }
    }

    /**
     * Creates new odds entry for a fixture
     */
    async createNewOddsEntry(
        fixtureId: number,
        eventId: number,
        period: PinnaclePeriod,
        homeTeam: string,
        awayTeam: string
    ): Promise<void> {
        const timestamp = Math.floor(Date.now() / 1000);

        // Transform Pinnacle odds to our format (decimals = 3, multiply by 1000)
        const transformOdds = (odds: number): number => {
            return Math.round(odds * 1000);
        };

        // Track what was created
        const createdFields: string[] = [];

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
            createdFields.push('x12');
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

            ouOdds.push({
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
            lines.push(combinedLineEntry);
            createdFields.push('lines');
        }

        if (Object.keys(combinedIdEntry.line_ids).length > 0) {
            ids.push(combinedIdEntry);
            createdFields.push('ids');
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

        this.log(`Created new odds entry for ${homeTeam} v ${awayTeam} - ${createdFields.join(', ')}`);
    }
}
