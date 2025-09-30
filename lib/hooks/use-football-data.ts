import { useApi } from './use-api';


// Hook for fetching fixture lineups
export function useFixtureLineups(fixtureId: string | null) {
  const url = fixtureId ? `/api/fixtures/${fixtureId}/lineups` : null;
  return useApi<{
    home: {
      formation: string | null;
      startXI: Array<{
        id: number;
        name: string;
        number: number;
        position: string;
        grid: string;
      }>;
      substitutes: Array<{
        id: number;
        name: string;
        number: number;
        position: string;
        grid: string;
      }>;
    };
    away: {
      formation: string | null;
      startXI: Array<{
        id: number;
        name: string;
        number: number;
        position: string;
        grid: string;
      }>;
      substitutes: Array<{
        id: number;
        name: string;
        number: number;
        position: string;
        grid: string;
      }>;
    };
  }>(url);
}

// Hook for fetching team-specific injuries
export function useTeamInjuries(fixtureId: string | null, teamId: string | null) {
  const url = fixtureId && teamId ? `/api/fixtures/${fixtureId}/injuries?team_id=${teamId}` : null;
  return useApi<Array<{
    player: {
      id: number;
      name: string;
      photo: string;
    };
    position: string;
    type: string;
    reason: string;
    fixture: {
      id: number;
      date: string;
      timestamp: number;
    };
    isThisMatch: boolean;
    daysSinceInjury: number;
    injuryDate: string;
  }>>(url);
}

// Hook for fetching fixture odds
export function useFixtureOdds(fixtureId: string | null) {
  const url = fixtureId ? `/api/fixtures/${fixtureId}/odds` : null;
  return useApi<{
    odds: Array<{
      fixture_id: number;
      bookie_id: number;
      bookie: string;
      odds_x12: Array<{ t: number; x12: number[] }>;
      odds_ah: Array<{ t: number; ah_h: number[]; ah_a: number[] }>;
      odds_ou: Array<{ t: number; ou_o: number[]; ou_u: number[] }>;
      lines: Array<{ t: number; ah: number[]; ou: number[] }>;
      ids: Array<{ t: number; line_id: number; line_ids: { x12: string; ah: string[]; ou: string[] } }>;
      max_stakes: Array<{ t: number; max_stake_x12: number[]; max_stake_ah: { h: number[]; a: number[] }; max_stake_ou: { o: number[]; u: number[] } }>;
      latest_t: { x12_ts: number; ah_ts: number; ou_ts: number; ids_ts: number; stakes_ts: number; lines_ts: number };
      decimals: number;
      created_at: string;
      updated_at: string;
      // Fair odds data (for PINNACLE_FAIR_ODDS bookmaker)
      fair_odds_x12?: any;
      fair_odds_ah?: any;
      fair_odds_ou?: any;
      latest_lines?: any;
      // Payout data (bookmaker margin percentages)
      payout_x12?: number;
      payout_ah?: number[];  // Array of payout values, one per handicap line
      payout_ou?: number[];  // Array of payout values, one per total line
    }>;
  }>(url);
}

// Hook for fetching fixture stats
export function useFixtureStats(fixtureId: string | null) {
  const url = fixtureId ? `/api/fixtures/${fixtureId}/stats` : null;
  return useApi<{
    stats: {
      updated_at: string;
      hours_since_last_match_home: number | null;
      hours_since_last_match_away: number | null;
      avg_goals_league: number | null;
      elo_home: number | null;
      elo_away: number | null;
      league_elo: number | null;
      home_advantage: number | null;
      adjusted_rolling_xg_home: number | null;
      adjusted_rolling_xga_home: number | null;
      adjusted_rolling_xg_away: number | null;
      adjusted_rolling_xga_away: number | null;
      adjusted_rolling_market_xg_home: number | null;
      adjusted_rolling_market_xga_home: number | null;
      adjusted_rolling_market_xg_away: number | null;
      adjusted_rolling_market_xga_away: number | null;
      home_market_xg: number | null;
      away_market_xg: number | null;
      home_predicted_xg: number | null;
      away_predicted_xg: number | null;
      total_predicted_xg: number | null;
      home_predicted_market_xg: number | null;
      away_predicted_market_xg: number | null;
      total_predicted_market_xg: number | null;
    } | null;
  }>(url);
}


