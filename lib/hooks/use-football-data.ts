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
    }>;
  }>(url);
}

