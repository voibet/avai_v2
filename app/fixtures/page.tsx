'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useCallback, useMemo, useEffect, Suspense } from 'react'
import { useFixtureLineups, useTeamInjuries, useFixtureStats, useLeagueStandings, useFixtureCoaches, useLeagueTeamsElo } from '../../lib/hooks/use-football-data'
import { useFootballSearchData } from '../../lib/hooks/use-football-search-data'
import DataTable, { Column } from '../../components/shared/data-table'
import { FixtureExtension } from '../../components/features/fixtures/FixtureExtension'
import { LoadingState } from '../../components/shared/LoadingState'
import { ErrorState } from '../../components/shared/ErrorState'
import { EmptyState } from '../../components/shared/EmptyState'
import FixtureEditModal from '../../components/features/admin/FixtureEditModal'
import PlayerStatsModal from '../../components/features/fixtures/PlayerStatsModal'
import TeamStandingsModal from '../../components/features/fixtures/TeamStandingsModal'
import { FixtureOdds } from '../../components/features/fixtures/FixtureOdds'
import { IN_PAST, CANCELLED, IN_PLAY, IN_FUTURE } from '../../lib/constants'

function FixturesPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [expandedFixtureId, setExpandedFixtureId] = useState<string | null>(null)
  const [editingFixture, setEditingFixture] = useState<any>(null)
  const [lineupsExpanded, setLineupsExpanded] = useState(false)
  const [standingsExpanded, setStandingsExpanded] = useState(false)
  const [standingsSortColumn, setStandingsSortColumn] = useState<string>('rank')
  const [standingsSortDirection, setStandingsSortDirection] = useState<'asc' | 'desc'>('asc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; name: string; teamId?: string; leagueId?: string } | null>(null)
  const [selectedTeamStandings, setSelectedTeamStandings] = useState<{
    team: { id: number; name: string; logo: string };
    descriptionPercentages: { [description: string]: number };
    winPercentage: number | null;
  } | null>(null)

  // Fetch teams and leagues data for search
  const { loading: searchDataLoading } = useFootballSearchData()

  const currentPage = parseInt(searchParams.get('page') || '1')

  // Client-side data state
  const [fixturesData, setFixturesData] = useState<any[]>([])
  const [fixturesLoading, setFixturesLoading] = useState(false)
  const [fixturesError, setFixturesError] = useState<string | null>(null)
  const [totalFixturesCount, setTotalFixturesCount] = useState(0)
  const [totalFixturesPages, setTotalFixturesPages] = useState(1)

  // Initialize search term from URL
  useEffect(() => {
    const searchFromUrl = searchParams.get('search') || ''
    setSearchTerm(searchFromUrl)
  }, [searchParams])

  // Extract all URL parameters for filters and sorting
  const currentFilters = useMemo(() => {
    const filters: Record<string, Set<string>> = {}

    // Standard filter parameters
    const filterParams = ['league_name', 'home_team_name', 'away_team_name', 'status_short', 'season', 'date']
    filterParams.forEach(param => {
      const value = searchParams.get(param)
      if (value) {
        filters[param] = new Set([value])
      }
    })


    return filters
  }, [searchParams])

  // Extract sorting from URL
  const currentSort = useMemo(() => {
    const sortBy = searchParams.get('sort_by')
    const sortDirection = searchParams.get('sort_direction') as 'asc' | 'desc' | null
    
    if (sortBy && sortDirection) {
      return { key: sortBy, direction: sortDirection }
    }
    return null
  }, [searchParams])

  // Only fetch lineups when the lineups section is expanded
  const { data: lineupsData, loading: lineupsLoading, error: lineupsError } = useFixtureLineups(lineupsExpanded ? expandedFixtureId : null)

  // Fetch coaches when lineups are expanded
  const { data: coachesData, loading: coachesLoading, error: coachesError } = useFixtureCoaches(lineupsExpanded ? expandedFixtureId : null)

  // Store current fixture data from expanded row
  const [currentFixtureData, setCurrentFixtureData] = useState<any>(null)
  const homeTeamId = currentFixtureData ? currentFixtureData.home_team_id?.toString() : null
  const awayTeamId = currentFixtureData ? currentFixtureData.away_team_id?.toString() : null

  // Fetch injuries for each team separately
  const { data: homeInjuriesData, loading: homeInjuriesLoading, error: homeInjuriesError } = useTeamInjuries(expandedFixtureId, homeTeamId)
  const { data: awayInjuriesData, loading: awayInjuriesLoading, error: awayInjuriesError } = useTeamInjuries(expandedFixtureId, awayTeamId)

  // Fetch stats for the fixture
  const { data: statsData, loading: statsLoading, error: statsError } = useFixtureStats(expandedFixtureId)

  // Only fetch standings when the standings section is expanded and we have fixture data
  const { data: standingsData, loading: standingsLoading, error: standingsError } = useLeagueStandings(
    standingsExpanded && currentFixtureData ? currentFixtureData.league_id?.toString() : null,
    standingsExpanded && currentFixtureData ? currentFixtureData.season?.toString() : null
  )

  // Fetch team ELO ratings when standings are expanded
  const { data: teamsEloData } = useLeagueTeamsElo(
    standingsExpanded && currentFixtureData ? currentFixtureData.league_id?.toString() : null
  )

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${day}.${month}.${year} ${hours}.${minutes}`;
  }, [])

  const formatInjuryTiming = useCallback((injury: any) => {
    if (injury.type === 'Questionable') {
      return 'UNCERTAIN';
    }

    if (injury.isThisMatch) {
      return 'THIS MATCH';
    }

    const days = injury.daysSinceInjury;
    if (days === 0) {
      return 'DAY OF MATCH';
    } else if (days === 1) {
      return 'WAS 1 DAY BEFORE';
    } else {
      return `WAS ${days} DAYS BEFORE`;
    }
  }, [])

  const getInjuryStatusColor = useCallback((injury: any) => {
    const status = formatInjuryTiming(injury);
    if (status === 'UNCERTAIN') {
      return 'text-orange-400';
    }
    if (status.startsWith('WAS')) {
      return 'text-gray-500';
    }
    return injury.isThisMatch ? 'text-red-400' : 'text-orange-400';
  }, [formatInjuryTiming])

  const getStatusColor = useCallback((statusShort: string) => {
    const status = statusShort?.toLowerCase();
    if (IN_PAST.includes(status)) {
      return 'bg-green-900/50 text-green-400';
    }
    if (CANCELLED.includes(status)) {
      return 'bg-blue-900/50 text-blue-400';
    }
    if (IN_PLAY.includes(status)) {
      return 'bg-red-900/50 text-red-400 animate-pulse';
    }
    if (IN_FUTURE.includes(status)) {
      return 'bg-gray-900 text-gray-600';
    }
    // Default fallback
    return 'bg-gray-900 text-gray-600';
  }, [])

  const getRankDividers = useCallback((descriptions: Record<string, Array<{ description: string; ranks: number[] }>>) => {
    // Flatten all description data
    const allDescriptions: Array<{ description: string; ranks: number[] }> = [];
    Object.values(descriptions).forEach(group => {
      allDescriptions.push(...group);
    });

    // Find where description boundaries are (lines should be between different descriptions)
    const allRanks = new Set<number>();
    allDescriptions.forEach(desc => {
      desc.ranks.forEach(rank => allRanks.add(rank));
    });

    const sortedRanks = Array.from(allRanks).sort((a, b) => a - b);
    const dividers = new Set<number>();

    // For each rank, check if the next rank has a different description
    for (let i = 0; i < sortedRanks.length - 1; i++) {
      const currentRank = sortedRanks[i];
      const nextRank = sortedRanks[i + 1];

      // Find descriptions for current and next ranks
      const currentDesc = allDescriptions.find(desc => desc.ranks.includes(currentRank))?.description;
      const nextDesc = allDescriptions.find(desc => desc.ranks.includes(nextRank))?.description;

      // If descriptions are different, add a divider after current rank
      if (currentDesc && nextDesc && currentDesc !== nextDesc) {
        dividers.add(currentRank);
      }
    }

    return dividers;
  }, [])

  const getRankExplanations = useCallback((descriptions: Record<string, Array<{ description: string; ranks: number[] }>>) => {
    // Flatten all description data
    const allDescriptions: Array<{ description: string; ranks: number[] }> = [];
    Object.values(descriptions).forEach(group => {
      allDescriptions.push(...group);
    });

    const explanations: string[] = [];

    // Group descriptions and collect all ranks for each
    const descMap = new Map<string, number[]>();
    allDescriptions.forEach(desc => {
      const key = desc.description;
      if (!descMap.has(key)) {
        descMap.set(key, []);
      }
      descMap.get(key)!.push(...desc.ranks);
    });

    // Create explanations for each unique description
    descMap.forEach((ranks, description) => {
      const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => a - b);
      if (uniqueRanks.length > 0) {
        explanations.push(`Positions ${uniqueRanks.join(', ')}: ${description}`);
      }
    });

    return explanations;
  }, [])

  const handleEditFixture = useCallback((fixture: any) => {
    setEditingFixture(fixture)
  }, [])

  // Column definitions for fixtures table
  const fixturesColumns = useMemo<Column<any>[]>(() => [
    {
      key: 'home_team_name', // Use database column name for server-side
      header: 'HOME',
      span: 1.75,
      sortType: 'string',
      sortKey: 'home_team_name',
      render: (fixture) => (
        <div className="truncate text-white font-mono">
          {fixture.home_team_name}
        </div>
      )
    },
    {
      key: 'away_team_name', // Use database column name for server-side
      header: 'AWAY',
      span: 1.75,
      sortType: 'string',
      sortKey: 'away_team_name',
      render: (fixture) => (
        <div className="truncate text-white font-mono">
          {fixture.away_team_name}
        </div>
      )
    },
    {
      key: 'league_name', // Use database column name for server-side
      header: 'LEAGUE',
      span: 2,
      sortType: 'string',
      sortKey: 'league_name',
      render: (fixture) => (
        <div className="truncate text-gray-600 text-xs font-mono">
          {fixture.league_name} ({fixture.league_country})
        </div>
      )
    },
    {
      key: 'season',
      header: 'SEASON',
      span: 0.5,
      sortType: 'number',
      sortKey: 'season',
      render: (fixture) => (
        <div className="text-gray-500 text-xs font-mono">
          {fixture.season}
        </div>
      )
    },
    {
      key: 'score',
      header: 'SCORE',
      span: 0.75,
      sortable: false, // Computed column - disable server-side sorting
      filterable: false, // Computed column - disable filtering
      sortType: 'custom',
      customSort: (a, b, direction) => {
        const aHome = a.goals_home || 0;
        const aAway = a.goals_away || 0;
        const bHome = b.goals_home || 0;
        const bAway = b.goals_away || 0;

        // Sort by total goals first, then by goal difference
        const aTotal = aHome + aAway;
        const bTotal = bHome + bAway;
        const aDiff = aHome - aAway;
        const bDiff = bHome - bAway;

        let comparison = aTotal - bTotal;
        if (comparison === 0) {
          comparison = aDiff - bDiff;
        }

        return direction === 'desc' ? -comparison : comparison;
      },
      render: (fixture) => (
        <div className="flex items-center">
          {fixture.goals_home !== null && fixture.goals_away !== null ? (
            <span className="text-gray-400 font-bold font-mono">
              {fixture.goals_home}-{fixture.goals_away}
            </span>
          ) : (
            <span className="text-gray-600 font-mono">-</span>
          )}
        </div>
      )
    },
    {
      key: 'xg',
      header: 'XG',
      span: 0.75,
      sortable: false, // Computed column - disable server-side sorting
      filterable: false, // Computed column - disable filtering
      sortType: 'custom',
      customSort: (a, b, direction) => {
        const aXG = (parseFloat(a.xg_home?.toString() || '0') + parseFloat(a.xg_away?.toString() || '0')) || 0;
        const bXG = (parseFloat(b.xg_home?.toString() || '0') + parseFloat(b.xg_away?.toString() || '0')) || 0;

        const comparison = aXG - bXG;
        return direction === 'desc' ? -comparison : comparison;
      },
      render: (fixture) => (
        <div className="flex items-center">
          {fixture.xg_home !== null && fixture.xg_home !== undefined &&
            fixture.xg_away !== null && fixture.xg_away !== undefined ? (
            <span className="text-gray-300 font-bold font-mono">
              {parseFloat(fixture.xg_home.toString()).toFixed(2)}-{parseFloat(fixture.xg_away.toString()).toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-500 font-mono">-</span>
          )}
        </div>
      )
    },
    {
      key: 'market_xg',
      header: 'MARKET XG',
      span: 0.75,
      sortable: false, // Computed column - disable server-side sorting
      filterable: false, // Computed column - disable filtering
      sortType: 'custom',
      customSort: (a, b, direction) => {
        const aMarketXG = (parseFloat(a.market_xg_home?.toString() || '0') + parseFloat(a.market_xg_away?.toString() || '0')) || 0;
        const bMarketXG = (parseFloat(b.market_xg_home?.toString() || '0') + parseFloat(b.market_xg_away?.toString() || '0')) || 0;

        const comparison = aMarketXG - bMarketXG;
        return direction === 'desc' ? -comparison : comparison;
      },
      render: (fixture) => (
        <div className="flex items-center">
          {fixture.market_xg_home !== null && fixture.market_xg_home !== undefined &&
            fixture.market_xg_away !== null && fixture.market_xg_away !== undefined ? (
            <span className="text-gray-300 font-bold font-mono">
              {parseFloat(fixture.market_xg_home.toString()).toFixed(2)}-{parseFloat(fixture.market_xg_away.toString()).toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-500 font-mono">-</span>
          )}
        </div>
      )
    },
    {
      key: 'status_short', // Use database column name for server-side
      header: 'STATUS',
      span: 0.5,
      sortable: false, // Status - disable sorting
      sortType: 'string',
      sortKey: 'status_short',
      render: (fixture) => (
        <span className={`px-1 py-0.5 text-xs font-mono rounded ${getStatusColor(fixture.status_short)}`}>
          {fixture.status_short || 'SCH'}
        </span>
      )
    },
    {
      key: 'date',
      header: 'TIME',
      span: 1.0,
      filterable: true, // Enable filtering for Time column
      sortType: 'date',
      sortKey: 'date',
      render: (fixture) => (
        <div className="text-gray-400 text-xs font-mono">
          {formatDate(fixture.date)}
        </div>
      )
    },
    {
      key: 'actions',
      header: 'EDIT',
      span: 0.5,
      sortable: false,
      filterable: false, // Actions column - disable filtering
      render: (fixture) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleEditFixture(fixture);
          }}
          className="p-1 text-gray-500 hover:text-blue-400 hover:bg-gray-800 rounded transition-colors"
          title="Edit fixture"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      )
    }
  ], [handleEditFixture, formatDate, getStatusColor])

  const handleCloseEditModal = () => {
    setEditingFixture(null)
  }

  const handleFixtureUpdated = useCallback(() => {
    // Instead of reloading the page (which resets filters), we could trigger a data refresh
    // For now, we'll keep the current approach but this could be improved
    window.location.reload()
  }, [])

  const handlePageChange = useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', page.toString())
    router.push(`/fixtures?${params.toString()}`)
  }, [searchParams, router])

  // Handle filter changes - update URL
  const handleFilterChange = useCallback((columnKey: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())

    if (value) {
      params.set(columnKey, value)
    } else {
      params.delete(columnKey)
    }

    // Reset to page 1 when filters change
    params.set('page', '1')

    router.push(`/fixtures?${params.toString()}`)
  }, [searchParams, router])

  // Handle sorting changes - update URL  
  const handleSortChange = useCallback((sortKey: string, direction: 'asc' | 'desc') => {
    const params = new URLSearchParams(searchParams.toString())
    
    params.set('sort_by', sortKey)
    params.set('sort_direction', direction)
    
    // Reset to page 1 when sorting changes
    params.set('page', '1')
    
    router.push(`/fixtures?${params.toString()}`)
  }, [searchParams, router])

  // Clear all filters
  const handleClearAllFilters = useCallback(() => {
    const params = new URLSearchParams()
    params.set('page', '1')

    // Keep sorting if it exists
    if (currentSort) {
      params.set('sort_by', currentSort.key)
      params.set('sort_direction', currentSort.direction)
    }

    router.push(`/fixtures?${params.toString()}`)
  }, [router, currentSort])

  const getFilterValueApiUrl = useCallback((field: string): string => {
    return `/api/fixtures/filter-values?field=${field}`;
  }, [])

  // Handle search input change
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }, [])

  // Handle search submission (enter key)
  const handleSearchSubmit = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const params = new URLSearchParams(searchParams.toString())

      if (searchTerm.trim()) {
        params.set('search', searchTerm.trim())
      } else {
        params.delete('search')
      }

      // Reset to page 1 when searching
      params.set('page', '1')

      router.push(`/fixtures?${params.toString()}`)
    }
  }, [searchTerm, searchParams, router])

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchTerm('')
    const params = new URLSearchParams(searchParams.toString())

    params.delete('search')
    params.set('page', '1')
    router.push(`/fixtures?${params.toString()}`)
  }, [searchParams, router])

  // Client-side data fetching
  const fetchFixturesData = useCallback(async () => {
    setFixturesLoading(true)
    setFixturesError(null)

    try {
      const queryParams = new URLSearchParams()

      // Add pagination
      queryParams.append('page', currentPage.toString())
      queryParams.append('limit', '50')

      // Add sorting
      if (currentSort) {
        queryParams.append('sortColumn', currentSort.key)
        queryParams.append('sortDirection', currentSort.direction)
      }

      // Add filters
      let filterIndex = 0
      Object.entries(currentFilters).forEach(([columnKey, filterValues]) => {
        if (filterValues.size > 0) {
          const value = Array.from(filterValues)[0]

          // Handle date specially as a direct query parameter
          if (columnKey === 'date') {
            queryParams.append('date', value)
          } else {
            // Standard filter format for other columns
            queryParams.append(`filters[${filterIndex}][column]`, columnKey)
            queryParams.append(`filters[${filterIndex}][value]`, value)
            queryParams.append(`filters[${filterIndex}][operator]`, 'eq')
            filterIndex++
          }
        }
      })

      // Add search parameter from URL (only when explicitly submitted)
      const urlSearchTerm = searchParams.get('search')
      if (urlSearchTerm && urlSearchTerm.trim()) {
        queryParams.append('search', urlSearchTerm.trim())
      }

      const response = await fetch(`/api/fixtures?${queryParams}`)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      setFixturesData(result.data || [])
      setTotalFixturesCount(result.total || 0)
      setTotalFixturesPages(result.totalPages || 1)

    } catch (err) {
      setFixturesError(err instanceof Error ? err.message : 'Failed to fetch fixtures')
      setFixturesData([])
      setTotalFixturesCount(0)
      setTotalFixturesPages(1)
    } finally {
      setFixturesLoading(false)
    }
  }, [currentPage, currentSort, currentFilters, searchParams])

  // Fetch data when dependencies change
  useEffect(() => {
    fetchFixturesData()
  }, [fetchFixturesData])

  const renderLineupsSection = useCallback((fixture: any) => {
    if (lineupsLoading || coachesLoading) {
      return <LoadingState message="Loading lineups..." />;
    }

    if (lineupsError || coachesError) {
      return <ErrorState message={`lineups: ${lineupsError || coachesError}`} />;
    }

    if (!lineupsData) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-gray-600 text-sm font-mono">No lineups available</span>
          </div>
        </div>
      );
    }

    const { home, away } = lineupsData;
    const { home: homeCoach, away: awayCoach } = coachesData || { home: null, away: null };

    return (
      <div className="px-2 py-2">
        {/* Team Headers */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1 text-center">
              <h3 className="text-xs font-bold text-gray-200 font-mono">
                {fixture.home_team_name}
                {home.formation && <span className="text-xs text-gray-400 ml-2">({home.formation})</span>}
              </h3>
            </div>
            <div className="flex-1 text-center">
              <h3 className="text-xs font-bold text-gray-200 font-mono">
                {fixture.away_team_name}
                {away.formation && <span className="text-xs text-gray-400 ml-2">({away.formation})</span>}
              </h3>
            </div>
          </div>

        {/* Coaches Section */}
        <div className="mb-2">
          <h4 className="text-xs font-bold text-gray-400 font-mono mb-1">COACHES</h4>
          <div className="flex gap-2">
            {/* Home Coach */}
            <div className="flex-1">
              {homeCoach ? (
                <div className="flex items-center gap-1.5 p-1.5 bg-gray-800 rounded border border-gray-700">
                  <img
                    src={homeCoach.photo}
                    alt={homeCoach.name}
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-100 font-bold font-mono text-xs truncate">
                      {homeCoach.name}
                    </div>
                    <div className="text-gray-400 text-xs font-mono">
                      Nationality: {homeCoach.nationality}
                      {homeCoach.careerStartDate && (
                        <span className="ml-5">
                          Since: {new Date(homeCoach.careerStartDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-1 text-gray-500 text-xs font-mono">
                  No coach info available
                </div>
              )}
            </div>

            {/* Away Coach */}
            <div className="flex-1">
              {awayCoach ? (
                <div className="flex items-center gap-1.5 p-1.5 bg-gray-800 rounded border border-gray-700">
                  <img
                    src={awayCoach.photo}
                    alt={awayCoach.name}
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-100 font-bold font-mono text-xs truncate">
                      {awayCoach.name}
                    </div>
                    <div className="text-gray-400 text-xs font-mono">
                      Nationality: {awayCoach.nationality}
                      {awayCoach.careerStartDate && (
                        <span className="ml-5">
                          Since: {new Date(awayCoach.careerStartDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-1 text-gray-500 text-xs font-mono">
                  No coach info available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Side by Side Tables */}
        <div className="flex gap-4">
          {/* Home Team Lineup */}
          <div className="flex-1">
            {home.startXI.length > 0 ? (
              <div className="space-y-0.5">
                {/* Header */}
                <div className="grid grid-cols-9 gap-1 py-0.5 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                  <div className="col-span-1 text-gray-400 text-center">#</div>
                  <div className="col-span-4 text-gray-400">PLAYER</div>
                  <div className="col-span-2 text-gray-400 text-center">POS</div>
                  <div className="col-span-2 text-gray-400 text-center">GRID</div>
                </div>

                {/* Players */}
                {home.startXI.map((player) => (
                  <div key={player.id} className="grid grid-cols-9 gap-1 py-0.5 border-b border-gray-600 text-xs font-mono">
                    <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                    <div 
                      className="col-span-4 text-gray-100 font-bold truncate cursor-pointer hover:text-blue-400 transition-colors"
                      onClick={() => setSelectedPlayer({ id: player.id, name: player.name, teamId: fixture.home_team_id?.toString(), leagueId: fixture.league_id?.toString() })}
                    >
                      {player.name}
                    </div>
                    <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                    <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-0 text-gray-500 text-sm font-mono">No starting lineup available</div>
            )}

            {/* Substitutes */}
            {home.substitutes.length > 0 && (
              <div className="mt-2">
                <h4 className="text-xs font-bold text-gray-400 font-mono mb-1">SUBSTITUTES</h4>
                <div className="space-y-0.5">
                  {home.substitutes.map((player) => (
                    <div key={player.id} className="grid grid-cols-9 gap-1 py-0.5 border-b border-gray-700 text-xs font-mono">
                      <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                      <div 
                        className="col-span-4 text-gray-100 font-bold truncate cursor-pointer hover:text-blue-400 transition-colors"
                        onClick={() => setSelectedPlayer({ id: player.id, name: player.name, teamId: fixture.home_team_id?.toString(), leagueId: fixture.league_id?.toString() })}
                      >
                        {player.name}
                      </div>
                      <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                      <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Vertical Divider */}
          <div className="w-px bg-gray-600"></div>

          {/* Away Team Lineup */}
          <div className="flex-1">
            {away.startXI.length > 0 ? (
              <div className="space-y-0.5">
                {/* Header */}
                <div className="grid grid-cols-9 gap-1 py-0.5 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                  <div className="col-span-1 text-gray-400 text-center">#</div>
                  <div className="col-span-4 text-gray-400">PLAYER</div>
                  <div className="col-span-2 text-gray-400 text-center">POS</div>
                  <div className="col-span-2 text-gray-400 text-center">GRID</div>
                </div>

                {/* Players */}
                {away.startXI.map((player) => (
                  <div key={player.id} className="grid grid-cols-9 gap-1 py-0.5 border-b border-gray-600 text-xs font-mono">
                    <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                    <div 
                      className="col-span-4 text-gray-100 font-bold truncate cursor-pointer hover:text-blue-400 transition-colors"
                      onClick={() => setSelectedPlayer({ id: player.id, name: player.name, teamId: fixture.away_team_id?.toString(), leagueId: fixture.league_id?.toString() })}
                    >
                      {player.name}
                    </div>
                    <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                    <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-0 text-gray-500 text-sm font-mono">No starting lineup available</div>
            )}

            {/* Substitutes */}
            {away.substitutes.length > 0 && (
              <div className="mt-2">
                <h4 className="text-xs font-bold text-gray-400 font-mono mb-1">SUBSTITUTES</h4>
                <div className="space-y-0.5">
                  {away.substitutes.map((player) => (
                    <div key={player.id} className="grid grid-cols-9 gap-1 py-0.5 border-b border-gray-700 text-xs font-mono">
                      <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                      <div 
                        className="col-span-4 text-gray-100 font-bold truncate cursor-pointer hover:text-blue-400 transition-colors"
                        onClick={() => setSelectedPlayer({ id: player.id, name: player.name, teamId: fixture.away_team_id?.toString(), leagueId: fixture.league_id?.toString() })}
                      >
                        {player.name}
                      </div>
                      <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                      <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [lineupsLoading, lineupsError, lineupsData, coachesLoading, coachesError, coachesData]);

  const renderInjuriesSection = useCallback((fixture: any) => {
    return (
      <div className="px-2 py-2">
        {/* Team Headers */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1 text-center">
            <h3 className="text-xs font-bold text-gray-200 font-mono">
              {fixture.home_team_name}
            </h3>
          </div>
          <div className="flex-1 text-center">
            <h3 className="text-xs font-bold text-gray-200 font-mono">
              {fixture.away_team_name}
            </h3>
          </div>
        </div>

        {/* Side by Side Tables */}
        <div className="flex gap-4">
          {/* Home Team Injuries */}
          <div className="flex-1">
            <h4 className="text-xs font-bold text-red-400 font-mono mb-1">OUT</h4>
            {homeInjuriesLoading ? (
              <LoadingState message="Loading injuries..." size="sm" className="" />
            ) : homeInjuriesError ? (
              <ErrorState message="injuries" className="" />
            ) : homeInjuriesData && homeInjuriesData.length > 0 ? (() => {
              const filteredInjuries = homeInjuriesData.filter((injury) => {
                // Filter out injuries older than 8 days
                if (injury.daysSinceInjury > 8) return false;
                const status = formatInjuryTiming(injury);
                return !(status.startsWith('WAS') && injury.reason === 'Red Card');
              });

              return filteredInjuries.length > 0 ? (
                <div className="space-y-0.5">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-1 py-0.5 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                    <div className="col-span-3 text-gray-400">PLAYER</div>
                    <div className="col-span-3 text-gray-400 text-center">REASON</div>
                    <div className="col-span-2 text-gray-400 text-center">STATUS</div>
                    <div className="col-span-2 text-gray-400 text-center">SINCE</div>
                    <div className="col-span-2 text-gray-400 text-center">MISSED</div>
                  </div>
                  {filteredInjuries.map((injury) => (
                    <div key={injury.player.id} className="grid grid-cols-12 gap-1 py-0.5 border-b border-gray-600 text-xs font-mono">
                      <div
                        className="col-span-3 text-white font-bold truncate cursor-pointer hover:text-blue-400 transition-colors"
                        onClick={() => setSelectedPlayer({ id: injury.player.id, name: injury.player.name, teamId: fixture.home_team_id?.toString(), leagueId: fixture.league_id?.toString() })}
                      >
                        {injury.player.name}
                      </div>
                      <div className={`col-span-3 text-center font-bold ${getInjuryStatusColor(injury)} truncate`}>
                        {injury.reason}
                      </div>
                      <div className={`col-span-2 text-center font-bold ${getInjuryStatusColor(injury)}`}>
                        {formatInjuryTiming(injury)}
                      </div>
                      <div className="col-span-2 text-center text-gray-400">
                        {injury.injuryDate ? (() => {
                          const date = new Date(injury.injuryDate);
                          const day = date.getDate().toString().padStart(2, '0');
                          const month = (date.getMonth() + 1).toString().padStart(2, '0');
                          const year = date.getFullYear();
                          return `${day}.${month}.${year}`;
                        })() : '-'}
                      </div>
                      <div className="col-span-2 text-center text-white font-bold">
                        {injury.matchesMissed !== undefined ? `${injury.matchesMissed}` : '0'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-1">
                  <span className="text-gray-500 text-xs font-mono">No injuries reported or data not available</span>
                </div>
              );
            })() : (
              <div className="text-center py-1">
                <span className="text-gray-500 text-xs font-mono">No injuries reported or data not available</span>
              </div>
            )}
          </div>

          {/* Vertical Divider */}
          <div className="w-px bg-gray-600"></div>

          {/* Away Team Injuries */}
          <div className="flex-1">
            <h4 className="text-xs font-bold text-red-400 font-mono mb-1">OUT</h4>
            {awayInjuriesLoading ? (
              <LoadingState message="Loading injuries..." size="sm" className="" />
            ) : awayInjuriesError ? (
              <ErrorState message="injuries" className="" />
            ) : awayInjuriesData && awayInjuriesData.length > 0 ? (() => {
              const filteredInjuries = awayInjuriesData.filter((injury) => {
                // Filter out injuries older than 8 days
                if (injury.daysSinceInjury > 8) return false;
                const status = formatInjuryTiming(injury);
                return !(status.startsWith('WAS') && injury.reason === 'Red Card');
              });

              return filteredInjuries.length > 0 ? (
                <div className="space-y-0.5">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-1 py-0.5 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                    <div className="col-span-3 text-gray-400">PLAYER</div>
                    <div className="col-span-3 text-gray-400 text-center">REASON</div>
                    <div className="col-span-2 text-gray-400 text-center">STATUS</div>
                    <div className="col-span-2 text-gray-400 text-center">SINCE</div>
                    <div className="col-span-2 text-gray-400 text-center">MISSED</div>
                  </div>
                  {filteredInjuries.map((injury) => (
                    <div key={injury.player.id} className="grid grid-cols-12 gap-1 py-0.5 border-b border-gray-600 text-xs font-mono">
                      <div
                        className="col-span-3 text-white font-bold truncate cursor-pointer hover:text-blue-400 transition-colors"
                        onClick={() => setSelectedPlayer({ id: injury.player.id, name: injury.player.name, teamId: fixture.away_team_id?.toString(), leagueId: fixture.league_id?.toString() })}
                      >
                        {injury.player.name}
                      </div>
                      <div className={`col-span-3 text-center font-bold ${getInjuryStatusColor(injury)} truncate`}>
                        {injury.reason}
                      </div>
                      <div className={`col-span-2 text-center font-bold ${getInjuryStatusColor(injury)}`}>
                        {formatInjuryTiming(injury)}
                      </div>
                      <div className="col-span-2 text-center text-gray-400">
                        {injury.injuryDate ? (() => {
                          const date = new Date(injury.injuryDate);
                          const day = date.getDate().toString().padStart(2, '0');
                          const month = (date.getMonth() + 1).toString().padStart(2, '0');
                          const year = date.getFullYear();
                          return `${day}.${month}.${year}`;
                        })() : '-'}
                      </div>
                      <div className="col-span-2 text-center text-white font-bold">
                        {injury.matchesMissed !== undefined ? `${injury.matchesMissed}` : '0'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-1">
                  <span className="text-gray-500 text-xs font-mono">No injuries reported or data not available</span>
                </div>
              );
            })() : (
              <div className="text-center py-1">
                <span className="text-gray-500 text-xs font-mono">No injuries reported or data not available</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [homeInjuriesLoading, homeInjuriesError, homeInjuriesData, awayInjuriesLoading, awayInjuriesError, awayInjuriesData, formatInjuryTiming]);

  const renderOddsSection = useCallback((fixture: any) => {
    return <FixtureOdds key={`odds-${fixture.id}`} fixture={fixture} />;
  }, []);

  const renderStatsSection = useCallback((_fixture: any) => {
    if (statsLoading) {
      return <LoadingState message="Loading stats..." />;
    }

    if (statsError) {
      return <ErrorState message={`stats: ${statsError}`} />;
    }

    if (!statsData || !statsData.stats) {
      return <EmptyState message="No stats available" />;
    }

    const stats = statsData.stats;

    // First row stats
    const firstRowStats = [
      {
        id: 'elo_rating',
        label: 'Elo Rating',
        home: stats.elo_home?.toString() || '-',
        away: stats.elo_away?.toString() || '-',
        info: '',
        show: true
      },
      {
        id: 'avg_goals_league',
        label: 'Avg Goals',
        home: '',
        away: '',
        info: stats.avg_goals_league?.toString() || '-',
        show: true
      },
      {
        id: 'adjusted_rolling_xg',
        label: 'Rolling xG',
        home: stats.adjusted_rolling_xg_home?.toString() || '-',
        away: stats.adjusted_rolling_xg_away?.toString() || '-',
        info: '',
        show: true
      },
      {
        id: 'adjusted_rolling_market_xg',
        label: 'Rolling Market xG',
        home: stats.adjusted_rolling_market_xg_home?.toString() || '-',
        away: stats.adjusted_rolling_market_xg_away?.toString() || '-',
        info: '',
        show: true
      },
      {
        id: 'predicted_xg',
        label: 'Predicted xG',
        home: stats.ai_home_pred ? parseFloat(stats.ai_home_pred.toString()).toFixed(2) : '-',
        away: stats.ai_away_pred ? parseFloat(stats.ai_away_pred.toString()).toFixed(2) : '-',
        info: stats.ai_home_pred && stats.ai_away_pred
          ? (parseFloat(stats.ai_home_pred.toString()) + parseFloat(stats.ai_away_pred.toString())).toFixed(2)
          : '-',
        show: true
      }
    ];

    // Second row stats
    const secondRowStats = [
      {
        id: 'league_elo',
        label: 'League Elo',
        home: '',
        away: '',
        info: stats.league_elo?.toString() || '-',
        show: true
      },  
      {
        id: 'home_advantage',
        label: 'Home Advantage',
        home: '',
        away: '',
        info: stats.home_advantage?.toString() || '-',
        show: true
      },
      {
        id: 'adjusted_rolling_xga',
        label: 'Rolling xGa',
        home: stats.adjusted_rolling_xga_home?.toString() || '-',
        away: stats.adjusted_rolling_xga_away?.toString() || '-',
        info: '',
        show: true
      },
      {
        id: 'adjusted_rolling_market_xga',
        label: 'Rolling Market xGa',
        home: stats.adjusted_rolling_market_xga_home?.toString() || '-',
        away: stats.adjusted_rolling_market_xga_away?.toString() || '-',
        info: '',
        show: true
      },
      {
        id: 'hours_since_last_match',
        label: 'Hours Since Last Match',
        home: stats.hours_since_last_match_home?.toString() || '-',
        away: stats.hours_since_last_match_away?.toString() || '-',
        info: '',
        show: true
      }
      
    ];

    return (
      <div className="">
        {/* First Row - Stats Table */}
        <div className="">
          <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
            {/* Headers */}
            {firstRowStats.map((item) => (
              <div key={`header-${item.id}`} className="border-r border-gray-700 px-1 py-0.5 text-gray-300 font-bold text-[12px] bg-gray-900 font-mono truncate">
                {item.label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
            {/* Values */}
            {firstRowStats.map((item) => (
              <div key={`value-${item.id}`} className="border-r border-gray-700 px-1 py-1 text-gray-100 text-[11px] font-mono truncate">
                {item.home && item.away ? `${item.home} - ${item.away}` : (item.home || item.away || item.info || '-')}
              </div>
            ))}
          </div>
        </div>

        {/* Second Row - Stats Table */}
        <div className="">
          <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
            {/* Headers */}
            {secondRowStats.map((item) => (
              <div key={`header-${item.id}`} className="border-r border-gray-700 px-1 py-0.5 text-gray-300 font-bold text-[12px] bg-gray-900 font-mono truncate">
                {item.label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
            {/* Values */}
            {secondRowStats.map((item) => (
              <div key={`value-${item.id}`} className="border-r border-gray-700 px-1 py-1 text-gray-100 text-[11px] font-mono truncate">
                {item.home && item.away ? `${item.home} - ${item.away}` : (item.home || item.away || item.info || '-')}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }, [statsLoading, statsError, statsData]);

  // Handle column header click for sorting
  const handleColumnSort = useCallback((column: string) => {
    if (standingsSortColumn === column) {
      setStandingsSortDirection(standingsSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setStandingsSortColumn(column);
      setStandingsSortDirection('asc');
    }
  }, [standingsSortColumn, standingsSortDirection]);

  const renderStandingsSection = useCallback((fixture: any) => {
    if (standingsLoading) {
      return <LoadingState message="Loading standings..." />;
    }

    if (standingsError) {
      return <ErrorState message={`standings: ${standingsError}`} />;
    }

    if (!standingsData || !standingsData.standings?.standings?.length) {
      return <EmptyState message="No standings available" />;
    }

    const { standings } = standingsData.standings;

    // Create ELO map for quick lookup
    const eloMap = new Map<number, number>();
    if (teamsEloData?.success && teamsEloData.teams) {
      teamsEloData.teams.forEach(team => {
        if (team.elo !== null) {
          eloMap.set(team.id, team.elo);
        }
      });
    }

    // Group standings by group (similar to leagues page logic)
    const groupedStandings = standings.reduce((acc, standing) => {
      const group = standing.group || 'Main Table'
      if (!acc[group]) {
        acc[group] = []
      }
      acc[group].push(standing)
      return acc
    }, {} as Record<string, typeof standings>)

    // Determine which group the current fixture belongs to
    // Find the group that contains both the home and away teams
    let fixtureGroup = null
    const homeTeamId = fixture.home_team_id?.toString()
    const awayTeamId = fixture.away_team_id?.toString()

    for (const [groupName, groupStandings] of Object.entries(groupedStandings)) {
      const hasHomeTeam = groupStandings.some(s => s.team.id?.toString() === homeTeamId)
      const hasAwayTeam = groupStandings.some(s => s.team.id?.toString() === awayTeamId)

      if (hasHomeTeam && hasAwayTeam) {
        fixtureGroup = groupName
        break
      }
    }

    // If teams are in different groups, don't show standings
    if (!fixtureGroup) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-gray-500 text-sm font-mono">Teams are in different groups or playoffs - no standings available</span>
          </div>
        </div>
      );
    }

    // Filter standings to only show the current fixture's group
    let filteredStandings = [...groupedStandings[fixtureGroup]]

    // Sort standings based on current sort settings
    const sortStandings = (standings: typeof filteredStandings, column: string, direction: 'asc' | 'desc') => {
      return [...standings].sort((a, b) => {
        let aValue: any, bValue: any;

        switch (column) {
          case 'rank':
            aValue = a.rank;
            bValue = b.rank;
            break;
          case 'name':
            aValue = a.team.name.toLowerCase();
            bValue = b.team.name.toLowerCase();
            break;
          case 'played':
            aValue = a.all.played;
            bValue = b.all.played;
            break;
          case 'wins':
            aValue = a.all.win;
            bValue = b.all.win;
            break;
          case 'draws':
            aValue = a.all.draw;
            bValue = b.all.draw;
            break;
          case 'losses':
            aValue = a.all.lose;
            bValue = b.all.lose;
            break;
          case 'gf':
            aValue = a.all.goals.for;
            bValue = b.all.goals.for;
            break;
          case 'ga':
            aValue = a.all.goals.against;
            bValue = b.all.goals.against;
            break;
          case 'gd':
            aValue = a.goalsDiff;
            bValue = b.goalsDiff;
            break;
          case 'xg':
            aValue = a.xg_stats.all.xg_for - a.xg_stats.all.xg_against;
            bValue = b.xg_stats.all.xg_for - b.xg_stats.all.xg_against;
            break;
          case 'xpts':
            aValue = a.xg_stats.expected_points_total;
            bValue = b.xg_stats.expected_points_total;
            break;
          case 'points':
            aValue = a.points;
            bValue = b.points;
            break;
          case 'projected':
            aValue = a.xg_stats.expected_points_projected;
            bValue = b.xg_stats.expected_points_projected;
            break;
          case 'win_pct':
            aValue = a.all.played > 0 ? (a.all.win / a.all.played) * 100 : 0;
            bValue = b.all.played > 0 ? (b.all.win / b.all.played) * 100 : 0;
            break;
          case 'elo':
            aValue = eloMap.get(a.team.id) || 0;
            bValue = eloMap.get(b.team.id) || 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    };

    filteredStandings = sortStandings(filteredStandings, standingsSortColumn, standingsSortDirection);

    return (
      <div className="px-2 py-2">
        {/* Standings Table */}
        <div className="px-1 py-1">
          {/* Header */}
          <div className="grid grid-cols-18 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('rank')}
            >
              #
              {standingsSortColumn === 'rank' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-3 text-gray-400 cursor-pointer hover:text-white transition-colors flex items-center gap-1"
              onClick={() => handleColumnSort('name')}
            >
              TEAM
              {standingsSortColumn === 'name' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('played')}
            >
              PL
              {standingsSortColumn === 'played' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('wins')}
            >
              W
              {standingsSortColumn === 'wins' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('draws')}
            >
              D
              {standingsSortColumn === 'draws' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('losses')}
            >
              L
              {standingsSortColumn === 'losses' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div className="col-span-1 text-gray-400 text-center">GF-GA</div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('gd')}
            >
              GD
              {standingsSortColumn === 'gd' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div className="col-span-1 text-gray-400 text-center">FORM</div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('xg')}
            >
              xG
              {standingsSortColumn === 'xg' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('xpts')}
            >
              xPTS
              {standingsSortColumn === 'xpts' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('points')}
            >
              PTS
              {standingsSortColumn === 'points' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div className="col-span-1 text-gray-400 text-center">xPTS-PTS</div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('projected')}
            >
              PROJ
              {standingsSortColumn === 'projected' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('elo')}
            >
              ELO
              {standingsSortColumn === 'elo' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
            <div
              className="col-span-1 text-gray-400 text-center cursor-pointer hover:text-white transition-colors flex items-center justify-center gap-1"
              onClick={() => handleColumnSort('win_pct')}
            >
              WIN%
              {standingsSortColumn === 'win_pct' && (
                <span className="text-xs">
                  {standingsSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
          </div>

          {/* Data Rows */}
          {filteredStandings.map((standing, _index) => {
            const isHomeTeam = fixture.home_team_id?.toString() === standing.team.id?.toString();
            const isAwayTeam = fixture.away_team_id?.toString() === standing.team.id?.toString();
            const isParticipatingTeam = isHomeTeam || isAwayTeam;

            // Check if we need a divider after this standing
            // For filtered standings, we need to recalculate dividers based on the current group's descriptions
            const groupDescriptions = standingsData?.standings?.descriptions?.[fixtureGroup] || [];
            const dividers = groupDescriptions.length > 0 ? getRankDividers({ [fixtureGroup]: groupDescriptions }) : new Set();
            const hasDivider = dividers.has(standing.rank);

            return (
              <div key={standing.team.id}>
                <div
                  className={`grid grid-cols-18 gap-1 py-1 ${hasDivider ? 'border-b-2 border-gray-500' : 'border-b border-gray-800'} text-xs font-mono hover:bg-gray-900 ${
                    isParticipatingTeam ? 'bg-gray-700' : ''
                  }`}
                >
                <div className="col-span-1 text-gray-300 text-center font-bold">
                  {standing.rank}
                </div>
                <div
                  className="col-span-3 text-gray-100 font-bold truncate flex items-center gap-2 cursor-pointer hover:text-blue-400 transition-colors"
                  onClick={() => {
                    if (standing.description_percentages) {
                      setSelectedTeamStandings({
                        team: standing.team,
                        descriptionPercentages: standing.description_percentages,
                        winPercentage: standing.win_percentage || null
                      });
                    }
                  }}
                >
                  {standing.team.logo && (
                    <img
                      src={standing.team.logo}
                      alt={standing.team.name}
                      className="w-4 h-4 object-contain"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  )}
                  {standing.team.name}
                </div>
                <div className="col-span-1 text-gray-400 text-center">{standing.all.played}</div>
                <div className="col-span-1 text-green-400 text-center">{standing.all.win}</div>
                <div className="col-span-1 text-yellow-400 text-center">{standing.all.draw}</div>
                <div className="col-span-1 text-red-400 text-center">{standing.all.lose}</div>
                <div className="col-span-1 text-gray-300 text-center">{standing.all.goals.for}-{standing.all.goals.against}</div>
                <div className={`col-span-1 text-center font-bold ${
                  standing.goalsDiff > 0 ? 'text-green-400' :
                  standing.goalsDiff < 0 ? 'text-red-400' :
                  'text-gray-400'
                }`}>
                  {standing.goalsDiff > 0 ? '+' : ''}{standing.goalsDiff}
                </div>
                <div className="col-span-1 flex gap-0.5 justify-center">
                  {standing.form.split('').map((result, index) => (
                    <span
                      key={index}
                      className={`w-3 h-3 rounded-full text-xs font-bold flex items-center justify-center ${
                        result === 'W' ? 'bg-green-600 text-white' :
                        result === 'D' ? 'bg-yellow-600 text-white' :
                        result === 'L' ? 'bg-red-600 text-white' :
                        'bg-gray-600 text-white'
                      }`}
                    >
                      {result}
                    </span>
                  ))}
                </div>
                <div className="col-span-1 text-gray-300 text-center text-xs">
                  {standing.xg_stats.all.xg_for.toFixed(1)}-{standing.xg_stats.all.xg_against.toFixed(1)}
                </div>
                <div className="col-span-1 text-blue-400 text-center text-xs">
                  {standing.xg_stats.expected_points_total.toFixed(1)}
                </div>
                <div className="col-span-1 text-gray-200 text-center font-bold">{standing.points}</div>
                <div className={`col-span-1 text-center text-xs font-bold ${
                  (standing.xg_stats.expected_points_total - standing.points) > 0 ? 'text-green-400' :
                  (standing.xg_stats.expected_points_total - standing.points) < 0 ? 'text-red-400' :
                  'text-gray-400'
                }`}>
                  {(standing.xg_stats.expected_points_total - standing.points).toFixed(1)}
                </div>
                <div className="col-span-1 text-orange-400 text-center text-xs">
                  {standing.xg_stats.expected_points_projected.toFixed(1)}
                </div>
                <div className="col-span-1 text-cyan-400 text-center text-xs">
                  {eloMap.get(standing.team.id) ? eloMap.get(standing.team.id)?.toFixed(1) : '-'}
                </div>
                <div className="col-span-1 text-purple-400 text-center text-xs">
                  {standing.win_percentage?.toFixed(1)}%
                </div>
                </div>
            </div>
            );
          })}
        </div>

        {/* Rank Explanations */}
        {standingsData?.standings?.descriptions?.[fixtureGroup] && getRankExplanations({ [fixtureGroup]: standingsData.standings.descriptions[fixtureGroup] }).length > 0 && (
          <div className="px-1 mb-1">
            <div className="text-[11px] text-gray-400 font-mono flex flex-wrap gap-4">
              {getRankExplanations({ [fixtureGroup]: standingsData.standings.descriptions[fixtureGroup] }).map((explanation, index) => (
                <div key={index} className="text-gray-400">
                  {explanation}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }, [standingsLoading, standingsError, standingsData, getRankDividers, getRankExplanations, standingsSortColumn, standingsSortDirection, handleColumnSort]);

  const renderExpandedContent = useCallback((fixture: any) => {
    return (
      <div className="space-y-0">
        {/* INFO Section */}
        <FixtureExtension fixture={fixture} />

        {/* STATS Section */}
        <div className="">
          {renderStatsSection(fixture)}
        </div>

        {/* ODDS Section */}
        <div>
          <div className="px-1">
            {renderOddsSection(fixture)}
          </div>
        </div>

        {/* STANDINGS Section */}
        <div>
          <button
            onClick={() => setStandingsExpanded(!standingsExpanded)}
            className="flex items-center gap-2 text-xs font-bold text-gray-200 font-mono mb-2 hover:text-white transition-colors w-full"
          >
            <svg
              className={`w-4 h-4 transition-transform ${standingsExpanded ? '' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            STANDINGS
          </button>
          {standingsExpanded && (
            <div className="px-0 py-0">
              {renderStandingsSection(fixture)}
            </div>
          )}
        </div>

        {/* LINEUP Section */}
        <div>
          <button
            onClick={() => setLineupsExpanded(!lineupsExpanded)}
            className="flex items-center gap-1 text-xs font-bold text-gray-200 font-mono hover:text-white transition-colors w-full"
          >
            <svg
              className={`w-4 h-4 transition-transform ${lineupsExpanded ? '' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            LINEUPS
          </button>
          {lineupsExpanded && (
            <div className="px-0 py-0">
              {renderLineupsSection(fixture)}
            </div>
          )}
        </div>

        {/* INJURIES Section */}
        <div>
          <div className="px-0">
            {renderInjuriesSection(fixture)}
          </div>
        </div>
      </div>
    );
  }, [renderLineupsSection, renderStandingsSection, renderInjuriesSection, renderOddsSection, renderStatsSection]);

  return (
    <div className="fixed inset-0 top-[57px] left-0 right-0 bottom-0 bg-black overflow-auto">
      <div className="w-full px-4">
        {/* Search Bar */}
        <div className="py-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search teams or leagues..."
                value={searchTerm}
                onChange={handleSearchChange}
                onKeyDown={handleSearchSubmit}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                disabled={searchDataLoading}
              />
              {searchTerm && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                  title="Clear search"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>
            {searchDataLoading && (
              <div className="text-xs text-gray-400 font-mono">
                Loading search data...
              </div>
            )}
          </div>
        </div>

        <DataTable
        title="FIXTURES"
        data={fixturesData}
        columns={fixturesColumns}
        getItemId={(fixture) => fixture.id || `${fixture.home_team_name}-${fixture.away_team_name}-${fixture.date}`}
        emptyMessage=""
        filterable={true}
        currentFilters={currentFilters}
        currentSort={currentSort}
        onFilterChange={handleFilterChange}
        onSortChange={handleSortChange}
        onClearAllFilters={handleClearAllFilters}
        filterValueApi={getFilterValueApiUrl}
        expandable={true}
        singleExpansion={true}
        renderExpandedContent={renderExpandedContent}
        getExpandedRowClassName={() => 'bg-gray-850'}
        onRowExpand={useCallback((fixtureId: string | number, isExpanded: boolean, item?: any) => {
          if (isExpanded) {
            setExpandedFixtureId(fixtureId.toString());
            setCurrentFixtureData(item); // Store the fixture data for lineups/injuries
            setLineupsExpanded(false); // Reset lineups section when switching fixtures
            setStandingsExpanded(false); // Reset standings section when switching fixtures
            setStandingsSortColumn('rank'); // Reset sort to default
            setStandingsSortDirection('asc');
          } else {
            setExpandedFixtureId(null);
            setCurrentFixtureData(null);
            setLineupsExpanded(false); // Reset lineups section when row is collapsed
            setStandingsExpanded(false); // Reset standings section when row is collapsed
            setStandingsSortColumn('rank'); // Reset sort to default
            setStandingsSortDirection('asc');
          }
        }, [])}
        />

        {/* Edit Modal */}
        {editingFixture && (
          <FixtureEditModal
            fixture={editingFixture}
            onClose={handleCloseEditModal}
            onUpdate={handleFixtureUpdated}
            onDelete={() => {
              // Close modal and refresh data when fixture is deleted
              setEditingFixture(null)
              handleFixtureUpdated()
            }}
          />
        )}

        {/* Player Stats Modal */}
        {selectedPlayer && (
          <PlayerStatsModal
            playerId={selectedPlayer.id}
            playerName={selectedPlayer.name}
            season={currentFixtureData?.season?.toString() || null}
            teamId={selectedPlayer.teamId}
            leagueId={selectedPlayer.leagueId}
            onClose={() => setSelectedPlayer(null)}
          />
        )}

        {/* Manual Pagination Controls */}
        {totalFixturesPages > 1 && (
          <div className="flex items-center justify-between py-2 border-gray-600">
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1 || fixturesLoading}
                className="px-3 py-1 text-xs font-mono bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded transition-colors"
              >
                ← Previous
              </button>

              <span className="text-xs font-mono text-gray-400">
                Page {currentPage} of {totalFixturesPages} ({totalFixturesCount} total)
              </span>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalFixturesPages || fixturesLoading}
                className="px-3 py-1 text-xs font-mono bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded transition-colors"
              >
                Next →
              </button>
            </div>

            <div className="flex items-center gap-1">
              {/* Page number buttons */}
              {(() => {
                const pages = []
                const maxVisiblePages = 5
                let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2))
                let endPage = Math.min(totalFixturesPages, startPage + maxVisiblePages - 1)

                // Adjust start page if we're near the end
                if (endPage - startPage + 1 < maxVisiblePages) {
                  startPage = Math.max(1, endPage - maxVisiblePages + 1)
                }

                for (let i = startPage; i <= endPage; i++) {
                  pages.push(
                    <button
                      key={i}
                      onClick={() => handlePageChange(i)}
                      disabled={fixturesLoading}
                      className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                        i === currentPage
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:bg-gray-800 disabled:text-gray-500'
                      }`}
                    >
                      {i}
                    </button>
                  )
                }
                return pages
              })()}
            </div>
          </div>
        )}

        {/* Loading/Error States */}
        {fixturesLoading && (
          <div className="py-4 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-400 text-sm font-mono">Loading fixtures...</span>
          </div>
        )}

        {fixturesError && (
          <div className="py-4 border-b border-gray-600">
            <ErrorState message={`fixtures: ${fixturesError}`} className="" />
          </div>
        )}

        {/* Team Standings Modal */}
        {selectedTeamStandings && (
          <TeamStandingsModal
            team={selectedTeamStandings.team}
            descriptionPercentages={selectedTeamStandings.descriptionPercentages}
            winPercentage={selectedTeamStandings.winPercentage}
            onClose={() => setSelectedTeamStandings(null)}
          />
        )}
      </div>
    </div>
  )
}

export default function FixturesPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 top-[57px] left-0 right-0 bottom-0 bg-black overflow-auto">
        <div className="w-full px-4">
          <div className="py-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-400 text-sm font-mono">Loading fixtures...</span>
          </div>
        </div>
      </div>
    }>
      <FixturesPageContent />
    </Suspense>
  )
}
