import { useApi } from './use-api';
import { useMemo, useState, useCallback } from 'react';
import { League, Fixture } from '../../types/database';

interface RoundInfo {
  round_name: string;
  xg_source?: string | null;
  fixture_count?: number;
}

interface PaginationData {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface FixturesResponse {
  fixtures: Fixture[];
  pagination: PaginationData;
}


// Hook for fetching leagues
export function useLeagues() {
  return useApi<League[]>('/api/leagues');
}


// Hook for fetching fixtures with pagination and filters
export function useFixtures(options: {
  leagueId?: string | null;
  season?: string | null;
  teamId?: string | null;
  status?: string | null;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  // Server-side filtering parameters
  leagueName?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
}) {
  const url = useMemo(() => {
    const { leagueId, season, teamId, status, page = 1, limit = 20, sortBy, sortDirection, leagueName, homeTeamName, awayTeamName } = options;

    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    if (leagueId) params.append('league_id', leagueId);
    if (season) params.append('season', season);
    if (teamId) params.append('team_id', teamId);
    if (status) params.append('status', status);
    if (sortBy) params.append('sort_by', sortBy);
    if (sortDirection) params.append('sort_direction', sortDirection);

    // Server-side filtering parameters
    if (leagueName) params.append('league_name', leagueName);
    if (homeTeamName) params.append('home_team_name', homeTeamName);
    if (awayTeamName) params.append('away_team_name', awayTeamName);

    return `/api/fixtures?${params.toString()}`;
  }, [options.leagueId, options.season, options.teamId, options.status, options.page, options.limit, options.sortBy, options.sortDirection, options.leagueName, options.homeTeamName, options.awayTeamName]);

  return useApi<FixturesResponse>(url);
}


// Hook for fetching seasons for a specific league
export function useSeasons(leagueId: string | null) {
  return useApi<number[]>(
    leagueId ? `/api/leagues/${leagueId}/seasons` : null
  );
}

// Hook for fetching individual league details
export function useLeagueDetails(leagueId: string | null) {
  return useApi<{ league: League; seasons: number[] }>(
    leagueId ? `/api/leagues/${leagueId}` : null
  );
}

// Hook for fetching rounds for a specific league and season
export function useRounds(leagueId: string | null, season: string | null, includeXG: boolean = false) {
  const url = leagueId && season
    ? `/api/admin/leagues/${leagueId}/seasons/${season}/rounds?include_current_xg=${includeXG}`
    : null;

  return useApi<RoundInfo[]>(url);
}

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

// Custom hook for XG source update functionality
export function useXGSourceUpdate() {
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [selectedRounds, setSelectedRounds] = useState<string[]>([]);
  const [xgSource, setXgSource] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { data: leagues, loading: leaguesLoading, error: leaguesError } = useLeagues();
  const { data: availableSeasons, loading: seasonsLoading } = useSeasons(selectedLeagueId);
  const { data: rounds, loading: roundsLoading } = useRounds(selectedLeagueId, selectedSeason, true);

  const handleLeagueChange = useCallback((leagueId: string) => {
    setSelectedLeagueId(leagueId);
    setSelectedSeason('');
    setSelectedRounds([]);
    setMessage('');
    setError('');
  }, []);

  const handleSeasonChange = useCallback((season: string) => {
    setSelectedSeason(season);
    setSelectedRounds([]);
    setMessage('');
    setError('');
  }, []);

  const handleRoundToggle = useCallback((roundName: string) => {
    setSelectedRounds(prev => {
      const newRounds = prev.includes(roundName)
        ? prev.filter(r => r !== roundName)
        : [...prev, roundName];

      // If "ALL" is selected, deselect all other rounds
      if (roundName === "ALL" && newRounds.includes("ALL")) {
        return ["ALL"];
      }
      // If any other round is selected while "ALL" is selected, deselect "ALL"
      if (roundName !== "ALL" && prev.includes("ALL")) {
        return newRounds.filter(r => r !== "ALL");
      }

      return newRounds;
    });
  }, []);

  const handleSelectAllRounds = useCallback(() => {
    if (rounds) {
      setSelectedRounds(rounds.map(r => r.round_name));
    }
  }, [rounds]);

  const handleSelectAllOption = useCallback(() => {
    setSelectedRounds(["ALL"]);
  }, []);

  const handleDeselectAllRounds = useCallback(() => {
    setSelectedRounds([]);
  }, []);

  const updateXGSource = useCallback(async () => {
    if (!selectedLeagueId || !selectedSeason || selectedRounds.length === 0 || !xgSource) {
      throw new Error('Please fill in all fields');
    }

    setLoading(true);
    setMessage('');
    setError('');

    try {
      const response = await fetch('/api/admin/update-xg-source', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leagueId: parseInt(selectedLeagueId),
          season: selectedSeason,
          rounds: selectedRounds,
          xgSource: xgSource,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update xg_source');
      }

      const result = await response.json();
      setMessage(result.message);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update xg_source';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [selectedLeagueId, selectedSeason, selectedRounds, xgSource]);

  const getCurrentXGSource = useCallback((league: League | undefined, season: string, roundName: string): string | null => {
    if (!league?.xg_source) return null;

    const seasonData = league.xg_source[season];
    if (!seasonData?.rounds) return null;

    // First check for specific round
    if (seasonData.rounds[roundName]) {
      return seasonData.rounds[roundName].url;
    }

    // Then check for "ALL" round
    if (seasonData.rounds["ALL"]) {
      return seasonData.rounds["ALL"].url;
    }

    return null;
  }, []);

  const selectedLeague = leagues?.find(l => l.id.toString() === selectedLeagueId);

  return {
    // State
    selectedLeagueId,
    selectedSeason,
    selectedRounds,
    xgSource,
    loading,
    message,
    error,
    selectedLeague,

    // Data
    leagues,
    leaguesLoading,
    leaguesError,
    availableSeasons,
    seasonsLoading,
    rounds,
    roundsLoading,

    // Actions
    setXgSource,
    handleLeagueChange,
    handleSeasonChange,
    handleRoundToggle,
    handleSelectAllRounds,
    handleSelectAllOption,
    handleDeselectAllRounds,
    updateXGSource,
    getCurrentXGSource,

    // Computed
    isFormValid: selectedLeagueId && selectedSeason && selectedRounds.length > 0 && xgSource,
  };
}
