import { executeQuery } from '../../../database/db-utils';
import { MonacoMarket, OrderBook, MarketMapping } from './types';

export class MonacoDatabaseService {
    private log(message: string): void {
        const now = new Date();
        const time = now.toTimeString().slice(0, 8);
        console.log(`${time} MonacoDB: ${message}`);
    }

    private transformPrice(price: number): number {
        return Math.floor(((price - 1) * 0.99 + 1) * 1000);
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

    private mergeOddsEntry(existing: any[], newEntry: any): any[] {
        const merged = [...existing];
        const existingIndex = merged.findIndex(entry => entry.t === newEntry.t);

        if (existingIndex >= 0) {
            merged[existingIndex] = newEntry;
        } else {
            merged.push(newEntry);
        }

        return merged.sort((a, b) => a.t - b.t);
    }

    public async ensureFixtureOddsRecord(fixtureId: number, markets: MonacoMarket[], mapMarketType: (id: string) => string | null, getHandicapValue: (m: MonacoMarket) => number, getTotalValue: (m: MonacoMarket) => number): Promise<Map<string, number> | undefined> {
        if (markets.length === 0) return undefined;

        const fixtureResult = await executeQuery(
            'SELECT home_team_name, away_team_name FROM football_fixtures WHERE id = $1',
            [fixtureId]
        );
        const fixtureInfo = fixtureResult.rows.length > 0 ?
            `${fixtureResult.rows[0].home_team_name} vs ${fixtureResult.rows[0].away_team_name}` :
            `fixture ${fixtureId}`;

        const structure = this.buildFixtureStructure(markets, mapMarketType, getHandicapValue, getTotalValue);
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
            this.log(`Creating odds record for ${fixtureInfo} - INSERT: fixture_id=${fixtureId}, bookie=Monaco, markets=${markets.length}`);
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
            this.log(`Database INSERT completed for ${fixtureInfo} - created initial odds structure`);
        } else {
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
            this.log(`Database UPDATE for ${fixtureInfo} - updated lines/ids structure`);
        }

        return structure.lineIndexMap;
    }

    private buildFixtureStructure(markets: MonacoMarket[], mapMarketType: (id: string) => string | null, getHandicapValue: (m: MonacoMarket) => number, getTotalValue: (m: MonacoMarket) => number) {
        const timestamp = Math.floor(Date.now() / 1000);
        const linesEntry: any = { t: timestamp };
        const idsEntry: any = { t: timestamp, line_id: '', line_ids: {} as Record<string, string[]> };
        const maxStakesEntry: any = { t: timestamp };
        const lineIndexMap = new Map<string, number>();

        const x12Markets: MonacoMarket[] = [];
        const ahLines: Array<{ value: number; market: MonacoMarket }> = [];
        const ouLines: Array<{ value: number; market: MonacoMarket }> = [];

        markets.forEach(market => {
            const marketType = mapMarketType(market.marketTypeId);
            if (!marketType) return;

            if (!idsEntry.line_ids[marketType]) {
                idsEntry.line_ids[marketType] = [];
            }
            idsEntry.line_ids[marketType].push(market.id);

            if (marketType === 'x12') {
                x12Markets.push(market);
                return;
            }

            const value = marketType === 'ah' ? getHandicapValue(market) : getTotalValue(market);
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

    public async updateDatabaseWithBestPrices(fixtureId: number, marketType: string, orderBook: OrderBook, marketMappings: Map<string, MarketMapping>): Promise<void> {
        const timestamp = Math.floor(Date.now() / 1000);
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

        let oddsArray = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0][fieldName]) : [];
        let linesData = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0].lines) : [];
        let idsData = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0].ids) : [];
        let maxStakesData = existingResult.rows.length > 0 ? this.parseJsonArray(existingResult.rows[0].max_stakes) : [];
        const currentLatestT = existingResult.rows.length > 0 && existingResult.rows[0].latest_t ? existingResult.rows[0].latest_t : {};

        const newOddsEntry: any = { t: timestamp };
        const maxStakesEntry: any = { t: timestamp };

        if (marketType === 'x12') {
            const x12Prices = [0, 0, 0];
            maxStakesEntry.max_stake_x12 = [0];

            Object.keys(orderBook).forEach(outcomeId => {
                // Find mapping for this outcome
                let outcomeIndex: number | undefined;
                for (const mapping of Array.from(marketMappings.values())) {
                    if (mapping.outcomeMappings?.[outcomeId] !== undefined) {
                        outcomeIndex = mapping.outcomeMappings[outcomeId];
                        break;
                    }
                }

                if (outcomeIndex !== undefined && outcomeIndex >= 0 && outcomeIndex < 3) {
                    const bestLevel = orderBook[outcomeId]?.[0];
                    if (bestLevel) {
                        x12Prices[outcomeIndex] = this.transformPrice(bestLevel.price);
                        maxStakesEntry.max_stake_x12[0] = Math.max(maxStakesEntry.max_stake_x12[0], bestLevel.liquidity);
                    }
                }
            });
            newOddsEntry.x12 = x12Prices;
        } else {
            const latestLinesEntry = linesData.length > 0 ? linesData[linesData.length - 1] : null;

            if (marketType === 'ah' && latestLinesEntry?.ah) {
                newOddsEntry.ah_h = new Array(latestLinesEntry.ah.length).fill(0);
                newOddsEntry.ah_a = new Array(latestLinesEntry.ah.length).fill(0);
                maxStakesEntry.max_stake_ah = {
                    h: new Array(latestLinesEntry.ah.length).fill(0),
                    a: new Array(latestLinesEntry.ah.length).fill(0)
                };

                Object.keys(orderBook).forEach(outcomeId => {
                    let outcomeLineValue: number | undefined;
                    let outcomeIndex: number | undefined;

                    for (const mapping of Array.from(marketMappings.values())) {
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
                            const bestLevel = orderBook[outcomeId]?.[0];
                            if (bestLevel) {
                                const transformedPrice = this.transformPrice(bestLevel.price);
                                if (isHome) {
                                    newOddsEntry.ah_h[lineIndex] = transformedPrice;
                                    maxStakesEntry.max_stake_ah.h[lineIndex] = bestLevel.liquidity;
                                } else {
                                    newOddsEntry.ah_a[lineIndex] = transformedPrice;
                                    maxStakesEntry.max_stake_ah.a[lineIndex] = bestLevel.liquidity;
                                }
                            }
                        }
                    }
                });
            } else if (marketType === 'ou' && latestLinesEntry?.ou) {
                newOddsEntry.ou_o = new Array(latestLinesEntry.ou.length).fill(0);
                newOddsEntry.ou_u = new Array(latestLinesEntry.ou.length).fill(0);
                maxStakesEntry.max_stake_ou = {
                    o: new Array(latestLinesEntry.ou.length).fill(0),
                    u: new Array(latestLinesEntry.ou.length).fill(0)
                };

                Object.keys(orderBook).forEach(outcomeId => {
                    let outcomeLineValue: number | undefined;
                    let outcomeIndex: number | undefined;

                    for (const mapping of Array.from(marketMappings.values())) {
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
                            const bestLevel = orderBook[outcomeId]?.[0];
                            if (bestLevel) {
                                const transformedPrice = this.transformPrice(bestLevel.price);
                                if (isOver) {
                                    newOddsEntry.ou_o[lineIndex] = transformedPrice;
                                    maxStakesEntry.max_stake_ou.o[lineIndex] = bestLevel.liquidity;
                                } else {
                                    newOddsEntry.ou_u[lineIndex] = transformedPrice;
                                    maxStakesEntry.max_stake_ou.u[lineIndex] = bestLevel.liquidity;
                                }
                            }
                        }
                    }
                });
            }
        }

        oddsArray = this.mergeOddsEntry(oddsArray, newOddsEntry);

        const updatedLatestT = { ...currentLatestT };
        if (marketType === 'x12') updatedLatestT.x12_ts = timestamp;
        if (marketType === 'ah') updatedLatestT.ah_ts = timestamp;
        if (marketType === 'ou') updatedLatestT.ou_ts = timestamp;
        updatedLatestT.stakes_ts = timestamp;

        if (Object.keys(maxStakesEntry).length > 1) {
            maxStakesData = this.mergeOddsEntry(maxStakesData, maxStakesEntry);
        }

        const jsonData = JSON.stringify(oddsArray);
        const maxStakesJson = maxStakesData.length > 0 ? JSON.stringify(maxStakesData) : null;
        const linesJson = linesData.length > 0 ? JSON.stringify(linesData) : null;
        const idsJson = idsData.length > 0 ? JSON.stringify(idsData) : null;
        const latestTJson = Object.keys(updatedLatestT).length > 0 ? JSON.stringify(updatedLatestT) : null;

        // Log detailed update information
        const fixtureName = existingResult.rows[0]?.home_team_name && existingResult.rows[0]?.away_team_name
            ? `${existingResult.rows[0].home_team_name} vs ${existingResult.rows[0].away_team_name}`
            : `fixture ${fixtureId}`;
        const oddsSummary = Object.keys(newOddsEntry).filter(k => k !== 't').join(',');
        this.log(`Database UPDATE for ${fixtureName} (${marketType}) - odds fields: ${oddsSummary}, timestamp: ${timestamp}`);

        await executeQuery(
            `UPDATE football_odds SET ${fieldName} = $1, max_stakes = $2, lines = $3, ids = $4, latest_t = $5, updated_at = now() WHERE fixture_id = $6 AND bookie = $7`,
            [jsonData, maxStakesJson, linesJson, idsJson, latestTJson, fixtureId, 'Monaco']
        );
        this.log(`Database UPDATE completed for ${fixtureName} (${marketType}) - ${oddsArray.length} odds entries`);
    }

    public async zeroOutMarketOdds(fixtureId: number, marketType: string): Promise<void> {
        const timestamp = Math.floor(Date.now() / 1000);
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
                return;
        }

        const existingResult = await executeQuery(
            `SELECT o.${fieldName}, o.max_stakes, o.latest_t
       FROM football_odds o
       WHERE o.fixture_id = $1 AND o.bookie = $2`,
            [fixtureId, 'Monaco']
        );

        if (existingResult.rows.length === 0) return;

        let oddsArray = this.parseJsonArray(existingResult.rows[0][fieldName]);
        let maxStakesData = this.parseJsonArray(existingResult.rows[0].max_stakes);
        let latestT = existingResult.rows[0].latest_t || {};

        let zeroMaxStakesEntry: any = { t: timestamp };
        if (marketType === 'x12') {
            zeroMaxStakesEntry.max_stake_x12 = [0, 0, 0];
        } else if (marketType === 'ah') {
            zeroMaxStakesEntry.max_stake_ah = { h: [0, 0, 0], a: [0, 0, 0] };
        } else if (marketType === 'ou') {
            zeroMaxStakesEntry.max_stake_ou = { o: [0, 0, 0], u: [0, 0, 0] };
        }

        oddsArray = this.mergeOddsEntry(oddsArray, zeroEntry);
        maxStakesData = this.mergeOddsEntry(maxStakesData, zeroMaxStakesEntry);

        const tsKey = marketType === 'x12' ? 'x12_ts' : marketType === 'ah' ? 'ah_ts' : 'ou_ts';
        latestT[tsKey] = timestamp;
        latestT.stakes_ts = timestamp;

        const jsonData = JSON.stringify(oddsArray);
        const maxStakesJson = JSON.stringify(maxStakesData);
        const latestTJson = JSON.stringify(latestT);

        // Log zeroing operation details
        const fixtureName = existingResult.rows[0] ? `fixture ${fixtureId}` : `fixture ${fixtureId}`;
        this.log(`Database UPDATE (zeroing) for ${fixtureName} (${marketType}) - setting all odds to 0, timestamp: ${timestamp}`);

        await executeQuery(
            `UPDATE football_odds SET ${fieldName} = $1, max_stakes = $2, latest_t = $3, updated_at = now() WHERE fixture_id = $4 AND bookie = $5`,
            [jsonData, maxStakesJson, latestTJson, fixtureId, 'Monaco']
        );
        this.log(`Database UPDATE completed for ${fixtureName} (${marketType}) - zeroed out ${oddsArray.length} odds entries`);
    }
}
