'use client'

import { useState, useEffect, useRef } from 'react'
import { analyzeValueOpportunities, type Fixture, type ValueOpportunity, type ValueAnalysisConfig } from '@/lib/utils/value-analysis'

export default function ValuesPage() {
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [opportunities, setOpportunities] = useState<ValueOpportunity[]>([])
  const [analyzedFixtures, setAnalyzedFixtures] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Filter states
  const [fairOddsBookie, setFairOddsBookie] = useState('Pinnacle')
  const [oddsRatioBookies, setOddsRatioBookies] = useState<string[]>(['Veikkaus'])
  const [minRatio, setMinRatio] = useState(1.03)
  const [maxOdds, setMaxOdds] = useState<number | undefined>(undefined)

  // Sorting state
  const [sortBy, setSortBy] = useState<'ratio' | 'date' | 'updated'>('ratio')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // Get available bookies from fixtures
  const availableBookies = fixtures.length > 0
    ? Array.from(new Set(fixtures.flatMap(f => f.odds.map(o => o.bookie))))
    : []

  const fairOddsBookies = availableBookies.filter(bookie =>
    fixtures.some(f => f.odds.some(o => o.bookie === bookie && (
      o.fair_odds_x12 || o.fair_odds_ah || o.fair_odds_ou
    )))
  )

  // Create config from current filter state
  const config: ValueAnalysisConfig = {
    fairOddsBookie,
    oddsRatioBookies: oddsRatioBookies.length === 1 ? oddsRatioBookies[0] : oddsRatioBookies,
    minRatio,
    maxOdds
  }

  useEffect(() => {
    fetchValues()
  }, [])

  const fetchValues = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/odds?latest=true&fair_odds=true&limit=3000')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      setFixtures(data.fixtures || [])
      analyzeCurrentFixtures(data.fixtures || [])

      // Start streaming after successful load
      if (data.fixtures && data.fixtures.length > 0) {
        startStreaming()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const analyzeCurrentFixtures = (fixtureData: Fixture[]) => {
    const result = analyzeValueOpportunities(fixtureData, config)
    setOpportunities(result.opportunities)
    setAnalyzedFixtures(result.analyzedFixtures)
  }

  // Get sorted opportunities
  const sortedOpportunities = [...opportunities].sort((a, b) => {
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

  const updateFixtureOdds = (fixtureId: string, updatedOdds: any[]) => {
    // updatedOdds is an array of bookie odds for a specific fixture
    setFixtures(currentFixtures => {
      return currentFixtures.map(fixture => {
        if (fixture.fixture_id === fixtureId) {
          // This is the fixture that needs updating
          const updatedFixture = { ...fixture }

          updatedOdds.forEach(updatedBookieOdds => {
            const existingBookieIndex = updatedFixture.odds.findIndex(o => o.bookie === updatedBookieOdds.bookie)

            if (existingBookieIndex >= 0) {
              // Update existing bookie odds
              updatedFixture.odds[existingBookieIndex] = {
                ...updatedFixture.odds[existingBookieIndex],
                ...updatedBookieOdds
              }
            } else {
              // Add new bookie odds
              updatedFixture.odds.push(updatedBookieOdds)
            }
          })

          return updatedFixture
        }
        return fixture
      })
    })
  }

  const startStreaming = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    // Get all fixture IDs from current fixtures
    const fixtureIds = fixtures.map(f => f.fixture_id).join(',')

    const url = new URL('/api/odds/stream', window.location.origin)
    url.searchParams.set('fair_odds', 'true')
    if (fixtureIds) {
      url.searchParams.set('fixtureId', fixtureIds)
    }

    const eventSource = new EventSource(url.toString())

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'odds_update' && data.fixture_id && data.odds) {
          updateFixtureOdds(data.fixture_id, data.odds)
        }
      } catch (error) {
        console.error('Error parsing streaming data:', error)
      }
    }

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error)
      setStreaming(false)
    }

    eventSource.onopen = () => {
      setStreaming(true)
    }

    eventSourceRef.current = eventSource
  }

  const stopStreaming = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setStreaming(false)
    }
  }

  // Re-run analysis when fixtures change (including streaming updates)
  useEffect(() => {
    if (fixtures.length > 0) {
      analyzeCurrentFixtures(fixtures)
    }
  }, [fixtures])

  // Re-run analysis when filters change
  useEffect(() => {
    if (fixtures.length > 0) {
      analyzeCurrentFixtures(fixtures)
    }
  }, [fairOddsBookie, oddsRatioBookies, minRatio, maxOdds])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming()
    }
  }, [])

  const handleBookieToggle = (bookie: string) => {
    setOddsRatioBookies(prev => {
      const newSelection = prev.includes(bookie)
        ? prev.filter(b => b !== bookie)
        : [...prev, bookie]

      // Ensure at least one bookie is selected
      return newSelection.length === 0 ? [bookie] : newSelection
    })
  }


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
    <div className="space-y-6">
      {/* Filter Controls */}
      <div className="bg-gray-800 p-4 rounded border border-gray-700">
        <div className="text-lg font-semibold mb-4">Value Analysis Filters</div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Fair Odds Bookie */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Fair Odds Bookie
            </label>
            <select
              value={fairOddsBookie}
              onChange={(e) => setFairOddsBookie(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
            >
              {fairOddsBookies.map(bookie => (
                <option key={bookie} value={bookie}>{bookie}</option>
              ))}
            </select>
          </div>

          {/* Odds Ratio Bookies */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Odds Ratio Bookies
            </label>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {availableBookies.filter(b => b !== fairOddsBookie).map(bookie => (
                <label key={bookie} className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={oddsRatioBookies.includes(bookie)}
                    onChange={() => handleBookieToggle(bookie)}
                    className="rounded border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{bookie}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Min Ratio */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Min Ratio
            </label>
            <input
              type="number"
              step="0.01"
              min="1.00"
              value={minRatio}
              onChange={(e) => setMinRatio(parseFloat(e.target.value) || 1.00)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Max Odds */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Max Odds (optional)
            </label>
            <input
              type="number"
              step="0.1"
              min="1.0"
              value={maxOdds || ''}
              onChange={(e) => setMaxOdds(e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="No limit"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="text-xl font-bold">VALUES - {Array.isArray(config.oddsRatioBookies) ? config.oddsRatioBookies.join(', ') : config.oddsRatioBookies} vs {config.fairOddsBookie} Fair Odds (Ratio &gt; {config.minRatio}{maxOdds ? `, Max Odds: ${maxOdds}` : ''})</div>
        {streaming && (
          <div className="flex items-center gap-1 text-sm text-green-400">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            Live
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-400">
          Found {opportunities.length} value opportunities from {analyzedFixtures} analyzed fixtures ({fixtures.length} total fixtures)
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => toggleSort('ratio')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              sortBy === 'ratio'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Highest Value {sortBy === 'ratio' && (sortOrder === 'desc' ? '↓' : '↑')}
          </button>
          <button
            onClick={() => toggleSort('date')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              sortBy === 'date'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {sortBy === 'date' && (sortOrder === 'desc' ? 'Newest' : 'Oldest')}
            {sortBy !== 'date' && 'Date'}
          </button>
          <button
            onClick={() => toggleSort('updated')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              sortBy === 'updated'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {sortBy === 'updated' && (sortOrder === 'desc' ? 'Recent' : 'Oldest')}
            {sortBy !== 'updated' && 'Updated'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {sortedOpportunities.map((opp, index) => {
          const veikkausBookie = opp.fixture.odds.find(o => o.bookie === 'Veikkaus')
          const pinnacleBookie = opp.fixture.odds.find(o => o.bookie === 'Pinnacle')
          return (
            <div key={`${opp.fixture.fixture_id}-${opp.bookie}-${opp.type}-${opp.oddsIndex}-${opp.line}`} className="bg-gray-900 p-4 rounded border border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <div className="text-sm text-gray-400">Fixture</div>
                  <div className="font-semibold">
                    {opp.fixture.home_team} vs {opp.fixture.away_team}
                  </div>
                  <div className="text-sm text-gray-400">
                    {opp.fixture.league} • {new Date(opp.fixture.date).toLocaleString()}
                  </div>
                </div>

                <div className="md:col-span-1">
                  <div className="text-sm text-gray-400">Market</div>
                  <div className="font-semibold">
                    {getTypeLabel(opp.type, opp.oddsIndex, opp.line)}
                  </div>
                  <div className="text-sm text-gray-400">Bookie: {opp.bookie}</div>
                </div>

                <div className="md:col-span-1">
                  <div className="text-sm text-gray-400">Odds & Ratio</div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>{opp.bookie}:</span>
                      <span className="font-semibold">
                        {veikkausBookie ? formatOdds(opp.oddsBookieOdds, veikkausBookie.decimals) : opp.oddsBookieOdds}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{config.fairOddsBookie} Fair:</span>
                      <span>{(opp.fairOddsBookieOdds / Math.pow(10, pinnacleBookie?.decimals || 3)).toFixed(pinnacleBookie?.decimals === 2 ? 2 : 3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Ratio:</span>
                      <span className="font-bold text-green-400">{opp.ratio.toFixed(3)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {sortedOpportunities.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            No value opportunities found with ratio &gt; 1.03
          </div>
        )}
      </div>

    </div>
  )
}