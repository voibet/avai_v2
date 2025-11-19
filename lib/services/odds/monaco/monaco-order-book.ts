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
            const pricesByOutcome: { [outcomeId: string]: PriceLevel[] } = {};

            market.prices
                .filter(p => p.side === 'Against')
                .forEach(price => {
                    if (!pricesByOutcome[price.outcomeId]) {
                        pricesByOutcome[price.outcomeId] = [];
                    }
                    pricesByOutcome[price.outcomeId].push({
                        price: price.price,
                        liquidity: price.liquidity
                    });
                });

            Object.keys(pricesByOutcome).forEach(outcomeId => {
                orderBook[outcomeId] = pricesByOutcome[outcomeId].sort((a, b) => b.liquidity - a.liquidity);
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

                priceLevels.sort((a, b) => b.price - a.price);
            });

        return orderBook;
    }

    public getOrderBook(fixtureId: number, marketType: string): OrderBook | undefined {
        return this.orderBooks.get(`${fixtureId}-${marketType}`);
    }
}
