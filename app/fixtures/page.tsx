'use client'

import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useFixtures, useFixtureLineups, useTeamInjuries } from '../../lib/hooks/use-football-data'
import LoadingSpinner from '../../components/ui/loading-spinner'
import ErrorMessage from '../../components/ui/error-message'
import DataTable, { Column } from '../../components/ui/data-table'
import FixtureEditModal from '../../components/admin/FixtureEditModal'


export default function FixturesPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [expandedFixtureId, setExpandedFixtureId] = useState<string | null>(null)
  const [editingFixture, setEditingFixture] = useState<any>(null)

  const currentPage = parseInt(searchParams.get('page') || '1')
  const sortBy = searchParams.get('sort_by') || 'date'
  const sortDirection = (searchParams.get('sort_direction') || 'desc') as 'asc' | 'desc'

  // Extract filter parameters from URL (support both old and new parameter names)
  const leagueNameFilterRaw = searchParams.get('league_name') || searchParams.get('league')
  const homeTeamFilter = searchParams.get('home_team_name') || searchParams.get('home_team')
  const awayTeamFilter = searchParams.get('away_team_name') || searchParams.get('away_team')
  const statusFilter = searchParams.get('status_short') || searchParams.get('status')
  const seasonFilter = searchParams.get('season')

  // Parse league name filter to extract just the league name (remove country part if present)
  const leagueNameFilter = leagueNameFilterRaw ? leagueNameFilterRaw.replace(/\s*\([^)]*\)$/, '') : null

  // Memoize the options to prevent unnecessary re-renders
  const fixturesOptions = useMemo(() => ({
    page: currentPage,
    limit: 50,
    sortBy,
    sortDirection,
    leagueName: leagueNameFilter,
    homeTeamName: homeTeamFilter,
    awayTeamName: awayTeamFilter,
    status: statusFilter,
    season: seasonFilter
  }), [currentPage, sortBy, sortDirection, leagueNameFilter, homeTeamFilter, awayTeamFilter, statusFilter, seasonFilter])

  const { data, loading, error } = useFixtures(fixturesOptions)
  const { data: lineupsData, loading: lineupsLoading, error: lineupsError } = useFixtureLineups(expandedFixtureId)

  // Get current fixture data to extract team IDs
  const currentFixture = expandedFixtureId && data?.fixtures.find((f: any) => f.id.toString() === expandedFixtureId)
  const homeTeamId = currentFixture ? currentFixture.home_team_id?.toString() : null
  const awayTeamId = currentFixture ? currentFixture.away_team_id?.toString() : null

  // Fetch injuries for each team separately
  const { data: homeInjuriesData, loading: homeInjuriesLoading, error: homeInjuriesError } = useTeamInjuries(expandedFixtureId, homeTeamId)
  const { data: awayInjuriesData, loading: awayInjuriesLoading, error: awayInjuriesError } = useTeamInjuries(expandedFixtureId, awayTeamId)

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${day}.${month}.${year} ${hours}.${minutes}`;
  }

  const formatInjuryTiming = (injury: any) => {
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
  }

  // Column definitions for fixtures table
  const fixturesColumns: Column<any>[] = [
    {
      key: 'home',
      header: 'HOME',
      span: 2,
      sortType: 'string',
      sortKey: 'home_team_name',
      render: (fixture) => (
        <div className="truncate text-white font-bold">
          {fixture.home_team_name}
        </div>
      )
    },
    {
      key: 'away',
      header: 'AWAY',
      span: 2,
      sortType: 'string',
      sortKey: 'away_team_name',
      render: (fixture) => (
        <div className="truncate text-white">
          {fixture.away_team_name}
        </div>
      )
    },
    {
      key: 'league',
      header: 'LEAGUE',
      span: 2,
      sortType: 'string',
      sortKey: 'league_name',
      render: (fixture) => (
        <div className="truncate text-gray-500 text-xs">
          {fixture.league_name}
        </div>
      )
    },
    {
      key: 'season',
      header: 'SEASON',
      span: 1,
      sortType: 'number',
      sortKey: 'season',
      render: (fixture) => (
        <div className="text-gray-400 text-xs">
          {fixture.season}
        </div>
      )
    },
    {
      key: 'score',
      header: 'SCORE',
      span: 1,
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
            <span className="text-gray-300 font-bold">
              {fixture.goals_home}-{fixture.goals_away}
            </span>
          ) : (
            <span className="text-gray-500">-</span>
          )}
        </div>
      )
    },
    {
      key: 'xg',
      header: 'XG',
      span: 1,
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
            <span className="text-gray-300 font-bold">
              {parseFloat(fixture.xg_home.toString()).toFixed(2)}-{parseFloat(fixture.xg_away.toString()).toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-500">-</span>
          )}
        </div>
      )
    },
    {
      key: 'status',
      header: 'STATUS',
      span: 1,
      sortType: 'string',
      sortKey: 'status_short',
      render: (fixture) => (
        <span className={`px-1 py-0.5 text-xs font-mono rounded ${
          fixture.status_short === 'FT' ? 'bg-green-900/50 text-green-400' :
          fixture.status_short === 'LIVE' ? 'bg-red-900/50 text-red-400' :
          fixture.status_short === 'HT' ? 'bg-blue-900/50 text-blue-400' :
          'bg-gray-800 text-gray-500'
        }`}>
          {fixture.status_short || 'SCH'}
        </span>
      )
    },
    {
      key: 'date',
      header: 'TIME',
      span: 2,
      sortType: 'date',
      sortKey: 'date',
      render: (fixture) => (
        <div className="text-gray-400 text-xs">
          {formatDate(fixture.date)}
        </div>
      )
    },
    {
      key: 'actions',
      header: 'EDIT',
      span: 1,
      sortable: false,
      render: (fixture) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleEditFixture(fixture);
          }}
          className="p-1 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
          title="Edit fixture"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      )
    }
  ]

  const handleEditFixture = (fixture: any) => {
    setEditingFixture(fixture)
  }

  const handleCloseEditModal = () => {
    setEditingFixture(null)
  }

  const handleFixtureUpdated = () => {
    // Refresh the fixtures data after update
    window.location.reload()
  }

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', page.toString())
    router.push(`/fixtures?${params.toString()}`)
  }

  const handleSort = (sortKey: string, direction: 'asc' | 'desc') => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort_by', sortKey)
    params.set('sort_direction', direction)
    params.set('page', '1') // Reset to first page when sorting changes
    router.push(`/fixtures?${params.toString()}`)
  }

  // Map column keys to URL parameter names
  const columnKeyToParamMap: Record<string, string> = {
    'league': 'league_name',
    'home': 'home_team_name',
    'away': 'away_team_name',
    'status': 'status_short',
    'season': 'season'
  }

  // Create initial filters from URL parameters
  const initialFilters = useMemo(() => {
    const filters: Record<string, Set<string>> = {}
    Object.entries(columnKeyToParamMap).forEach(([columnKey, paramName]) => {
      const paramValue = searchParams.get(paramName) || searchParams.get(columnKey)
      if (paramValue) {
        filters[columnKey] = new Set([paramValue])
      }
    })
    return filters
  }, [searchParams, columnKeyToParamMap])

  const handleFilter = (filters: Record<string, Set<string>>) => {
    const params = new URLSearchParams(searchParams.toString())

    // Remove existing filter parameters
    params.delete('league_name')
    params.delete('league') // Also remove old parameter names for backward compatibility
    params.delete('home_team_name')
    params.delete('home_team')
    params.delete('away_team_name')
    params.delete('away_team')
    params.delete('status_short')
    params.delete('status')
    params.delete('season')

    // Add new filter parameters
    Object.entries(filters).forEach(([columnKey, filterValues]) => {
      if (filterValues.size > 0) {
        // For now, we'll only support single value filters (the first value)
        // In a more advanced implementation, you could support multiple values
        let filterValue = Array.from(filterValues)[0]

        // Special handling for league filter - store the full "League (Country)" format in URL
        // but the parsing will happen when reading from URL
        if (columnKey === 'league') {
          // Keep the full format with country for URL state
          params.set('league_name', filterValue)
        } else {
          const paramName = columnKeyToParamMap[columnKey] || columnKey
          params.set(paramName, filterValue)
        }
      }
    })

    params.set('page', '1') // Reset to first page when filtering changes
    router.push(`/fixtures?${params.toString()}`)
  }

  const getFilterValueApiUrl = (field: string): string => {
    return `/api/fixtures/filter-values?field=${field}`;
  }

  if (loading) {
    return <LoadingSpinner message="Loading fixtures..." />
  }

  if (error) {
    return <ErrorMessage message={`Error loading fixtures: ${error}`} className="text-center py-8" />
  }

  const { fixtures, pagination } = data || { fixtures: [], pagination: { currentPage: 1, totalPages: 1, totalCount: 0, limit: 100, hasNext: false, hasPrev: false } }

  // Extended fixture info columns for DataTable
  const extendedFixtureColumns: Column<any>[] = [
    {
      key: 'detail',
      header: 'DETAIL',
      span: 4,
      render: (item) => (
        <div className="text-gray-300 font-bold">
          {item.label}
        </div>
      )
    },
    {
      key: 'home',
      header: 'HOME',
      span: 3,
      render: (item) => (
        <div className="text-gray-100 text-center">
          {item.home ?? '-'}
        </div>
      )
    },
    {
      key: 'away',
      header: 'AWAY',
      span: 3,
      render: (item) => (
        <div className="text-gray-100 text-center">
          {item.away ?? '-'}
        </div>
      )
    },
    {
      key: 'info',
      header: 'INFO',
      span: 3,
      render: (item) => (
        <div className="text-gray-100">
          {item.info ?? '-'}
        </div>
      )
    }
  ];

  // Lineup columns for DataTable
  const lineupColumns: Column<any>[] = [
    {
      key: 'number',
      header: '#',
      span: 1,
      render: (player) => (
        <div className="text-gray-300 text-center font-mono">
          {player.number}
        </div>
      )
    },
    {
      key: 'name',
      header: 'PLAYER',
      span: 4,
      render: (player) => (
        <div className="text-gray-100 font-bold truncate">
          {player.name}
        </div>
      )
    },
    {
      key: 'position',
      header: 'POS',
      span: 2,
      render: (player) => (
        <div className="text-gray-400 text-center text-xs font-mono">
          {player.position}
        </div>
      )
    },
    {
      key: 'grid',
      header: 'GRID',
      span: 2,
      render: (player) => (
        <div className="text-gray-500 text-center text-xs font-mono">
          {player.grid}
        </div>
      )
    }
  ];

  const renderLineupsSection = (fixture: any) => {
    if (lineupsLoading) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-400 text-sm font-mono">Loading lineups...</span>
          </div>
        </div>
      );
    }

    if (lineupsError) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-red-400 text-sm font-mono">Failed to load lineups: {lineupsError}</span>
          </div>
        </div>
      );
    }

    if (!lineupsData) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-gray-500 text-sm font-mono">No lineups available</span>
          </div>
        </div>
      );
    }

    const { home, away } = lineupsData;

    return (
      <div className="px-2 py-4">
        {/* Team Headers */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 text-center">
            <h3 className="text-lg font-bold text-gray-200 font-mono">
              {fixture.home_team_name}
              {home.formation && <span className="text-sm text-gray-400 ml-2">({home.formation})</span>}
            </h3>
          </div>
          <div className="mx-4">
            <span className="text-sm text-gray-500 font-mono">STARTING XI</span>
          </div>
          <div className="flex-1 text-center">
            <h3 className="text-lg font-bold text-gray-200 font-mono">
              {fixture.away_team_name}
              {away.formation && <span className="text-sm text-gray-400 ml-2">({away.formation})</span>}
            </h3>
          </div>
        </div>

        {/* Side by Side Tables */}
        <div className="flex gap-4">
          {/* Home Team Lineup */}
          <div className="flex-1">
            {home.startXI.length > 0 ? (
              <div className="space-y-1">
                {/* Header */}
                <div className="grid grid-cols-9 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                  <div className="col-span-1 text-gray-400 text-center">#</div>
                  <div className="col-span-4 text-gray-400">PLAYER</div>
                  <div className="col-span-2 text-gray-400 text-center">POS</div>
                  <div className="col-span-2 text-gray-400 text-center">GRID</div>
                </div>

                {/* Players */}
                {home.startXI.map((player, index) => (
                  <div key={player.id} className="grid grid-cols-9 gap-1 py-1 border-b border-gray-600 text-xs font-mono">
                    <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                    <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
                    <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                    <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm font-mono">No starting lineup available</div>
            )}

            {/* Substitutes */}
            {home.substitutes.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-gray-400 font-mono mb-2">SUBSTITUTES</h4>
                <div className="space-y-1">
                  {home.substitutes.map((player) => (
                    <div key={player.id} className="grid grid-cols-9 gap-1 py-1 border-b border-gray-700 text-xs font-mono">
                      <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                      <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
                      <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                      <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Injuries */}
            <div className="mt-2">
              <h4 className="text-sm font-bold text-red-400 font-mono mb-2">OUT</h4>
              {homeInjuriesLoading ? (
                <div className="text-center py-1">
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-400"></div>
                  <span className="ml-2 text-gray-400 text-xs font-mono">Loading injuries...</span>
                </div>
              ) : homeInjuriesError ? (
                <div className="text-center py-1">
                  <span className="text-red-400 text-xs font-mono">Failed to load injuries</span>
                </div>
              ) : homeInjuriesData && homeInjuriesData.length > 0 ? (
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-10 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                    <div className="col-span-4 text-gray-400">PLAYER</div>
                    <div className="col-span-3 text-gray-400 text-center">STATUS</div>
                    <div className="col-span-3 text-gray-400 text-center">REASON</div>
                  </div>
                  {homeInjuriesData.map((injury) => (
                    <div key={injury.player.id} className="grid grid-cols-10 gap-1 py-1 border-b border-gray-600 text-xs font-mono">
                      <div className="col-span-4 text-white font-bold truncate">{injury.player.name}</div>
                      <div className={`col-span-3 text-center font-bold ${injury.isThisMatch ? 'text-red-400' : 'text-orange-400'}`}>
                        {formatInjuryTiming(injury)}
                      </div>
                      <div className={`col-span-3 text-center font-bold ${injury.isThisMatch ? 'text-red-400' : 'text-orange-400'}`}>
                        {injury.reason}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-1">
                  <span className="text-gray-500 text-xs font-mono">No injuries reported</span>
                </div>
              )}
            </div>
          </div>

          {/* Vertical Divider */}
          <div className="w-px bg-gray-600"></div>

          {/* Away Team Lineup */}
          <div className="flex-1">
            {away.startXI.length > 0 ? (
              <div className="space-y-1">
                {/* Header */}
                <div className="grid grid-cols-9 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                  <div className="col-span-1 text-gray-400 text-center">#</div>
                  <div className="col-span-4 text-gray-400">PLAYER</div>
                  <div className="col-span-2 text-gray-400 text-center">POS</div>
                  <div className="col-span-2 text-gray-400 text-center">GRID</div>
                </div>

                {/* Players */}
                {away.startXI.map((player, index) => (
                  <div key={player.id} className="grid grid-cols-9 gap-1 py-1 border-b border-gray-600 text-xs font-mono">
                    <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                    <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
                    <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                    <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm font-mono">No starting lineup available</div>
            )}

            {/* Substitutes */}
            {away.substitutes.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-bold text-gray-400 font-mono mb-2">SUBSTITUTES</h4>
                <div className="space-y-1">
                  {away.substitutes.map((player) => (
                    <div key={player.id} className="grid grid-cols-9 gap-1 py-1 border-b border-gray-700 text-xs font-mono">
                      <div className="col-span-1 text-gray-300 text-center">{player.number}</div>
                      <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
                      <div className="col-span-2 text-gray-400 text-center">{player.position}</div>
                      <div className="col-span-2 text-gray-500 text-center">{player.grid}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Injuries */}
            <div className="mt-2">
              <h4 className="text-sm font-bold text-red-400 font-mono mb-2">OUT</h4>
              {awayInjuriesLoading ? (
                <div className="text-center py-1">
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-400"></div>
                  <span className="ml-2 text-gray-400 text-xs font-mono">Loading injuries...</span>
                </div>
              ) : awayInjuriesError ? (
                <div className="text-center py-1">
                  <span className="text-red-400 text-xs font-mono">Failed to load injuries</span>
                </div>
              ) : awayInjuriesData && awayInjuriesData.length > 0 ? (
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-10 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                    <div className="col-span-4 text-gray-400">PLAYER</div>
                    <div className="col-span-3 text-gray-400 text-center">STATUS</div>
                    <div className="col-span-3 text-gray-400 text-center">REASON</div>
                  </div>
                  {awayInjuriesData.map((injury) => (
                    <div key={injury.player.id} className="grid grid-cols-10 gap-1 py-1 border-b border-gray-600 text-xs font-mono">
                      <div className="col-span-4 text-white font-bold truncate">{injury.player.name}</div>
                      <div className={`col-span-3 text-center font-bold ${injury.isThisMatch ? 'text-red-400' : 'text-orange-400'}`}>
                        {formatInjuryTiming(injury)}
                      </div>
                      <div className={`col-span-3 text-center font-bold ${injury.isThisMatch ? 'text-red-400' : 'text-orange-400'}`}>
                        {injury.reason}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-1">
                  <span className="text-gray-500 text-xs font-mono">No injuries reported</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };
  const renderExpandedContent = (fixture: any) => {
    const extendedData = [
      {
        id: 'halftime',
        label: 'HALF TIME',
        home: fixture.score_halftime_home ?? '-',
        away: fixture.score_halftime_away ?? '-',
        info: '',
        show: fixture.score_halftime_home !== null || fixture.score_halftime_away !== null
      },
      {
        id: 'extratime',
        label: 'EXTRA TIME',
        home: fixture.score_extratime_home ?? '-',
        away: fixture.score_extratime_away ?? '-',
        info: '',
        show: fixture.score_extratime_home !== null || fixture.score_extratime_away !== null
      },
      {
        id: 'penalties',
        label: 'PENALTIES',
        home: fixture.score_penalty_home ?? '-',
        away: fixture.score_penalty_away ?? '-',
        info: '',
        show: fixture.score_penalty_home !== null || fixture.score_penalty_away !== null
      },
      {
        id: 'country',
        label: 'COUNTRY',
        home: fixture.home_country || '-',
        away: fixture.away_country || '-',
        info: '',
        show: true
      },
      {
        id: 'venue',
        label: 'VENUE',
        home: '',
        away: '',
        info: fixture.venue_name || '-',
        show: true
      },
      {
        id: 'referee',
        label: 'REFEREE',
        home: '',
        away: '',
        info: fixture.referee || '-',
        show: true
      },
      {
        id: 'round',
        label: 'ROUND',
        home: '',
        away: '',
        info: fixture.round || '-',
        show: true
      },
      {
        id: 'status',
        label: 'STATUS',
        home: '',
        away: '',
        info: fixture.status_long || '-',
        show: true
      },
      {
        id: 'updated',
        label: 'UPDATED',
        home: '',
        away: '',
        info: fixture.updated_at ? new Date(fixture.updated_at).toLocaleString() : '-',
        show: true
      }
    ].filter(item => item.show);

    return (
      <div className="space-y-4">
        {/* Fixture Info Table */}
        <div className="px-1 py-1">
          {/* Header */}
          <div className="grid grid-cols-13 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
            <div className="col-span-4 text-gray-400">DETAIL</div>
            <div className="col-span-3 text-gray-400 text-center">HOME</div>
            <div className="col-span-3 text-gray-400 text-center">AWAY</div>
            <div className="col-span-3 text-gray-400">INFO</div>
          </div>

          {/* Data Rows */}
          {extendedData.map((item) => (
            <div key={item.id} className="grid grid-cols-13 gap-1 py-1 border-b border-gray-600 text-xs font-mono">
              <div className="col-span-4 text-gray-300 font-bold">{item.label}</div>
              <div className="col-span-3 text-gray-100 text-center">{item.home ?? '-'}</div>
              <div className="col-span-3 text-gray-100 text-center">{item.away ?? '-'}</div>
              <div className="col-span-3 text-gray-100">{item.info ?? '-'}</div>
            </div>
          ))}
        </div>

        {/* Lineups Section */}
        <div>
          <div className="px-1 py-1">
            {renderLineupsSection(fixture)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}

      <DataTable
        title="FIXTURES"
        subtitle={`SHOWING ${fixtures && fixtures.length > 0 ? ((pagination.currentPage - 1) * pagination.limit) + 1 : 0} TO ${Math.min(pagination.currentPage * pagination.limit, pagination.totalCount)} OF ${pagination.totalCount} FIXTURES`}
        data={fixtures || []}
        columns={fixturesColumns}
        getItemId={(fixture) => fixture.id}
        emptyMessage="No fixtures found with current filters"
        filterable={true}
        initialFilters={initialFilters}
        filterValueApi={getFilterValueApiUrl}
        onSort={handleSort}
        onFilter={handleFilter}
        expandable={true}
        renderExpandedContent={renderExpandedContent}
        getExpandedRowClassName={() => 'bg-gray-850'}
        onRowExpand={(fixtureId, isExpanded) => {
          if (isExpanded) {
            setExpandedFixtureId(fixtureId.toString());
          } else if (expandedFixtureId === fixtureId.toString()) {
            setExpandedFixtureId(null);
          }
        }}
      />

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center items-center py-2 gap-2">
          <button
            onClick={() => handlePageChange(pagination.currentPage - 1)}
            disabled={!pagination.hasPrev}
            className="px-3 py-1 bg-gray-800 border border-gray-600 text-white hover:bg-gray-700 disabled:bg-black disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed text-xs font-mono transition-colors"
          >
            PREVIOUS
          </button>

          <div className="flex gap-1">
            {(() => {
              const maxVisiblePages = 5;
              const totalPages = pagination.totalPages;
              const currentPage = pagination.currentPage;

              // Calculate the range of pages to show
              let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
              let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

              // Adjust startPage if we're at the end
              if (endPage - startPage + 1 < maxVisiblePages) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
              }

              return Array.from({ length: endPage - startPage + 1 }, (_, i) => {
                const pageNum = startPage + i;
                const isActive = pageNum === currentPage;
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`px-2 py-1 border text-xs font-mono transition-colors ${
                      isActive
                        ? 'border-blue-400 bg-blue-900/50 text-blue-400'
                        : 'border-gray-600 bg-gray-800 text-white hover:bg-gray-700'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              });
            })()}
          </div>

          <button
            onClick={() => handlePageChange(pagination.currentPage + 1)}
            disabled={!pagination.hasNext}
            className="px-3 py-1 bg-gray-800 border border-gray-600 text-white hover:bg-gray-700 disabled:bg-black disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed text-xs font-mono transition-colors"
          >
            NEXT
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editingFixture && (
        <FixtureEditModal
          fixture={editingFixture}
          onClose={handleCloseEditModal}
          onUpdate={handleFixtureUpdated}
        />
      )}
    </div>
  )
}
