export interface League {
  id: number;
  name: string;
  type: string;
  country: string;
  seasons: any; // JSONB field
  xg_source?: Record<string, { rounds: Record<string, { url: string }> }>; // JSONB field with structured xg_source data: { season: { rounds: { roundName: { url } } } }
  created_at: string;
  updated_at: string;
  pinnacle_league_id?: number;
  betfair_competition_id?: number;
  veikkaus_league_id?: number;
}

export interface Team {
  id: number;
  name: string;
  country: string;
  venue?: string;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}



