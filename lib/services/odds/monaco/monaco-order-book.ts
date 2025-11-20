import { OrderBook, PriceLevel, MonacoMarket, MarketMapping } from './types';

export class MonacoOrderBook {
    // fixtureId-marketType -> OrderBook
    private orderBooks: Map<string, OrderBook> = new Map();

    public clear(): void {
        this.orderBooks.clear();
    }

    public initialize(fixtureId: number, markets: MonacoMarket[], mapMarketType: (id: string) => string | null): void {
        for (const market of markets) {
            const marketType = mapMarketType(market.marketTypeId);
            if (!marketType || !market.prices) continue;

            const orderBookKey = `${fixtureId}-${marketType}`;
            if (!this.orderBooks.has(orderBookKey)) {
                this.orderBooks.set(orderBookKey, {});
            }

            const orderBook = this.orderBooks.get(orderBookKey)!;
            const pricesByOutcome: { [outcomeId: string]: Map<number, number> } = {};

            market.prices
                .filter(p => p.side === 'Against')
                .forEach(price => {
                    if (!pricesByOutcome[price.outcomeId]) {
                        pricesByOutcome[price.outcomeId] = new Map();
                    }
                    const currentLiquidity = pricesByOutcome[price.outcomeId].get(price.price) || 0;
                    pricesByOutcome[price.outcomeId].set(price.price, currentLiquidity + price.liquidity);
                });

            Object.keys(pricesByOutcome).forEach(outcomeId => {
                const levels: PriceLevel[] = [];
                pricesByOutcome[outcomeId].forEach((liquidity, price) => {
                    if (liquidity > 0) {
                        levels.push({ price, liquidity });
                    }
                });
                orderBook[outcomeId] = levels.sort((a, b) => b.price - a.price);
            });
        }
    }

    public update(fixtureId: number, message: any, marketType: string, marketMapping?: MarketMapping): OrderBook {
        const orderBookKey = `${fixtureId}-${marketType}`;

        // Initialize if missing
        if (!this.orderBooks.has(orderBookKey)) {
            const initialOrderBook: OrderBook = {};
            if (marketMapping?.outcomeMappings) {
                Object.keys(marketMapping.outcomeMappings).forEach(outcomeId => {
                    initialOrderBook[outcomeId] = [];
                });
            } else {
                message.prices?.forEach((price: any) => {
                    if (!initialOrderBook[price.outcomeId]) {
                        initialOrderBook[price.outcomeId] = [];
                    }
                });
            }
            this.orderBooks.set(orderBookKey, initialOrderBook);
        }

        const orderBook = this.orderBooks.get(orderBookKey)!;
        const affectedOutcomes = new Set<string>();

        message.prices
            .filter((priceUpdate: any) => priceUpdate.side === 'Against')
            .forEach((priceUpdate: any) => {
                const { outcomeId, price, liquidity } = priceUpdate;

                if (!orderBook[outcomeId]) {
                    orderBook[outcomeId] = [];
                }

                const priceLevels = orderBook[outcomeId];
                const existingLevelIndex = priceLevels.findIndex(level => level.price === price);

                if (existingLevelIndex >= 0) {
                    if (liquidity === 0) {
                        priceLevels.splice(existingLevelIndex, 1);
                    } else {
                        priceLevels[existingLevelIndex].liquidity = liquidity;
                    }
                } else if (liquidity > 0) {
                    priceLevels.push({ price, liquidity });
                }

                affectedOutcomes.add(outcomeId);
            });

        // Sort only affected outcomes
        affectedOutcomes.forEach(outcomeId => {
            if (orderBook[outcomeId]) {
                orderBook[outcomeId].sort((a, b) => b.price - a.price);
            }
        });

        return orderBook;
    }

    public getOrderBook(fixtureId: number, marketType: string): OrderBook | undefined {
        return this.orderBooks.get(`${fixtureId}-${marketType}`);
    }

    public remove(fixtureId: number, marketType: string): void {
        this.orderBooks.delete(`${fixtureId}-${marketType}`);
    }
}
