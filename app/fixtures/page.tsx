'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useCallback, useMemo } from 'react'
import { useFixtureLineups, useTeamInjuries, useFixtureStats } from '../../lib/hooks/use-football-data'
import DataTable, { Column } from '../../components/ui/data-table'
import FixtureEditModal from '../../components/admin/FixtureEditModal'
import { FixtureOdds } from '../../components/FixtureOdds'


export default function FixturesPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [expandedFixtureId, setExpandedFixtureId] = useState<string | null>(null)
  const [editingFixture, setEditingFixture] = useState<any>(null)
  const [lineupsExpanded, setLineupsExpanded] = useState(false)

  const currentPage = parseInt(searchParams.get('page') || '1')
  
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

  // Store current fixture data from expanded row
  const [currentFixtureData, setCurrentFixtureData] = useState<any>(null)
  const homeTeamId = currentFixtureData ? currentFixtureData.home_team_id?.toString() : null
  const awayTeamId = currentFixtureData ? currentFixtureData.away_team_id?.toString() : null

  // Fetch injuries for each team separately
  const { data: homeInjuriesData, loading: homeInjuriesLoading, error: homeInjuriesError } = useTeamInjuries(expandedFixtureId, homeTeamId)
  const { data: awayInjuriesData, loading: awayInjuriesLoading, error: awayInjuriesError } = useTeamInjuries(expandedFixtureId, awayTeamId)

  // Fetch stats for the fixture
  const { data: statsData, loading: statsLoading, error: statsError } = useFixtureStats(expandedFixtureId)

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
      return 'text-gray-400';
    }
    return injury.isThisMatch ? 'text-red-400' : 'text-orange-400';
  }, [formatInjuryTiming])

  const handleEditFixture = useCallback((fixture: any) => {
    setEditingFixture(fixture)
  }, [])

  // Column definitions for fixtures table
  const fixturesColumns = useMemo<Column<any>[]>(() => [
    {
      key: 'home_team_name', // Use database column name for server-side
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
      key: 'away_team_name', // Use database column name for server-side
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
      key: 'league_name', // Use database column name for server-side
      header: 'LEAGUE',
      span: 2,
      sortType: 'string',
      sortKey: 'league_name',
      render: (fixture) => (
        <div className="truncate text-gray-500 text-xs">
          {fixture.league_name} ({fixture.league_country})
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
      key: 'market_xg',
      header: 'MARKET XG',
      span: 1,
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
            <span className="text-gray-300 font-bold">
              {parseFloat(fixture.market_xg_home.toString()).toFixed(2)}-{parseFloat(fixture.market_xg_away.toString()).toFixed(2)}
            </span>
          ) : (
            <span className="text-gray-500">-</span>
          )}
        </div>
      )
    },
    {
      key: 'status_short', // Use database column name for server-side
      header: 'STATUS',
      span: 1,
      sortable: false, // Status - disable sorting
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
      filterable: true, // Enable filtering for Time column
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
      filterable: false, // Actions column - disable filtering
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
  ], [handleEditFixture, formatDate])

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


  const renderLineupsSection = useCallback((fixture: any) => {
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
                    <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
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
                      <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
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
                    <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
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
                      <div className="col-span-4 text-gray-100 font-bold truncate">{player.name}</div>
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
  }, [lineupsLoading, lineupsError, lineupsData]);

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
              <div className="text-center py-1">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-400"></div>
                <span className="ml-2 text-gray-400 text-xs font-mono">Loading injuries...</span>
              </div>
            ) : homeInjuriesError ? (
              <div className="text-center py-1">
                <span className="text-red-400 text-xs font-mono">Failed to load injuries</span>
              </div>
            ) : homeInjuriesData && homeInjuriesData.length > 0 ? (
              <div className="space-y-0.5">
                {/* Header */}
                <div className="grid grid-cols-12 gap-1 py-0.5 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                  <div className="col-span-3 text-gray-400">PLAYER</div>
                  <div className="col-span-3 text-gray-400 text-center">REASON</div>
                  <div className="col-span-2 text-gray-400 text-center">STATUS</div>
                  <div className="col-span-2 text-gray-400 text-center">SINCE</div>
                  <div className="col-span-2 text-gray-400 text-center">MISSED</div>
                </div>
                {homeInjuriesData.filter((injury) => {
                  // Filter out injuries older than 8 days
                  if (injury.daysSinceInjury > 8) return false;
                  const status = formatInjuryTiming(injury);
                  return !(status.startsWith('WAS') && injury.reason === 'Red Card');
                }).map((injury) => (
                  <div key={injury.player.id} className="grid grid-cols-12 gap-1 py-0.5 border-b border-gray-600 text-xs font-mono">
                    <div className="col-span-3 text-white font-bold truncate">{injury.player.name}</div>
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
                <span className="text-gray-500 text-xs font-mono">No injuries reported</span>
              </div>
            )}
          </div>

          {/* Vertical Divider */}
          <div className="w-px bg-gray-600"></div>

          {/* Away Team Injuries */}
          <div className="flex-1">
            <h4 className="text-xs font-bold text-red-400 font-mono mb-1">OUT</h4>
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
              <div className="space-y-0.5">
                {/* Header */}
                <div className="grid grid-cols-12 gap-1 py-0.5 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
                  <div className="col-span-3 text-gray-400">PLAYER</div>
                  <div className="col-span-3 text-gray-400 text-center">REASON</div>
                  <div className="col-span-2 text-gray-400 text-center">STATUS</div>
                  <div className="col-span-2 text-gray-400 text-center">SINCE</div>
                  <div className="col-span-2 text-gray-400 text-center">MISSED</div>
                </div>
                {awayInjuriesData.filter((injury) => {
                  // Filter out injuries older than 8 days
                  if (injury.daysSinceInjury > 8) return false;
                  const status = formatInjuryTiming(injury);
                  return !(status.startsWith('WAS') && injury.reason === 'Red Card');
                }).map((injury) => (
                  <div key={injury.player.id} className="grid grid-cols-12 gap-1 py-0.5 border-b border-gray-600 text-xs font-mono">
                    <div className="col-span-3 text-white font-bold truncate">{injury.player.name}</div>
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
                <span className="text-gray-500 text-xs font-mono">No injuries reported</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [homeInjuriesLoading, homeInjuriesError, homeInjuriesData, awayInjuriesLoading, awayInjuriesError, awayInjuriesData, formatInjuryTiming]);

  const renderOddsSection = useCallback((fixture: any) => {
    return <FixtureOdds fixtureId={fixture.id} />;
  }, []);

  const renderStatsSection = useCallback((fixture: any) => {
    if (statsLoading) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-400 text-sm font-mono">Loading stats...</span>
          </div>
        </div>
      );
    }

    if (statsError) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-red-400 text-sm font-mono">Failed to load stats: {statsError}</span>
          </div>
        </div>
      );
    }

    if (!statsData || !statsData.stats) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-gray-500 text-sm font-mono">No stats available</span>
          </div>
        </div>
      );
    }

    const stats = statsData.stats;

    return (
      <div className="px-2 py-2">
        {/* Stats Table */}
        <div className="px-1 py-1">
          {/* Header */}
          <div className="grid grid-cols-13 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
            <div className="col-span-4 text-gray-400">STATISTICS</div>
            <div className="col-span-3 text-gray-400 text-center">HOME</div>
            <div className="col-span-3 text-gray-400 text-center">AWAY</div>
            <div className="col-span-3 text-gray-400">INFO</div>
          </div>

          {/* Data Rows */}
          {[
            {
              id: 'hours_since_last_match',
              label: 'HOURS SINCE LAST MATCH',
              home: stats.hours_since_last_match_home?.toString() || '-',
              away: stats.hours_since_last_match_away?.toString() || '-',
              info: '',
              show: true
            },
            {
              id: 'elo_rating',
              label: 'ELO RATING TEAMS/LEAGUE',
              home: stats.elo_home?.toString() || '-',
              away: stats.elo_away?.toString() || '-',
              info: stats.league_elo?.toString() || '-',
              show: true
            },
            {
              id: 'avg_goals_league',
              label: 'AVG GOALS LEAGUE',
              home: '',
              away: '',
              info: stats.avg_goals_league?.toString() || '-',
              show: true
            },
            {
              id: 'home_advantage',
              label: 'HOME ADVANTAGE',
              home: '',
              away: '',
              info: stats.home_advantage?.toString() || '-',
              show: true
            },
            {
              id: 'adjusted_rolling_xg',
              label: 'ADJUSTED ROLLING XG',
              home: stats.adjusted_rolling_xg_home?.toString() || '-',
              away: stats.adjusted_rolling_xg_away?.toString() || '-',
              info: '',
              show: true
            },
            {
              id: 'adjusted_rolling_xga',
              label: 'ADJUSTED ROLLING XGA',
              home: stats.adjusted_rolling_xga_home?.toString() || '-',
              away: stats.adjusted_rolling_xga_away?.toString() || '-',
              info: '',
              show: true
            },
            {
              id: 'adjusted_rolling_market_xg',
              label: 'ADJUSTED ROLLING MARKET XG',
              home: stats.adjusted_rolling_market_xg_home?.toString() || '-',
              away: stats.adjusted_rolling_market_xg_away?.toString() || '-',
              info: '',
              show: true
            },
            {
              id: 'adjusted_rolling_market_xga',
              label: 'ADJUSTED ROLLING MARKET XGA',
              home: stats.adjusted_rolling_market_xga_home?.toString() || '-',
              away: stats.adjusted_rolling_market_xga_away?.toString() || '-',
              info: '',
              show: true
            },
            {
              id: 'predicted_xg',
              label: 'PREDICTED XG',
              home: stats.ai_home_pred ? parseFloat(stats.ai_home_pred.toString()).toFixed(2) : '-',
              away: stats.ai_away_pred ? parseFloat(stats.ai_away_pred.toString()).toFixed(2) : '-',
              info: stats.ai_home_pred && stats.ai_away_pred
                ? (parseFloat(stats.ai_home_pred.toString()) + parseFloat(stats.ai_away_pred.toString())).toFixed(2)
                : '-',
              show: true
            },
            {
              id: 'updated_at',
              label: 'LAST UPDATED',
              home: '',
              away: '',
              info: stats.updated_at ? new Date(stats.updated_at).toLocaleString() : '-',
              show: true
            }
          ].map((item) => (
            <div key={item.id} className="grid grid-cols-13 gap-1 py-1 border-b border-gray-800 text-xs font-mono hover:bg-gray-900">
              <div className="col-span-4 text-gray-300 font-bold">{item.label}</div>
              <div className="col-span-3 text-gray-100 text-center">{item.home ?? '-'}</div>
              <div className="col-span-3 text-gray-100 text-center">{item.away ?? '-'}</div>
              <div className="col-span-3 text-gray-100">{item.info ?? '-'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }, [statsLoading, statsError, statsData]);

  const renderExpandedContent = useCallback((fixture: any) => {
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
      }
    ].filter(item => item.show);

    return (
      <div className="space-y-4">
        {/* INFO Section */}
        <div>
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
              <div key={item.id} className="grid grid-cols-13 gap-1 py-1 border-b border-gray-800 text-xs font-mono hover:bg-gray-900">
                <div className="col-span-4 text-gray-300 font-bold">{item.label}</div>
                <div className="col-span-3 text-gray-100 text-center">{item.home ?? '-'}</div>
                <div className="col-span-3 text-gray-100 text-center">{item.away ?? '-'}</div>
                <div className="col-span-3 text-gray-100">{item.info ?? '-'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ODDS Section */}
        <div>
          <div className="px-1">
            {renderOddsSection(fixture)}
          </div>
        </div>

        {/* LINEUP Section */}
        <div>
          <button
            onClick={() => setLineupsExpanded(!lineupsExpanded)}
            className="flex items-center gap-2 text-xs font-bold text-gray-200 font-mono mb-2 hover:text-white transition-colors w-full"
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

        {/* STATS Section */}
        <div>
          <div className="px-0">
            {renderStatsSection(fixture)}
          </div>
        </div>
      </div>
    );
  }, [renderLineupsSection, renderInjuriesSection, renderOddsSection, renderStatsSection]);

  return (
    <div className="fixed inset-0 top-[57px] left-0 right-0 bottom-0 bg-black overflow-auto">
      <div className="w-full px-4">
        <DataTable
        title="FIXTURES"
        columns={fixturesColumns}
        getItemId={(fixture) => fixture.id || `${fixture.home_team_name}-${fixture.away_team_name}-${fixture.date}`}
        emptyMessage="No fixtures found with current filters"
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
          } else {
            setExpandedFixtureId(null);
            setCurrentFixtureData(null);
            setLineupsExpanded(false); // Reset lineups section when row is collapsed
          }
        }, [])}
        apiEndpoint="/api/fixtures"
        currentPage={currentPage}
        onPageChange={handlePageChange}
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
      </div>
    </div>
  )
}
