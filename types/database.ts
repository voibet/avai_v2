export interface League {
  id: number;
  name: string;
  type: string;
  country: string;
  seasons: Record<string, { start: string; end: string; current: boolean }>; // JSONB field
  xg_source?: Record<string, { rounds: Record<string, { url: string }> }>; // JSONB field with structured xg_source data: { season: { rounds: { roundName: { url } } } }
  created_at: string;
  updated_at: string;
  pinnacle_league_id?: number;
  betfair_competition_id?: number;
  veikkaus_league_id?: number;
}

export interface Fixture {
  id: number;
  referee?: string;
  timestamp: number;
  date: string;
  venue_name?: string;
  status_long?: string;
  status_short?: string;
  home_team_id: number;
  home_team_name: string;
  home_country?: string;
  away_team_id: number;
  away_team_name: string;
  away_country?: string;
  xg_home?: number;
  xg_away?: number;
  market_xg_home?: number;
  market_xg_away?: number;
  goals_home?: number;
  goals_away?: number;
  score_halftime_home?: number;
  score_halftime_away?: number;
  score_fulltime_home?: number;
  score_fulltime_away?: number;
  score_extratime_home?: number;
  score_extratime_away?: number;
  score_penalty_home?: number;
  score_penalty_away?: number;
  league_id: number;
  league_name: string;
  league_country?: string;
  season: number;
  round?: string;
  updated_at: string;
  home_pred?: number;
  away_pred?: number;
  avg_goals_league?: number;
  home_advantage?: number;
  elo_home?: number;
  elo_away?: number;
  league_elo?: number;
}

export interface FixtureStats {
  fixture_id: number;
  created_at: string;
  updated_at: string;
  hours_since_last_match_home: number;
  hours_since_last_match_away: number;
  avg_goals_league?: number;
  elo_home?: number;
  elo_away?: number;
  league_elo?: number;
  home_advantage?: number;
  adjusted_rolling_xg_home?: number;
  adjusted_rolling_xga_home?: number;
  adjusted_rolling_xg_away?: number;
  adjusted_rolling_xga_away?: number;
  adjusted_rolling_market_xg_home?: number;
  adjusted_rolling_market_xga_home?: number;
  adjusted_rolling_market_xg_away?: number;
  adjusted_rolling_market_xga_away?: number;
}

export interface Team {
  id: number;
  name: string;
  country?: string;
  venue?: string;
  mappings?: string[]; // JSONB array of alternative team names
  elo?: number | null; // Latest ELO rating from most recent finished fixture
  created_at: string;
  updated_at: string;
}


