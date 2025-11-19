export interface MonacoMarket {
    id: string;
    eventId: string;
    marketTypeId: string;
    name: string;
    marketOutcomes: Array<{ id: string; title: string; ordering: number; }>;
    prices?: Array<{ side: string; outcomeId: string; price: number; liquidity: number; }>;
}

export interface MarketMapping {
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

export interface PriceLevel {
    price: number;
    liquidity: number;
}

export interface OrderBook {
    [outcomeId: string]: PriceLevel[];
}

export interface MonacoSession {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
}
