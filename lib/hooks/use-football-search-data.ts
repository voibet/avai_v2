import { useMemo } from 'react';
import { useApi } from './use-api';
import { Team, League } from '../../types/database';

export interface SearchData {
  teams: Team[];
  leagues: League[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFootballSearchData(): SearchData {
  const {
    data: teamsData,
    loading: teamsLoading,
    error: teamsError,
    refetch: refetchTeams
  } = useApi<{ success: boolean; teams: Team[] }>('/api/teams');

  const {
    data: leaguesData,
    loading: leaguesLoading,
    error: leaguesError,
    refetch: refetchLeagues
  } = useApi<{ success: boolean; leagues: League[] }>('/api/leagues');

  const teams = useMemo(() => {
    return teamsData?.success ? teamsData.teams : [];
  }, [teamsData]);

  const leagues = useMemo(() => {
    return leaguesData?.success ? leaguesData.leagues : [];
  }, [leaguesData]);

  const loading = teamsLoading || leaguesLoading;
  const error = teamsError || leaguesError;

  const refetch = () => {
    refetchTeams();
    refetchLeagues();
  };

  return {
    teams,
    leagues,
    loading,
    error,
    refetch
  };
}
