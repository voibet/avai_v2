import { useApi } from './use-api';

// Hook for fetching league standings
export function useLeagueStandings(leagueId: string | null, season?: string | null) {
  const url = leagueId ? `/api/leagues/${leagueId}${season ? `?season=${season}` : ''}` : null;
  return useApi<{
    success: boolean;
    league: {
      id: number;
      name: string;
      type: string;
      country: string;
      seasons: Record<string, any>;
      xg_source: Record<string, any>;
      updated_at: string;
      pinnacle_league_id?: number;
      betfair_competition_id?: number;
      veikkaus_league_id?: number;
      requested_season: string;
      season_used: string;
    };
    standings: {
      league_info: {
        id: number;
        name: string;
        country: string;
        logo: string;
        flag: string;
        season: number;
      };
      standings: Array<{
        rank: number;
        team: {
          id: number;
          name: string;
          logo: string;
        };
        points: number;
        goalsDiff: number;
        group: string;
        form: string;
        status: string;
        description: string;
        all: {
          played: number;
          win: number;
          draw: number;
          lose: number;
          goals: {
            for: number;
            against: number;
          };
        };
        home: {
          played: number;
          win: number;
          draw: number;
          lose: number;
          goals: {
            for: number;
            against: number;
          };
        };
        away: {
          played: number;
          win: number;
          draw: number;
          lose: number;
          goals: {
            for: number;
            against: number;
          };
        };
        update: string;
        xg_stats: {
          name: string;
          all: {
            played: number;
            xg_for: number;
            xg_against: number;
          };
          home: {
            played: number;
            xg_for: number;
            xg_against: number;
          };
          away: {
            played: number;
            xg_for: number;
            xg_against: number;
          };
          expected_points_total: number;
          expected_points_projected: number;
        };
        win_percentage: number;
        description_percentages?: Record<string, number>;
      }>;
      descriptions: Record<string, Array<{
        description: string;
        ranks: number[];
      }>>;
    };
  }>(url);
}

// Hook for fetching fixture lineups
export function useFixtureLineups(fixtureId: string | null) {
  const url = fixtureId ? `/api/fixtures/${fixtureId}/lineups` : null;
  return useApi<{
    home: {
      coach: {
        id: number;
        name: string;
        photo: string;
      } | null;
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
      coach: {
        id: number;
        name: string;
        photo: string;
      } | null;
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
    matchesMissed: number;
  }>>(url);
}


// Hook for fetching fixture stats
export function useFixtureStats(fixtureId: string | null) {
  const url = fixtureId ? `/api/fixtures/${fixtureId}/stats` : null;
  return useApi<{
    stats: {
      updated_at: string;
      hours_since_last_match_home: number;
      hours_since_last_match_away: number;
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
      ai_home_pred: number | null;
      ai_away_pred: number | null;
    } | null;
  }>(url);
}

// Hook for fetching fixture coaches
export function useFixtureCoaches(fixtureId: string | null) {
  const url = fixtureId ? `/api/fixtures/${fixtureId}/coaches` : null;
  return useApi<{
    home: {
      id: number;
      name: string;
      nationality: string;
      photo: string;
      careerStartDate: string;
      team: {
        id: number;
        name: string;
        logo: string;
      };
    } | null;
    away: {
      id: number;
      name: string;
      nationality: string;
      photo: string;
      careerStartDate: string;
      team: {
        id: number;
        name: string;
        logo: string;
      };
    } | null;
  }>(url);
}

// Hook for fetching league teams with ELO ratings
export function useLeagueTeamsElo(leagueId: string | null) {
  const url = leagueId ? `/api/teams?league_id=${leagueId}` : null;
  return useApi<{
    success: boolean;
    teams: Array<{
      id: number;
      name: string;
      country: string;
      venue: string;
      mappings: any;
      elo: number | null;
    }>;
  }>(url);
}

// Hook for fetching player statistics
export function usePlayerStats(playerId: string | null, season: string | null, teamId?: string | null, leagueId?: string | null) {
  const url = playerId && season ? `/api/player-stats?player_id=${playerId}&season=${season}${teamId ? `&team_id=${teamId}` : ''}${leagueId ? `&league_id=${leagueId}` : ''}` : null;
  return useApi<{
    player: {
      id: number;
      name: string;
      firstname: string;
      lastname: string;
      age: number;
      nationality: string;
      height: string;
      weight: string;
      injured: boolean;
      photo: string;
    };
    statistics: any;
  } | null>(url);
}


