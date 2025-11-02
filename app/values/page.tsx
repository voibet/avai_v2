'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { analyzeValueOpportunities, type Fixture, type ValueOpportunity, type ValueAnalysisConfig } from '@/lib/utils/value-analysis'
import DataTable, { Column } from '../../components/ui/data-table'
import { useFixtureLineups, useTeamInjuries, useFixtureStats, useLeagueStandings, useFixtureCoaches } from '../../lib/hooks/use-football-data'
import { useFootballSearchData } from '../../lib/hooks/use-football-search-data'
import FixtureEditModal from '../../components/admin/FixtureEditModal'
import PlayerStatsModal from '../../components/fixtures/PlayerStatsModal'
import TeamStandingsModal from '../../components/fixtures/TeamStandingsModal'
import { FixtureOdds } from '../../components/FixtureOdds'
import { IN_PAST, CANCELLED, IN_PLAY, IN_FUTURE } from '../../lib/constants'

// Custom filter component for ODDS - defined outside component (NO HOOKS!)
const OddsFilterRenderer = ({ column, currentFilters, onFilterChange, onClose }: any) => {
  const hasFilter = currentFilters[column.key]?.size > 0
  const currentValue = hasFilter ? Array.from(currentFilters[column.key])[0] : ''
  const inputId = `odds-filter-${column.key}`
  
  const applyFilter = () => {
    const input = document.getElementById(inputId) as HTMLInputElement
    const value = input?.value
    if (value && value !== currentValue) {
      onFilterChange(column.key, value)
    }
  }
  
  return (
    <div className="p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-white">Max Odds</span>
        {hasFilter && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFilterChange(column.key, null)
              const input = document.getElementById(inputId) as HTMLInputElement
              if (input) input.value = ''
            }}
            className="text-xs text-red-400 hover:text-red-300 font-mono"
            style={{ pointerEvents: 'auto' }}
          >
            Clear
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="number"
        step="0.01"
        min="1.0"
        placeholder="e.g. 5.0 or 5,00"
        defaultValue={currentValue as string}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            applyFilter()
            onClose()
          }
        }}
        onBlur={applyFilter}
        className="w-full px-2 py-1 bg-gray-700 border border-gray-600 text-white text-xs font-mono rounded focus:outline-none focus:border-blue-400"
        style={{ pointerEvents: 'auto' }}
      />
    </div>
  )
}


// Custom filter component for RATIO - defined outside component (NO HOOKS!)
const RatioFilterRenderer = ({ column, currentFilters, onFilterChange, onClose }: any) => {
  const hasFilter = currentFilters[column.key]?.size > 0
  const currentValue = hasFilter ? Array.from(currentFilters[column.key])[0] : ''
  const inputId = `ratio-filter-${column.key}`
  
  const applyFilter = () => {
    const input = document.getElementById(inputId) as HTMLInputElement
    const value = input?.value
    if (value && value !== currentValue) {
      onFilterChange(column.key, value)
    }
  }
  
  return (
    <div className="p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-white">Min Ratio</span>
        {hasFilter && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFilterChange(column.key, null)
              const input = document.getElementById(inputId) as HTMLInputElement
              if (input) input.value = ''
            }}
            className="text-xs text-red-400 hover:text-red-300 font-mono"
            style={{ pointerEvents: 'auto' }}
          >
            Clear
          </button>
        )}
      </div>
      <input
        id={inputId}
        type="text"
        placeholder="e.g. 1.05 or 1,05"
        defaultValue={currentValue as string}
        onChange={(e) => {
          const value = e.target.value
          // Allow only numbers, decimal point, and comma
          if (value === '' || /^[\d,.]*$/.test(value)) {
            e.currentTarget.value = value
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            applyFilter()
            onClose()
          }
        }}
        onBlur={applyFilter}
        className="w-full px-2 py-1 bg-gray-700 border border-gray-600 text-white text-xs font-mono rounded focus:outline-none focus:border-blue-400"
        style={{ pointerEvents: 'auto' }}
      />
    </div>
  )
}

function ValuesPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [opportunities, setOpportunities] = useState<ValueOpportunity[]>([])
  const [analyzedFixtures, setAnalyzedFixtures] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  // Store streaming updates separately for efficient updates
  const [streamedFixtures, setStreamedFixtures] = useState<Map<string, any>>(new Map())

  // Expandable row state (similar to fixtures page)
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null)
  const [editingFixture, setEditingFixture] = useState<any>(null)
  const [lineupsExpanded, setLineupsExpanded] = useState(false)
  const [standingsExpanded, setStandingsExpanded] = useState(false)
  const [standingsSortColumn, setStandingsSortColumn] = useState<string>('rank')
  const [standingsSortDirection, setStandingsSortDirection] = useState<'asc' | 'desc'>('asc')
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; name: string; teamId?: string; leagueId?: string } | null>(null)
  const [selectedTeamStandings, setSelectedTeamStandings] = useState<{
    team: { id: number; name: string; logo: string };
    descriptionPercentages: { [description: string]: number };
    winPercentage: number | null;
  } | null>(null)

  // Filter states
  const [fairOddsBookie, setFairOddsBookie] = useState('Pinnacle')
  const [oddsRatioBookies, setOddsRatioBookies] = useState<string[]>(['Veikkaus'])
  const [minRatio] = useState(0.9)

  // Sorting state
  const [sortBy, setSortBy] = useState<'ratio' | 'date' | 'updated'>('ratio')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // Extract sorting from URL
  const currentSort = useMemo(() => {
    const sortBy = searchParams.get('sort_by')
    const sortDirection = searchParams.get('sort_direction') as 'asc' | 'desc' | null

    if (sortBy && sortDirection) {
      return { key: sortBy, direction: sortDirection }
    }
    return null
  }, [searchParams])

  // Extract filters from URL
  const currentFilters = useMemo(() => {
    const filters: Record<string, Set<string>> = {}

    // Check for date filter (special case for TIME column)
    const dateValue = searchParams.get('fixture_date')
    if (dateValue) {
      filters['fixture_date'] = new Set([dateValue])
    }

    // Check for odds filter (max odds)
    const oddsValue = searchParams.get('bookie_odds')
    if (oddsValue) {
      filters['bookie_odds'] = new Set([oddsValue])
    }

    // Check for ratio filter (min ratio)
    const ratioValue = searchParams.get('ratio')
    if (ratioValue) {
      filters['ratio'] = new Set([ratioValue])
    }

    // Check for bookie filter (odds ratio bookies)
    const bookieValue = searchParams.get('bookie')
    if (bookieValue) {
      filters['bookie'] = new Set([bookieValue])
    }

    return filters
  }, [searchParams])

  // Initialize oddsRatioBookies from URL on component mount
  useEffect(() => {
    const bookieValue = searchParams.get('bookie')
    if (bookieValue) {
      const selectedBookies = bookieValue.split(',')
      setOddsRatioBookies(selectedBookies.length > 0 ? selectedBookies : ['Veikkaus'])
    }
  }, []) // Only run on mount

  // Handle sorting changes - update URL
  const handleSortChange = useCallback((sortKey: string, direction: 'asc' | 'desc') => {
    const params = new URLSearchParams(searchParams.toString())

    params.set('sort_by', sortKey)
    params.set('sort_direction', direction)

    router.push(`/values?${params.toString()}`)
  }, [searchParams, router])

  // Handle filter changes - update URL
  const handleFilterChange = useCallback((columnKey: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())

    if (value) {
      params.set(columnKey, value)
    } else {
      params.delete(columnKey)
    }

    router.push(`/values?${params.toString()}`)
  }, [searchParams, router])

  // Handle clearing all filters
  const handleClearAllFilters = useCallback(() => {
    const params = new URLSearchParams()
    // Keep sorting if it exists
    if (currentSort) {
      params.set('sort_by', currentSort.key)
      params.set('sort_direction', currentSort.direction)
    }
    router.push(`/values?${params.toString()}`)
  }, [router, currentSort])

  // Fetch teams and leagues data for search
  const { teams, leagues, loading: searchDataLoading } = useFootballSearchData()

  // Filter value API for DataTable
  const getFilterValueApi = useCallback(async (field: string): Promise<string[]> => {
    if (field === 'fixture.date') {
      // Return predefined date options for TIME column filtering
      return ['Today', 'Tomorrow', 'Next 7 Days', 'Next 14 Days']
    }

    // For other fields, compute from current data
    const values = new Set<string>()
    opportunities.forEach(opportunity => {
      let value: any

      switch (field) {
        case 'fixture.home_team':
          value = opportunity.fixture.home_team
          break
        case 'fixture.away_team':
          value = opportunity.fixture.away_team
          break
        case 'fixture.league':
          value = opportunity.fixture.league
          break
        case 'bookie':
          value = opportunity.bookie
          break
        default:
          return []
      }

      if (value !== null && value !== undefined && value !== '') {
        values.add(String(value))
      }
    })

    return Array.from(values).sort()
  }, [opportunities])

  // Store current fixture data from expanded row
  const [currentFixtureData, setCurrentFixtureData] = useState<any>(null)
  const homeTeamId = currentFixtureData ? currentFixtureData.home_team_id?.toString() : null
  const awayTeamId = currentFixtureData ? currentFixtureData.away_team_id?.toString() : null

  // Fetch injuries for each team separately
  const { data: homeInjuriesData, loading: homeInjuriesLoading, error: homeInjuriesError } = useTeamInjuries(expandedOpportunityId, homeTeamId)
  const { data: awayInjuriesData, loading: awayInjuriesLoading, error: awayInjuriesError } = useTeamInjuries(expandedOpportunityId, awayTeamId)

  // Fetch stats for the fixture
  const { data: statsData, loading: statsLoading, error: statsError } = useFixtureStats(expandedOpportunityId)

  // Only fetch standings when the standings section is expanded and we have fixture data
  const { data: standingsData, loading: standingsLoading, error: standingsError } = useLeagueStandings(
    standingsExpanded && currentFixtureData ? currentFixtureData.league_id?.toString() : null,
    standingsExpanded && currentFixtureData ? currentFixtureData.season?.toString() : null
  )

  // Only fetch lineups when the lineups section is expanded
  const { data: lineupsData, loading: lineupsLoading, error: lineupsError } = useFixtureLineups(lineupsExpanded ? expandedOpportunityId : null)

  // Fetch coaches when lineups are expanded
  const { data: coachesData, loading: coachesLoading, error: coachesError } = useFixtureCoaches(lineupsExpanded ? expandedOpportunityId : null)

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

  // Merge base fixtures with streaming updates - efficient merge at render time
  const mergedFixtures = useMemo(() => {
    return fixtures.map(fixture => {
      const streamedUpdate = streamedFixtures.get(fixture.fixture_id)
      if (streamedUpdate) {
        // Merge streamed updates with base fixture
        return {
          ...fixture,
          ...streamedUpdate,
          // Ensure odds array is properly merged (streamed update takes precedence)
          odds: streamedUpdate.odds || fixture.odds
        }
      }
      return fixture
    })
  }, [fixtures, streamedFixtures])

  // Get available bookies from merged fixtures (includes streaming updates)
  const availableBookies = useMemo(() => {
    return mergedFixtures.length > 0
      ? Array.from(new Set(mergedFixtures.flatMap(f => f.odds.map((o: any) => o.bookie))))
      : []
  }, [mergedFixtures])

  // Custom filter component for BOOKIE - defined inside component to access availableBookies and oddsRatioBookies
  const BookieFilterRenderer = ({ column, currentFilters, onFilterChange, onClose }: any) => {
    const handleBookieToggle = (bookie: string) => {
      setOddsRatioBookies(prev => {
        const newSelection = prev.includes(bookie)
          ? prev.filter(b => b !== bookie)
          : [...prev, bookie]

        // Ensure at least one bookie is selected
        return newSelection.length === 0 ? [bookie] : newSelection
      })
    }

    const clearFilter = () => {
      setOddsRatioBookies(['Veikkaus'])
    }

    return (
      <div className="p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-white">Odds Ratio Bookies</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              clearFilter()
            }}
            className="text-xs text-red-400 hover:text-red-300 font-mono"
            style={{ pointerEvents: 'auto' }}
          >
            Reset
          </button>
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {availableBookies.map(bookie => (
            <label key={bookie} className="flex items-center space-x-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={oddsRatioBookies.includes(bookie)}
                onChange={() => handleBookieToggle(bookie)}
                className="rounded border-gray-600 text-blue-600 focus:ring-blue-500"
                style={{ pointerEvents: 'auto' }}
              />
              <span className="text-gray-300 font-mono">{bookie}</span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  const fairOddsBookies = useMemo(() => {
    return availableBookies.filter(bookie =>
      mergedFixtures.some(f => f.odds.some((o: any) => o.bookie === bookie && (
        o.fair_odds_x12 || o.fair_odds_ah || o.fair_odds_ou
      )))
    )
  }, [availableBookies, mergedFixtures])


  // Column definitions for values table
  const valuesColumns = useMemo<Column<ValueOpportunity>[]>(() => [
    {
      key: 'home_team',
      header: 'HOME',
      span: 1.5,
      sortType: 'string',
      sortKey: 'fixture.home_team',
      sortable: false,
      filterable: false,
      render: (opportunity) => (
        <div className="truncate text-white font-mono">
          {opportunity.fixture.home_team}
        </div>
      )
    },
    {
      key: 'away_team',
      header: 'AWAY',
      span: 1.5,
      sortType: 'string',
      sortKey: 'fixture.away_team',
      sortable: false,
      filterable: false,
      render: (opportunity) => (
        <div className="truncate text-white font-mono">
          {opportunity.fixture.away_team}
        </div>
      )
    },
    {
      key: 'league',
      header: 'LEAGUE',
      span: 1.75,
      sortType: 'string',
      sortKey: 'fixture.league',
      sortable: false,
      filterable: false,
      render: (opportunity) => (
        <div className="truncate text-gray-600 text-xs font-mono">
          {opportunity.fixture.league}
        </div>
      )
    },
    {
      key: 'fixture_date',
      header: 'TIME',
      span: 1.0,
      filterable: true, // Enable filtering for Time column
      sortType: 'date',
      sortKey: 'fixture.date',
      render: (opportunity) => (
        <div className="text-gray-400 text-xs font-mono">
          {formatDate(opportunity.fixture.date)}
        </div>
      )
    },
    {
      key: 'market',
      header: 'MARKET',
      span: 1.25,
      sortable: false,
      filterable: false,
      render: (opportunity) => (
        <div className="truncate text-white font-mono">
          {getTypeLabel(opportunity.type, opportunity.oddsIndex, opportunity.line)}
        </div>
      )
    },
    {
      key: 'bookie_odds',
      header: 'ODDS',
      span: 0.8,
      sortType: 'number',
      filterable: true,
      customFilterRenderer: OddsFilterRenderer,
      render: (opportunity) => {
        const bookieData = opportunity.fixture.odds.find(o => o.bookie === opportunity.bookie)
        return (
          <div className="text-white font-mono font-bold">
            {bookieData ? formatOdds(opportunity.oddsBookieOdds, bookieData.decimals) : opportunity.oddsBookieOdds}
          </div>
        )
      }
    },
    {
      key: 'ratio',
      header: 'RATIO',
      span: 0.6,
      sortType: 'number',
      filterable: true,
      customFilterRenderer: RatioFilterRenderer,
      render: (opportunity) => (
        <div className="text-green-400 font-mono font-bold">
          {opportunity.ratio.toFixed(3)}
        </div>
      )
    },
    {
      key: 'bookie',
      header: 'BOOKIE',
      span: 0.8,
      sortType: 'string',
      filterable: true,
      customFilterRenderer: BookieFilterRenderer,
      render: (opportunity) => (
        <div className="text-gray-300 font-mono">
          {opportunity.bookie}
        </div>
      )
    },
    {
      key: 'updated',
      header: 'UPDATED',
      span: 1.0,
      sortType: 'date',
      sortable: true,
      filterable: false,
      render: (opportunity) => {
        // Use stream timestamp if available, otherwise fall back to bookie data updated_at
        const streamTimestamp = (opportunity.fixture as any).stream_timestamp
        let updatedAt

        if (streamTimestamp) {
          updatedAt = streamTimestamp
        } else {
          const bookieData = opportunity.fixture.odds.find(o => o.bookie === opportunity.bookie)
          updatedAt = bookieData?.updated_at
        }

        if (!updatedAt) return <div className="text-gray-500 font-mono">-</div>

        const date = new Date(updatedAt); // stream_timestamp is already in milliseconds
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');

        return (
          <div className="text-gray-400 text-xs font-mono">
            {`${day}.${month} ${hours}:${minutes}`}
          </div>
        )
      }
    }
  ], [formatDate, OddsFilterRenderer, RatioFilterRenderer, BookieFilterRenderer])

  // Create config from current filter state (memoized to prevent unnecessary recreations)
  const config: ValueAnalysisConfig = useMemo(() => ({
    fairOddsBookie,
    oddsRatioBookies: oddsRatioBookies.length === 1 ? oddsRatioBookies[0] : oddsRatioBookies,
    minRatio
    // maxOdds is now handled by client-side filtering
  }), [fairOddsBookie, oddsRatioBookies, minRatio])

  const handleEditFixture = useCallback((fixture: any) => {
    setEditingFixture(fixture)
  }, [])

  const handleCloseEditModal = () => {
    setEditingFixture(null)
  }

  const handleFixtureUpdated = useCallback(() => {
    // Reload data when fixture is updated
    window.location.reload()
  }, [])

  const handleColumnSort = useCallback((column: string) => {
    if (standingsSortColumn === column) {
      setStandingsSortDirection(standingsSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setStandingsSortColumn(column);
      setStandingsSortDirection('asc');
    }
  }, [standingsSortColumn, standingsSortDirection])

  const handleRowExpand = useCallback((opportunityId: string | number, isExpanded: boolean, opportunity?: ValueOpportunity) => {
    if (isExpanded && opportunity) {
      setExpandedOpportunityId(opportunityId.toString());
      setCurrentFixtureData({
        ...opportunity.fixture,
        fixture_id: opportunity.fixture.fixture_id,
        home_team: opportunity.fixture.home_team,
        away_team: opportunity.fixture.away_team,
        home_team_id: opportunity.fixture.home_team_id,
        away_team_id: opportunity.fixture.away_team_id,
        league_id: opportunity.fixture.league_id,
        season: opportunity.fixture.season
      });
      setLineupsExpanded(false);
      setStandingsExpanded(false);
    } else {
      setExpandedOpportunityId(null);
      setCurrentFixtureData(null);
      setLineupsExpanded(false);
      setStandingsExpanded(false);
    }
  }, [])

  const renderLineupsSection = useCallback((fixture: any) => {
    if (lineupsLoading || coachesLoading) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-500 text-sm font-mono">Loading lineups...</span>
          </div>
        </div>
      );
    }

    if (lineupsError || coachesError) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-red-400 text-sm font-mono">Failed to load lineups: {lineupsError || coachesError}</span>
          </div>
        </div>
      );
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
                {fixture.home_team}
                {home.formation && <span className="text-xs text-gray-400 ml-2">({home.formation})</span>}
              </h3>
            </div>
            <div className="flex-1 text-center">
              <h3 className="text-xs font-bold text-gray-200 font-mono">
                {fixture.away_team}
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
              {fixture.home_team}
            </h3>
          </div>
          <div className="flex-1 text-center">
            <h3 className="text-xs font-bold text-gray-200 font-mono">
              {fixture.away_team}
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
                <span className="text-gray-500 text-xs font-mono">No injuries reported</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }, [homeInjuriesLoading, homeInjuriesError, homeInjuriesData, awayInjuriesLoading, awayInjuriesError, awayInjuriesData, formatInjuryTiming, getInjuryStatusColor]);

  const renderOddsSection = useCallback((fixture: any) => {
    return <FixtureOdds key={`odds-${fixture.fixture_id}`} fixtureId={fixture.fixture_id} fixture={fixture} />;
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

  const renderStandingsSection = useCallback((fixture: any) => {
    if (standingsLoading) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-400 text-sm font-mono">Loading standings...</span>
          </div>
        </div>
      );
    }

    if (standingsError) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-red-400 text-sm font-mono">Failed to load standings: {standingsError}</span>
          </div>
        </div>
      );
    }

    if (!standingsData || !standingsData.standings?.standings?.length) {
      return (
        <div className="px-2 py-4">
          <div className="text-center py-4">
            <span className="text-gray-500 text-sm font-mono">No standings available</span>
          </div>
        </div>
      );
    }

    const { standings } = standingsData.standings;

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
          <div className="grid grid-cols-17 gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white">
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
          {filteredStandings.map((standing, index) => {
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
                  className={`grid grid-cols-17 gap-1 py-1 ${hasDivider ? 'border-b-2 border-gray-500' : 'border-b border-gray-800'} text-xs font-mono hover:bg-gray-900 ${
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

  const renderExpandedContent = useCallback((opportunity: ValueOpportunity) => {
    // Convert opportunity fixture to fixture format expected by components
    const fixture = {
      ...opportunity.fixture,
      fixture_id: opportunity.fixture.fixture_id,
      home_team: opportunity.fixture.home_team,
      away_team: opportunity.fixture.away_team,
      home_team_id: opportunity.fixture.home_team_id,
      away_team_id: opportunity.fixture.away_team_id,
      league_id: opportunity.fixture.league_id,
      season: opportunity.fixture.season || '2024' // Default season
    };

    const extendedData = [
      {
        id: 'country',
        label: 'Team Country',
        home: (fixture as any).home_country || '-',
        away: (fixture as any).away_country || '-',
        info: '',
        show: true
      },
      {
        id: 'venue',
        label: 'Venue',
        home: '',
        away: '',
        info: (fixture as any).venue_name || '-',
        show: true
      },
      {
        id: 'referee',
        label: 'Referee',
        home: '',
        away: '',
        info: (fixture as any).referee || '-',
        show: true
      },
      {
        id: 'round',
        label: 'Round',
        home: '',
        away: '',
        info: (fixture as any).round || '-',
        show: true
      },
      {
        id: 'status',
        label: 'Status',
        home: '',
        away: '',
        info: (fixture as any).status_long || '-',
        show: true
      }
    ].filter(item => item.show);

    return (
      <div className="space-y-0">
        {/* INFO Section */}
        <div className="mt-2">
          <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
            {/* Headers */}
            {extendedData.map((item) => (
              <div key={`header-${item.id}`} className="border-r border-gray-700 px-1 py-0.5 text-gray-300 font-bold text-[12px] bg-gray-900 font-mono truncate">
                {item.label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
            {/* Values */}
            {extendedData.map((item) => (
              <div key={`value-${item.id}`} className="border-r border-gray-700 px-1 py-1 text-gray-100 text-[11px] font-mono truncate">
                {item.home && item.away ? `${item.home} - ${item.away}` : (item.home || item.away || item.info || '-')}
              </div>
            ))}
          </div>
        </div>

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
  }, [renderLineupsSection, renderStandingsSection, renderInjuriesSection, renderOddsSection, renderStatsSection, standingsExpanded, lineupsExpanded]);

  useEffect(() => {
    fetchValues()
  }, [])

  const fetchValues = async () => {
    try {
      setLoading(true)

      // Fetch odds data (contains all fixture + odds info)
      const oddsResponse = await fetch('/api/odds?limit=3000&fair_odds=true&latest=true')

      if (!oddsResponse.ok) {
        throw new Error(`HTTP error! odds: ${oddsResponse.status}`)
      }

      const oddsData = await oddsResponse.json()

      // Use odds fixtures directly (they already contain fixture + odds data)
      const fixtures = oddsData.fixtures || []
      setFixtures(fixtures)

      // Start streaming after successful load
      // Analysis will be triggered automatically by useEffect when fixtures are set
      if (fixtures && fixtures.length > 0) {
        startStreaming()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }


  const analyzeCurrentFixtures = useCallback((fixtureData: Fixture[]) => {
    const result = analyzeValueOpportunities(fixtureData, config)
    setOpportunities(result.opportunities)
    setAnalyzedFixtures(result.analyzedFixtures)
  }, [config])

  // Apply filters to opportunities
  const filteredOpportunities = useMemo(() => {
    let filtered = [...opportunities]

    // Apply date filter if present
    if (currentFilters['fixture_date'] && currentFilters['fixture_date'].size > 0) {
      const dateFilter = Array.from(currentFilters['fixture_date'])[0]
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      filtered = filtered.filter(opportunity => {
        const fixtureDate = new Date(opportunity.fixture.date)
        const fixtureDay = new Date(fixtureDate.getFullYear(), fixtureDate.getMonth(), fixtureDate.getDate())

        switch (dateFilter) {
          case 'Today':
            return fixtureDay.getTime() === today.getTime()
          case 'Tomorrow':
            return fixtureDay.getTime() === tomorrow.getTime()
          case 'Next 7 Days':
            const next7Days = new Date(today)
            next7Days.setDate(next7Days.getDate() + 7)
            return fixtureDay >= today && fixtureDay <= next7Days
          case 'Next 14 Days':
            const next14Days = new Date(today)
            next14Days.setDate(next14Days.getDate() + 14)
            return fixtureDay >= today && fixtureDay <= next14Days
          default:
            return true
        }
      })
    }

    // Apply max odds filter if present
    if (currentFilters['bookie_odds'] && currentFilters['bookie_odds'].size > 0) {
      const maxOddsValue = parseFloat(Array.from(currentFilters['bookie_odds'])[0])
      if (!isNaN(maxOddsValue)) {
        filtered = filtered.filter(opportunity => {
          // Find the bookie data for this opportunity to get the correct decimals
          const bookieData = opportunity.fixture.odds.find(o => o.bookie === opportunity.bookie)
          if (!bookieData) return true // If we can't find bookie data, keep the opportunity

          // Convert the display odds value to internal format using the bookie's decimals
          const maxOddsInternal = maxOddsValue * Math.pow(10, bookieData.decimals)
          return opportunity.oddsBookieOdds <= maxOddsInternal
        })
      }
    }

    // Apply min ratio filter if present
    if (currentFilters['ratio'] && currentFilters['ratio'].size > 0) {
      const ratioValueStr = Array.from(currentFilters['ratio'])[0]
      // Normalize comma to dot for parsing
      const normalizedValue = ratioValueStr.replace(',', '.')
      const minRatioValue = parseFloat(normalizedValue)
      if (!isNaN(minRatioValue)) {
        filtered = filtered.filter(opportunity => opportunity.ratio >= minRatioValue)
      }
    }

    return filtered
  }, [opportunities, currentFilters])

  // Get sorted opportunities
  const sortedOpportunities = useMemo(() => {
    let dataToSort = [...filteredOpportunities]

    // Handle URL-based sorting from DataTable column clicks
    if (currentSort) {
      const { key: sortKey, direction } = currentSort

      dataToSort.sort((a, b) => {
        let aValue: any, bValue: any

        switch (sortKey) {
          case 'fixture.home_team':
            aValue = a.fixture.home_team.toLowerCase()
            bValue = b.fixture.home_team.toLowerCase()
            break
          case 'fixture.away_team':
            aValue = a.fixture.away_team.toLowerCase()
            bValue = b.fixture.away_team.toLowerCase()
            break
          case 'fixture.league':
            aValue = a.fixture.league.toLowerCase()
            bValue = b.fixture.league.toLowerCase()
            break
          case 'fixture.date':
            aValue = new Date(a.fixture.date).getTime()
            bValue = new Date(b.fixture.date).getTime()
            break
          case 'ratio':
            aValue = a.ratio
            bValue = b.ratio
            break
          case 'bookie_odds':
            aValue = a.oddsBookieOdds
            bValue = b.oddsBookieOdds
            break
          case 'bookie':
            aValue = a.bookie.toLowerCase()
            bValue = b.bookie.toLowerCase()
            break
          default:
            return 0
        }

        if (aValue < bValue) return direction === 'asc' ? -1 : 1
        if (aValue > bValue) return direction === 'asc' ? 1 : -1
        return 0
      })

      return dataToSort
    }

    // Use custom sorting logic for the sort buttons
    return dataToSort.sort((a, b) => {
      if (sortBy === 'ratio') {
        return sortOrder === 'desc' ? b.ratio - a.ratio : a.ratio - b.ratio
      } else if (sortBy === 'date') {
        // Sort by fixture date
        const dateA = new Date(a.fixture.date).getTime()
        const dateB = new Date(b.fixture.date).getTime()
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB
      } else {
        // Sort by updated_at - use the bookie's updated_at for this opportunity
        const bookieOdds = a.fixture.odds.find(o => o.bookie === a.bookie)
        const updatedA = bookieOdds?.updated_at || 0

        const bookieOddsB = b.fixture.odds.find(o => o.bookie === b.bookie)
        const updatedB = bookieOddsB?.updated_at || 0

        return sortOrder === 'desc' ? updatedB - updatedA : updatedA - updatedB
      }
    })
  }, [filteredOpportunities, currentSort, sortBy, sortOrder])

  const toggleSort = (newSortBy: 'ratio' | 'date' | 'updated') => {
    if (sortBy === newSortBy) {
      // Toggle order if same sort type
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
    } else {
      // New sort type, default to descending for ratio, ascending for date, descending for updated
      setSortBy(newSortBy)
      setSortOrder(newSortBy === 'ratio' ? 'desc' : newSortBy === 'updated' ? 'desc' : 'asc')
    }
  }

  // Efficient update function - stores streaming updates in Map without recreating entire array
  const updateFixtureData = useCallback((fixtureId: string, fixtureData: any) => {
    setStreamedFixtures(prev => {
      const updated = new Map(prev)
      // Get existing update or create new one
      const existing = updated.get(fixtureId) || {}
      // Merge with new data
      updated.set(fixtureId, {
        ...existing,
        ...fixtureData,
        // Merge odds arrays if both exist
        ...(fixtureData.odds && existing.odds ? {
          odds: [...existing.odds, ...fixtureData.odds].reduce((acc: any[], current: any) => {
            const existingIndex = acc.findIndex((o: any) => o.bookie === current.bookie)
            if (existingIndex >= 0) {
              acc[existingIndex] = { ...acc[existingIndex], ...current }
            } else {
              acc.push(current)
            }
            return acc
          }, [])
        } : {})
      })
      return updated
    })
  }, [])

  const startStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    // Start odds stream listening to ALL future fixtures
    // Don't filter by fixtureId - this allows new fixtures to be discovered automatically
    const oddsUrl = new URL('/api/odds/stream', window.location.origin)
    oddsUrl.searchParams.set('fair_odds', 'true')

    const oddsEventSource = new EventSource(oddsUrl.toString())

    oddsEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)


        // Handle streaming updates
        if (data.fixture_id) {
          const fixtureId = data.fixture_id.toString()

          // Update fixture data using streamedFixtures Map (for all fixtures)
          const updateData: any = {}

          // Store stream timestamp for UPDATED column
          if (data.timestamp) {
            updateData.stream_timestamp = data.timestamp
          }

          // Update fixture data if provided
          if (data.home_team_name) {
            updateData.home_team = data.home_team_name
            updateData.away_team = data.away_team_name
            updateData.date = data.date
            updateData.league = data.league_name
          }

          // Update odds data if provided
          if (data.odds) {
            updateData.odds = data.odds
          }
          
          updateFixtureData(fixtureId, updateData)
          
          // Check if this is a new fixture we don't have yet
          setFixtures(prevFixtures => {
            const existingFixture = prevFixtures.find(f => f.fixture_id === fixtureId)

            if (!existingFixture && data.odds && data.odds.length > 0) {
              // This is a new fixture - add it to base fixtures list
              const newFixture: Fixture = {
                fixture_id: fixtureId,
                home_team: data.home_team_name || '',
                away_team: data.away_team_name || '',
                date: data.date || new Date().toISOString(),
                league: data.league_name || '',
                odds: [] // Empty initially, streamedFixtures has the actual odds
              }
              return [...prevFixtures, newFixture]
            }

            return prevFixtures
          })
        }
      } catch (error) {
        console.error('Error parsing odds streaming data:', error)
      }
    }

    oddsEventSource.onerror = (error) => {
      console.error('Odds EventSource error:', error)
    }

    oddsEventSource.onopen = () => {
      setStreaming(true)
    }

    // Store event source for cleanup
    eventSourceRef.current = oddsEventSource
  }, [updateFixtureData])

  const stopStreaming = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setStreaming(false)
    }
  }

  // Periodic backup refresh (in case stream misses anything)
  // Stream handles real-time updates, this is just a safety net
  useEffect(() => {
    const refreshFixtures = async () => {
      try {
        const response = await fetch('/api/odds?limit=3000&fair_odds=true&latest=true')
        if (response.ok) {
          const data = await response.json()
          const newFixtures = (data.fixtures as Fixture[]) || []
          setFixtures(newFixtures)
        }
      } catch (err) {
        console.error('Error refreshing fixtures:', err)
      }
    }

    // Backup refresh every 60 seconds (stream is primary source)
    const intervalId = setInterval(refreshFixtures, 60000)
    
    return () => clearInterval(intervalId)
  }, [])

  // Re-run analysis when merged fixtures or config (filters) change
  useEffect(() => {
    if (mergedFixtures.length > 0) {
      analyzeCurrentFixtures(mergedFixtures)
    }
  }, [mergedFixtures, analyzeCurrentFixtures])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming()
    }
  }, [])



  const formatOdds = (odds: number, decimals: number) => {
    return (odds / Math.pow(10, decimals)).toFixed(decimals === 2 ? 2 : 3)
  }

  const getTypeLabel = (type: string, oddsIndex?: number, line?: number) => {
    switch (type) {
      case 'x12':
        const outcomes = ['Home', 'Draw', 'Away']
        return `X12 ${outcomes[oddsIndex || 0]}`
      case 'ah':
        return `AH ${line} ${oddsIndex === 0 ? 'Away' : 'Home'}`
      case 'ou':
        return `OU ${line} ${oddsIndex === 0 ? 'Over' : 'Under'}`
      default:
        return type
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-400">Loading values...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-red-400 p-4">
        Error: {error}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 top-[57px] left-0 right-0 bottom-0 bg-black overflow-auto">
      <div className="w-full px-4">
        {/* Filter Controls */}
        <div className="mb-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {/* Fair Odds Bookie */}
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-0.5">
                  Fair Odds Bookie
                </label>
                <select
                  value={fairOddsBookie}
                  onChange={(e) => setFairOddsBookie(e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 text-white text-xs font-mono rounded focus:outline-none focus:border-blue-400"
                >
                  {fairOddsBookies.map(bookie => (
                    <option key={bookie} value={bookie}>{bookie}</option>
                  ))}
                </select>
              </div>



          </div>

          <div className="text-xs text-gray-500 mt-1 mb-1 font-mono">
            Found {filteredOpportunities.length} value opportunities from {analyzedFixtures} analyzed fixtures ({fixtures.length} total fixtures)
            {Object.keys(currentFilters).length > 0 && ` (${Object.keys(currentFilters).length} filter${Object.keys(currentFilters).length > 1 ? 's' : ''} applied)`}
          </div>
        </div>

        <DataTable
          title="VALUES"
          data={sortedOpportunities}
          getItemId={(opportunity) => `${opportunity.fixture.fixture_id}-${opportunity.bookie}-${opportunity.type}-${opportunity.oddsIndex}-${opportunity.line}`}
          emptyMessage="No value opportunities found with current filters"
          columns={valuesColumns}
          filterable={true}
          currentFilters={currentFilters}
          onFilterChange={handleFilterChange}
          onClearAllFilters={handleClearAllFilters}
          currentSort={currentSort}
          onSortChange={handleSortChange}
          filterValueApi={getFilterValueApi}
          expandable={true}
          singleExpansion={true}
          renderExpandedContent={renderExpandedContent}
          getExpandedRowClassName={() => 'bg-gray-850'}
          onRowExpand={handleRowExpand}
        />

        {/* Edit Modal */}
        {editingFixture && (
          <FixtureEditModal
            fixture={editingFixture}
            onClose={handleCloseEditModal}
            onUpdate={handleFixtureUpdated}
            onDelete={() => {
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

export default function ValuesPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 top-[57px] left-0 right-0 bottom-0 bg-black overflow-auto">
        <div className="w-full px-4">
          <div className="py-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
            <span className="ml-2 text-gray-400 text-sm font-mono">Loading values...</span>
          </div>
        </div>
      </div>
    }>
      <ValuesPageContent />
    </Suspense>
  )
}