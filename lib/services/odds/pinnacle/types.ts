export interface PinnacleMarket {
    sport_id: number;
    sport_name: string;
    last: number;
    last_call: number;
    events: PinnacleEvent[];
}

export interface PinnacleEvent {
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

export interface PinnaclePeriod {
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

export interface PinnacleSpread {
    hdp: number;
    alt_line_id?: number;
    home: number;
    away: number;
    max: number;
}

export interface PinnacleTotal {
    points: number;
    alt_line_id?: number;
    over: number;
    under: number;
    max: number;
}
