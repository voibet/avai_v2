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

