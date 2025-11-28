
'use client'

import { useEffect, useState, useCallback, useMemo, memo } from 'react'

interface Fixture {
  id: number
  home_team_id: number
  home_team_name: string
  away_team_id: number
  away_team_name: string
  date: string
  league_id: number
  league_name: string
  league_country: string
  season: number
  round: string
  status_short: string
}

interface BookmakerOdds {
  bookie_id: number
  decimals: number
  x12_h: number | null
  x12_x: number | null
  x12_a: number | null
  fair_x12_h: number | null
  fair_x12_x: number | null
  fair_x12_a: number | null
  ah_lines: number[]
  ah_h: number[]
  ah_a: number[]
  fair_ah_h: number[]
  fair_ah_a: number[]
  ou_lines: number[]
  ou_o: number[]
  ou_u: number[]
  fair_ou_o: number[]
  fair_ou_u: number[]
  timestamp: number
}

interface WsMessage {
  type: string
  fixture_id: number
  timestamp: number
  start: number
  end: number
  bookmakers: Record<string, BookmakerOdds>
  filter_matches?: Array<{
    op: string
    threshold: number
    result: number
    matched: boolean
    calculation_op?: string
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
  }>
}

interface FixtureWithOdds extends Fixture {
  bookmakers?: Record<string, BookmakerOdds>
  lastUpdate?: number
  latency?: number
  bestHome?: number
  bestDraw?: number
  bestAway?: number
  filter_matches?: Array<{
    op: string
    threshold: number
    result: number
    matched: boolean
    calculation_op?: string
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
  }>
}

const ODDS_PROCESSOR_WS = 'ws://localhost:8081/ws'
const ODDS_PROCESSOR_STATS = 'http://localhost:8081/stats'
const RECENT_UPDATE_WINDOW = 60000 // 60 seconds

// Format helpers
const formatOdds = (odds: number | null | undefined): string => {
  if (odds === undefined || odds === null || odds === 0) return '-'
  return (odds / 1000).toFixed(3)
}

const formatDateShort = (dateString: string): string => {
  const date = new Date(dateString)
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

const getLatencyClass = (ms: number | undefined): string => {
  if (ms === undefined) return 'text-[#666]'
  if (ms < 1000) return 'text-[#00ff88]'
  if (ms < 2000) return 'text-[#ff9500]'
  return 'text-[#ff4444]'
}

const calculateBestOdds = (bookmakers?: Record<string, BookmakerOdds>): { bestHome: number; bestDraw: number; bestAway: number } => {
  let bestHome = 0
  let bestDraw = 0
  let bestAway = 0
  if (bookmakers) {
    for (const bookie of Object.values(bookmakers)) {
      if (bookie.x12_h && bookie.x12_h > bestHome) bestHome = bookie.x12_h
      if (bookie.x12_x && bookie.x12_x > bestDraw) bestDraw = bookie.x12_x
      if (bookie.x12_a && bookie.x12_a > bestAway) bestAway = bookie.x12_a
    }
  }
  return { bestHome, bestDraw, bestAway }
}

const parseFilterPath = (path: string): { bookmaker: string; market: string; line?: number } | null => {
  // Parse paths like: bookmakers.Monaco.x12_a, bookmakers.Pinnacle.fair_x12_a, bookmakers.Veikkaus.ah_a[-1.5]
  const match = path.match(/^bookmakers\.([^.]+)\.(.+)$/)
  if (!match) return null

  const [, bookmaker, marketPath] = match
  let market = marketPath

  // Check for array notation like ah_a[-1.5]
  const lineMatch = marketPath.match(/^(.+)\[([+-]?\d*\.?\d+)\]$/)
  if (lineMatch) {
    const [, marketName, lineStr] = lineMatch
    market = marketName
    return { bookmaker, market, line: parseFloat(lineStr) }
  }

  return { bookmaker, market }
}

const shouldHighlightOdds = (
  bookmaker: string,
  market: string,
  line?: number,
  filterMatches?: Array<{
    left_operand?: { path: string; value: number }
    right_operand?: { path: string; value: number }
  }>
): boolean => {
  if (!filterMatches) return false

  // Check if any filter match path matches this bookmaker/market/line combination
  return filterMatches.some(match => {
    const leftPath = match.left_operand?.path
    const rightPath = match.right_operand?.path

    const checkPath = (path: string) => {
      const parsed = parseFilterPath(path)
      if (!parsed) return false

      const lineMatch = parsed.line === undefined || line === undefined || Math.abs(parsed.line - line) < 0.01
      return parsed.bookmaker === bookmaker && parsed.market === market && lineMatch
    }

    return (leftPath && checkPath(leftPath)) || (rightPath && checkPath(rightPath))
  })
}

// Memoized components
const FixtureRow = memo(function FixtureRow({
  fixture,
  isSelected,
  hasRecentUpdate,
  onSelect,
}: {
  fixture: FixtureWithOdds
  isSelected: boolean
  hasRecentUpdate: boolean
  onSelect: (id: number) => void
}) {
  return (
    <div
      onClick={() => onSelect(fixture.id)}
      className={`grid grid-cols-[60px_1fr_1fr_120px_80px_80px_80px_80px] gap-1 px-2 py-1.5 cursor-pointer transition-colors ${isSelected
        ? 'bg-[#1a2a1e]'
        : hasRecentUpdate
          ? 'bg-[#1a1a2e]'
          : 'hover:bg-[#1a1a2e]/50'
        }`}
    >
      <div className="text-[#00ff88] font-semibold">#{fixture.id}</div>
      <div className="truncate text-white">{fixture.home_team_name}</div>
      <div className="truncate text-white">{fixture.away_team_name}</div>
      <div className="truncate text-[#666] text-[9px]">{fixture.league_name}</div>
      <div className="text-center text-[#888]">{fixture.date ? formatDateShort(fixture.date) : '-'}</div>
      <div className={`text-center font-semibold ${fixture.bestHome ? 'text-white' : 'text-[#666]'}`}>
        {fixture.bestHome ? formatOdds(fixture.bestHome) : '-'}
      </div>
      <div className={`text-center font-semibold ${fixture.bestDraw ? 'text-white' : 'text-[#666]'}`}>
        {fixture.bestDraw ? formatOdds(fixture.bestDraw) : '-'}
      </div>
      <div className={`text-center font-semibold ${fixture.bestAway ? 'text-white' : 'text-[#666]'}`}>
        {fixture.bestAway ? formatOdds(fixture.bestAway) : '-'}
      </div>
    </div>
  )
})

const RecentUpdateItem = memo(function RecentUpdateItem({
  fixture,
  isSelected,
  onSelect,
}: {
  fixture: FixtureWithOdds
  isSelected: boolean
  onSelect: (id: number) => void
}) {
  const bookieNames = fixture.bookmakers ? Object.keys(fixture.bookmakers).join(', ') : 'No odds'

  return (
    <div
      onClick={() => onSelect(fixture.id)}
      className={`p-1.5 rounded cursor-pointer border-l-2 transition-colors ${isSelected
        ? 'bg-[#1a2a1e] border-l-[#00ff88]'
        : 'border-transparent hover:bg-[#1a1a2e]'
        }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[#00ff88] font-semibold">#{fixture.id}</span>
        <span className={`text-[9px] ${getLatencyClass(fixture.latency)}`}>
          {fixture.latency !== undefined ? `${fixture.latency}ms` : '-'}
        </span>
      </div>
      <div className="text-[10px] text-white truncate">
        {fixture.home_team_name} vs {fixture.away_team_name}
      </div>
      <div className="text-[#666] text-[9px] truncate">{bookieNames}</div>
    </div>
  )
})

const FixturesHistoryItem = memo(function FixturesHistoryItem({
  fixture,
  isSelected,
  onSelect,
  now,
}: {
  fixture: FixtureWithOdds
  isSelected: boolean
  onSelect: (id: number) => void
  now: number
}) {
  const bookieNames = fixture.bookmakers ? Object.keys(fixture.bookmakers).join(', ') : 'No odds'
  const timeSinceUpdate = fixture.lastUpdate ? now - fixture.lastUpdate : null
  const timeAgo = timeSinceUpdate ? formatUptime(Math.floor(timeSinceUpdate / 1000)) : '-'

  return (
    <div
      onClick={() => onSelect(fixture.id)}
      className={`p-1.5 rounded cursor-pointer border-l-2 transition-colors ${isSelected
        ? 'bg-[#1a2a1e] border-l-[#00ff88]'
        : 'border-transparent hover:bg-[#1a1a2e]'
        }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[#00ff88] font-semibold">#{fixture.id}</span>
        <span className="text-[#888] text-[9px]">{timeAgo}</span>
      </div>
      <div className="text-[10px] text-white truncate">
        {fixture.home_team_name} vs {fixture.away_team_name}
      </div>
      <div className="text-[#666] text-[9px] truncate">{bookieNames}</div>
    </div>
  )
})

export default function TradingPage() {
  // State
  const [fixtures, setFixtures] = useState<Map<number, FixtureWithOdds>>(new Map())
  const [fixturesHistory, setFixturesHistory] = useState<FixtureWithOdds[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  // Filter state
  const [showFilter, setShowFilter] = useState(false)
  const [filterInput, setFilterInput] = useState('')
  const [filterError, setFilterError] = useState<string | null>(null)

  // Expandable sections state
  const [showFixturesHistory, setShowFixturesHistory] = useState(true)
  const [showRecentUpdates, setShowRecentUpdates] = useState(true)

  // Stats
  const [stats, setStats] = useState({
    fixturesCount: 0,
    updatesReceived: 0,
    rate: 0,
    wsClients: 0,
    uptime: 0,
  })

  // WebSocket ref
  const [ws, setWs] = useState<WebSocket | null>(null)

  // Load initial fixtures
  useEffect(() => {
    const fetchFixtures = async () => {
      try {
        const response = await fetch('/api/fixtures?status_short=NS&limit=1000&sort_by=date&sort_direction=asc')
        const data = await response.json()

        const fixturesMap = new Map<number, FixtureWithOdds>()
        if (data.data && Array.isArray(data.data)) {
          for (const fixture of data.data) {
            const fixtureId = typeof fixture.id === 'string' ? parseInt(fixture.id, 10) : Number(fixture.id)
            fixturesMap.set(fixtureId, { ...fixture, id: fixtureId })
          }
        }

        setFixtures(fixturesMap)
        setStats(prev => ({ ...prev, fixturesCount: fixturesMap.size }))
        setLoading(false)
      } catch (error) {
        console.error('Failed to fetch fixtures:', error)
        setLoading(false)
      }
    }

    fetchFixtures()
  }, [])

  // Update "now" every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket connection
  useEffect(() => {
    if (loading) return

    const connect = () => {
      const websocket = new WebSocket(ODDS_PROCESSOR_WS)

      websocket.onopen = () => {
        setConnected(true)
        setWs(websocket)
      }

      websocket.onclose = () => {
        setConnected(false)
        setWs(null)
        setTimeout(connect, 2000)
      }

      websocket.onerror = () => { }

      websocket.onmessage = (event) => {
        try {
          const data: WsMessage = JSON.parse(event.data)

          if ((data.type === 'odds_update' || data.type === 'odds_snapshot') && data.fixture_id) {
            const msgTime = Date.now()
            const latency = data.start ? msgTime - data.start : undefined
            const fixtureId = typeof data.fixture_id === 'string'
              ? parseInt(data.fixture_id, 10)
              : Number(data.fixture_id)

            setFixtures(prev => {
              const existing = prev.get(fixtureId)

              // Create minimal fixture for snapshots if needed
              const baseFixture = existing || {
                id: fixtureId,
                home_team_id: 0,
                home_team_name: 'Unknown',
                away_team_id: 0,
                away_team_name: 'Unknown',
                date: new Date().toISOString(),
                league_id: 0,
                league_name: 'Unknown',
                league_country: '',
                season: 0,
                round: '',
                status_short: 'NS',
              }

              const { bestHome, bestDraw, bestAway } = calculateBestOdds(data.bookmakers)

              const updatedFixture = {
                ...baseFixture,
                bookmakers: data.bookmakers,
                lastUpdate: data.type === 'odds_update' ? msgTime : existing?.lastUpdate,
                latency: data.type === 'odds_update' ? latency : existing?.latency,
                bestHome,
                bestDraw,
                bestAway,
                filter_matches: data.filter_matches,
              }

              const updated = new Map(prev)
              updated.set(fixtureId, updatedFixture)

              // Add to fixtures history (last 50 processed fixtures)
              setFixturesHistory(prev => {
                const newHistory = [updatedFixture, ...prev.filter(f => f.id !== fixtureId)]
                return newHistory.slice(0, 50)
              })

              return updated
            })
          } else if (data.type === 'odds_removed' && data.fixture_id) {
            const fixtureId = typeof data.fixture_id === 'string'
              ? parseInt(data.fixture_id, 10)
              : Number(data.fixture_id)

            setFixtures(prev => {
              const existing = prev.get(fixtureId)

              if (existing) {
                // Clear odds but keep metadata
                const updatedFixture = {
                  ...existing,
                  bookmakers: undefined,
                  lastUpdate: undefined,
                  filter_matches: undefined,
                  bestHome: undefined,
                  bestDraw: undefined,
                  bestAway: undefined,
                }

                const updated = new Map(prev)
                updated.set(fixtureId, updatedFixture)
                return updated
              }

              return prev
            })
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    connect()

    return () => {
      if (ws) {
        ws.close()
      }
    }
  }, [loading])

  // Fetch stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(ODDS_PROCESSOR_STATS)
        const data = await res.json()
        setStats(prev => ({
          ...prev,
          fixturesCount: data.fixtures_count || prev.fixturesCount,
          updatesReceived: data.updates_received || 0,
          rate: data.updates_per_second || 0,
          wsClients: data.ws_clients || 0,
          uptime: data.uptime_seconds || 0,
        }))
      } catch {
        // Stats endpoint not available
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 1000)
    return () => clearInterval(interval)
  }, [])

  // Filter handlers
  const applyFilter = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setFilterError('Not connected to server')
      return
    }

    try {
      const filter = JSON.parse(filterInput)
      ws.send(JSON.stringify({
        type: 'subscribe',
        filter
      }))
      setFilterError(null)

      // Clear odds from all fixtures
      setFixtures(prev => {
        const updated = new Map(prev)
        updated.forEach((fixture, id) => {
          updated.set(id, {
            ...fixture,
            bookmakers: undefined,
            lastUpdate: undefined,
            latency: undefined,
            bestHome: undefined,
            bestDraw: undefined,
            bestAway: undefined,
          })
        })
        return updated
      })
    } catch (e) {
      setFilterError('Invalid JSON')
    }
  }, [filterInput, ws])

  const clearFilter = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return
    }

    ws.send(JSON.stringify({
      type: 'remove_filter'
    }))
    setFilterInput('')
    setFilterError(null)

    // Clear odds from all fixtures
    setFixtures(prev => {
      const updated = new Map(prev)
      updated.forEach((fixture, id) => {
        updated.set(id, {
          ...fixture,
          bookmakers: undefined,
          lastUpdate: undefined,
          latency: undefined,
          bestHome: undefined,
          bestAway: undefined,
        })
      })
      return updated
    })
  }, [ws])

  // Computed values
  const sortedFixtures = useMemo(() => {
    return Array.from(fixtures.values())
      .filter(f => f.bookmakers && Object.keys(f.bookmakers).length > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [fixtures])

  const recentlyUpdated = useMemo(() => {
    const cutoff = now - RECENT_UPDATE_WINDOW
    return sortedFixtures
      .filter(f => f.lastUpdate && f.lastUpdate > cutoff)
      .sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0))
      .slice(0, 50)
  }, [sortedFixtures, now])

  const selectedFixture = useMemo(() => {
    if (!selectedFixtureId) return null

    // First try to get from active fixtures
    const activeFixture = fixtures.get(selectedFixtureId)
    if (activeFixture?.bookmakers) {
      return activeFixture
    }

    // If not in active fixtures or no bookmakers, try fixtures history
    const historyFixture = fixturesHistory.find(f => f.id === selectedFixtureId)
    return historyFixture || activeFixture
  }, [fixtures, fixturesHistory, selectedFixtureId])

  const selectedBookmakers = useMemo(() =>
    selectedFixture?.bookmakers
      ? Object.entries(selectedFixture.bookmakers).sort(([a], [b]) => {
          // Put "Prediction" last if it exists
          if (a === 'Prediction') return 1
          if (b === 'Prediction') return -1
          return 0
        })
      : []
    , [selectedFixture])

  return (
    <div className="fixed inset-0 top-10 bg-[#0a0a0f] text-[#e0e0e0] font-mono text-[11px] overflow-hidden p-3">
      {/* Header */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#1a1a2e]">
      </div>

      {/* Stats Row */}
      <div className="flex gap-3 flex-wrap mb-3 p-2.5 bg-[#12121a] rounded">
        <div className="flex gap-1 items-center">
          <span className="text-[#666]">Status:</span>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[#00ff88]' : 'bg-[#ff4444]'}`} />
            <span className="text-[#00ff88] font-semibold text-[10px]">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
        <div className="flex gap-1">
          <span className="text-[#666]">Fixtures:</span>
          <span className="text-[#00ff88] font-semibold">{stats.fixturesCount}</span>
        </div>
        <div className="flex gap-1">
          <span className="text-[#666]">Updates:</span>
          <span className="text-[#00ff88] font-semibold">{stats.updatesReceived}</span>
        </div>
        <div className="flex gap-1">
          <span className="text-[#666]">Rate:</span>
          <span className="text-[#00ff88] font-semibold">{stats.rate.toFixed(1)}/s</span>
        </div>
        <div className="flex gap-1">
          <span className="text-[#666]">Clients:</span>
          <span className="text-[#00ff88] font-semibold">{stats.wsClients}</span>
        </div>
        <div className="flex gap-1">
          <span className="text-[#666]">Uptime:</span>
          <span className="text-[#00ff88] font-semibold">{formatUptime(stats.uptime)}</span>
        </div>
        <div className="flex gap-1">
          <span className="text-[#666]">Active Fixtures:</span>
          <span className="text-[#00ff88] font-semibold">{recentlyUpdated.length}</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid gap-3 h-[calc(100vh-120px)]"
           style={{
             gridTemplateColumns: '280px 1fr 320px',
             gridTemplateRows: '1fr 2fr',
             gridTemplateAreas: `
               "filters fixtures details"
               "filters odds details"
             `
           }}>
        {/* Left Panel: Filter & Recent Updates */}
        <div className="bg-[#12121a] rounded overflow-hidden flex flex-col"
             style={{ gridArea: 'filters' }}>
          {/* Filter Section */}
          <div className="border-b border-[#1a1a2e]">
            <div
              className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold flex justify-between items-center cursor-pointer hover:bg-[#252540] transition-colors"
              onClick={() => setShowFilter(!showFilter)}
            >
              <div className="flex items-center gap-2">
                <span>Filter Configuration</span>
                {filterError && <span className="text-[#ff4444] text-[9px]">({filterError})</span>}
              </div>
              <span>{showFilter ? '▼' : '▶'}</span>
            </div>

            {showFilter && (
              <div className="p-2 bg-[#0a0a0f]">
                <div className="flex gap-1 mb-2">
                  <button
                    onClick={() => setFilterInput(JSON.stringify({
                      "or": [
                        {
                          "field": {
                            "op": "divide",
                            "left": "bookmakers.Veikkaus.x12",
                            "right": "bookmakers.Pinnacle.fair_x12"
                          },
                          "op": "gt",
                          "value": 1.03
                        },
                        {
                          "field": {
                            "op": "divide",
                            "left": "bookmakers.Veikkaus.ah",
                            "right": "bookmakers.Pinnacle.fair_ah"
                          },
                          "op": "gt",
                          "value": 1.03
                        },
                        {
                          "field": {
                            "op": "divide",
                            "left": "bookmakers.Veikkaus.ou",
                            "right": "bookmakers.Pinnacle.fair_ou"
                          },
                          "op": "gt",
                          "value": 1.03
                        }
                      ]
                    }, null, 2))}
                    className="px-2 py-1 bg-[#1a1a2e] text-[#00ff88] rounded text-[9px] hover:bg-[#252540] border border-[#00ff88]/20"
                  >
                    🔥 Value
                  </button>
                  <button
                    onClick={() => setFilterInput(JSON.stringify({
                      "or": [
                        {
                          "and": [
                            {
                              "function": "max",
                              "source": ["bookmakers.Veikkaus.x12_h", "bookmakers.Pinnacle.x12_h", "bookmakers.Monaco.x12_h", "bookmakers.Betfair.x12_h"],
                              "as": "max_h"
                            },
                            {
                              "function": "max",
                              "source": ["bookmakers.Veikkaus.x12_x", "bookmakers.Pinnacle.x12_x", "bookmakers.Monaco.x12_x", "bookmakers.Betfair.x12_x"],
                              "as": "max_x"
                            },
                            {
                              "function": "max",
                              "source": ["bookmakers.Veikkaus.x12_a", "bookmakers.Pinnacle.x12_a", "bookmakers.Monaco.x12_a", "bookmakers.Betfair.x12_a"],
                              "as": "max_a"
                            },
                            {
                              "field": {
                                "op": "add",
                                "left": {
                                  "op": "add",
                                  "left": { "op": "divide", "left": 1000000, "right": "$max_h" },
                                  "right": { "op": "divide", "left": 1000000, "right": "$max_x" }
                                },
                                "right": { "op": "divide", "left": 1000000, "right": "$max_a" }
                              },
                              "op": "lt",
                              "value": 1000
                            }
                          ]
                        },
                        {
                          "and": [
                            {
                              "function": "max_per_line",
                              "source": ["bookmakers.Veikkaus.ah_h", "bookmakers.Pinnacle.ah_h", "bookmakers.Monaco.ah_h", "bookmakers.Betfair.ah_h"],
                              "as": "max_ah_h"
                            },
                            {
                              "function": "max_per_line",
                              "source": ["bookmakers.Veikkaus.ah_a", "bookmakers.Pinnacle.ah_a", "bookmakers.Monaco.ah_a", "bookmakers.Betfair.ah_a"],
                              "as": "max_ah_a"
                            },
                            {
                              "field": {
                                "op": "add",
                                "left": { "op": "divide", "left": 1000000, "right": "$max_ah_h" },
                                "right": { "op": "divide", "left": 1000000, "right": "$max_ah_a" }
                              },
                              "op": "lt",
                              "value": 1000
                            }
                          ]
                        },
                        {
                          "and": [
                            {
                              "function": "max_per_line",
                              "source": ["bookmakers.Veikkaus.ou_o", "bookmakers.Pinnacle.ou_o", "bookmakers.Monaco.ou_o", "bookmakers.Betfair.ou_o"],
                              "as": "max_ou_o"
                            },
                            {
                              "function": "max_per_line",
                              "source": ["bookmakers.Veikkaus.ou_u", "bookmakers.Pinnacle.ou_u", "bookmakers.Monaco.ou_u", "bookmakers.Betfair.ou_u"],
                              "as": "max_ou_u"
                            },
                            {
                              "field": {
                                "op": "add",
                                "left": { "op": "divide", "left": 1000000, "right": "$max_ou_o" },
                                "right": { "op": "divide", "left": 1000000, "right": "$max_ou_u" }
                              },
                              "op": "lt",
                              "value": 1000
                            }
                          ]
                        }
                      ]
                    }, null, 2))}
                    className="px-2 py-1 bg-[#1a1a2e] text-[#ff9500] rounded text-[9px] hover:bg-[#252540] border border-[#ff9500]/20"
                  >
                    ⚡ Arb
                  </button>
                </div>

                <textarea
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  className="w-full h-64 bg-[#12121a] border border-[#1a1a2e] rounded p-2 text-[#e0e0e0] font-mono text-[9px] focus:border-[#00ff88] outline-none mb-2 resize-y"
                  placeholder="Enter filter JSON..."
                  spellCheck={false}
                />

                <div className="flex gap-2">
                  <button
                    onClick={applyFilter}
                    className="flex-1 py-1.5 bg-[#00ff88] text-[#0a0a0f] rounded text-[10px] font-bold hover:bg-[#00cc6a] transition-colors"
                  >
                    Apply Filter
                  </button>
                  <button
                    onClick={clearFilter}
                    className="flex-1 py-1.5 bg-[#1a1a2e] text-white rounded text-[10px] font-medium hover:bg-[#252540] transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Fixtures History Section */}
          <div className="border-b border-[#1a1a2e]">
            <div
              className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold flex justify-between items-center cursor-pointer hover:bg-[#252540] transition-colors shrink-0"
              onClick={() => setShowFixturesHistory(!showFixturesHistory)}
            >
              <div className="flex items-center gap-2">
                <span>Fixtures History</span>
                <span className="text-[#666]">({fixturesHistory.length})</span>
              </div>
              <span>{showFixturesHistory ? '▼' : '▶'}</span>
            </div>

            {showFixturesHistory && (
              <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-64">
                {loading ? (
                  <div className="text-center py-4 text-[#666]">Loading...</div>
                ) : fixturesHistory.length === 0 ? (
                  <div className="text-center py-4 text-[#666]">No fixtures processed yet...</div>
                ) : (
                  fixturesHistory.map(fixture => (
                    <FixturesHistoryItem
                      key={fixture.id}
                      fixture={fixture}
                      isSelected={selectedFixtureId === fixture.id}
                      onSelect={setSelectedFixtureId}
                      now={now}
                    />
                  ))
                )}
              </div>
            )}
          </div>


          <div
            className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold flex justify-between items-center cursor-pointer hover:bg-[#252540] transition-colors shrink-0"
            onClick={() => setShowRecentUpdates(!showRecentUpdates)}
          >
            <div className="flex items-center gap-2">
              <span>Recent Updates</span>
              <span className="text-[#666]">({recentlyUpdated.length})</span>
            </div>
            <span>{showRecentUpdates ? '▼' : '▶'}</span>
          </div>

          {showRecentUpdates && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="text-center py-4 text-[#666]">Loading...</div>
              ) : recentlyUpdated.length === 0 ? (
                <div className="text-center py-4 text-[#666]">Waiting for updates...</div>
              ) : (
                recentlyUpdated.map(fixture => (
                  <RecentUpdateItem
                    key={fixture.id}
                    fixture={fixture}
                    isSelected={selectedFixtureId === fixture.id}
                    onSelect={setSelectedFixtureId}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Center Panel: All Fixtures */}
        <div className="bg-[#12121a] rounded overflow-hidden flex flex-col"
             style={{ gridArea: 'fixtures' }}>
          <div className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold flex justify-between shrink-0">
            <span>All Fixtures</span>
            <span>{sortedFixtures.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Table Header */}
            <div className="grid grid-cols-[60px_1fr_1fr_120px_80px_80px_80px_80px] gap-1 px-2 py-1.5 bg-[#1a1a2e] text-[9px] font-semibold text-[#888] sticky top-0 z-10">
              <div>ID</div>
              <div>HOME</div>
              <div>AWAY</div>
              <div>LEAGUE</div>
              <div className="text-center">TIME</div>
              <div className="text-center">1</div>
              <div className="text-center">X</div>
              <div className="text-center">2</div>
            </div>

            {loading ? (
              <div className="text-center py-8 text-[#666]">Loading fixtures...</div>
            ) : (
              <div className="divide-y divide-[#1a1a2e]">
                {sortedFixtures.map(fixture => (
                  <FixtureRow
                    key={fixture.id}
                    fixture={fixture}
                    isSelected={selectedFixtureId === fixture.id}
                    hasRecentUpdate={!!(fixture.lastUpdate && (now - fixture.lastUpdate) < 5000)}
                    onSelect={setSelectedFixtureId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Selected Fixture Odds Container */}
        {selectedFixture && selectedBookmakers.length > 0 && (
          <div className="bg-[#12121a] rounded overflow-hidden flex flex-col h-full"
               style={{ gridArea: 'odds' }}>
            <div className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold shrink-0">
              <span>Selected Fixture Odds</span>
              <span className="ml-2 text-[#00ff88]">#{selectedFixture.id}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {/* 1X2 Odds Table */}
              {selectedBookmakers.some(([_, odds]) => odds.x12_h || odds.x12_x || odds.x12_a) && (
                <div className="bg-[#0a0a0f] rounded p-2">
                  <div className="text-[#ff9500] text-[9px] font-semibold uppercase">1X2 Odds</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[9px] font-mono border-separate border-spacing-0">
                      <thead>
                        <tr className="bg-transparent">
                          <th className="px-1 py-0 text-left text-[#666] font-bold uppercase"></th>
                          {selectedBookmakers.map(([bookie]) => (
                            <th key={bookie} className={`px-1 py-0 text-center min-w-[45px] font-bold uppercase text-[8px] ${bookie === 'Prediction' ? 'text-[#444]' : 'text-[#666]'}`}>
                              {bookie}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {['Home', 'Draw', 'Away'].map((outcome, idx) => {
                          // Check if any bookmaker has odds for this outcome
                          const hasAnyOdds = selectedBookmakers.some(([bookie, odds]) => {
                            const value = idx === 0 ? odds.x12_h : idx === 1 ? odds.x12_x : odds.x12_a
                            return value && value > 0
                          })

                          if (!hasAnyOdds) return null

                          return (
                            <tr key={outcome}>
                              <td className="px-1 py-0 text-[#888] font-medium">{outcome}</td>
                              {selectedBookmakers.map(([bookie, odds]) => {
                                const value = idx === 0 ? odds.x12_h : idx === 1 ? odds.x12_x : odds.x12_a
                                const fairValue = idx === 0 ? odds.fair_x12_h : idx === 1 ? odds.fair_x12_x : odds.fair_x12_a
                                const market = idx === 0 ? 'x12_h' : idx === 1 ? 'x12_x' : 'x12_a'
                                const isHighlighted = shouldHighlightOdds(bookie, market, undefined, selectedFixture.filter_matches)
                                const fairMarket = idx === 0 ? 'fair_x12_h' : idx === 1 ? 'fair_x12_x' : 'fair_x12_a'
                                const fairHighlighted = shouldHighlightOdds(bookie, fairMarket, undefined, selectedFixture.filter_matches)
                                return (
                                  <td key={bookie} className="p-0 text-center">
                                    {value ? (
                                    <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                      <div className="text-white font-medium">{formatOdds(value)}</div>
                                      {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                    </div>
                                    ) : (
                                      <div className="text-[#444]">-</div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Asian Handicap - Combined Home/Away */}
              {(() => {
                // Get all unique AH lines
                const allAhLines = new Set<number>()
                selectedBookmakers.forEach(([_, odds]) => {
                  if (odds.ah_lines && Array.isArray(odds.ah_lines)) {
                    odds.ah_lines.forEach(line => allAhLines.add(line))
                  }
                })
                const sortedAhLines = Array.from(allAhLines).sort((a, b) => a - b)

                // Filter lines where at least one bookmaker has both home and away odds
                const linesWithData = sortedAhLines.filter(line =>
                  selectedBookmakers.some(([bookie, odds]) => {
                    const lineIdx = odds.ah_lines?.indexOf(line)
                    if (lineIdx === undefined || lineIdx < 0) return false

                    const homeOdds = odds.ah_h?.[lineIdx]
                    const awayOdds = odds.ah_a?.[lineIdx]

                    return homeOdds && homeOdds > 0 && awayOdds && awayOdds > 0
                  })
                )

                if (linesWithData.length === 0) return null

                return (
                  <div className="bg-[#0a0a0f] rounded p-2">
                    <div className="text-[#ff9500] text-[9px] font-semibold uppercase">Asian Handicap</div>
                    <div className="overflow-x-auto max-h-68 overflow-y-auto">
                      <table className="w-full text-[9px] font-mono border-separate border-spacing-0">
                        <thead className="sticky top-0 bg-[#0a0a0f]">
                          <tr className="bg-transparent">
                            <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Home</th>
                            {selectedBookmakers.map(([bookie]) => (
                              <th key={`home-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                                {bookie}
                              </th>
                            ))}
                            <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Away</th>
                            {selectedBookmakers.map(([bookie]) => (
                              <th key={`away-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                                {bookie}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linesWithData.map(line => (
                            <tr key={line}>
                              {/* Home side */}
                              <td className="px-1 py-0 text-[#888] font-medium">
                                {line > 0 ? `+${line.toFixed(2)}` : line.toFixed(2)}
                              </td>
                              {selectedBookmakers.map(([bookie, odds]) => {
                                const lineIdx = odds.ah_lines?.indexOf(line)
                                const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ah_h?.[lineIdx] : null
                                const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ah_h?.[lineIdx] : null
                                const isHighlighted = shouldHighlightOdds(bookie, 'ah_h', line, selectedFixture.filter_matches)
                                const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ah_h', line, selectedFixture.filter_matches)
                                return (
                                  <td key={`home-${bookie}`} className="p-0 text-center">
                                    {value ? (
                                      <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                        <div className="text-white font-medium">{formatOdds(value)}</div>
                                        {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                      </div>
                                    ) : (
                                      <div className="text-[#444]">-</div>
                                    )}
                                  </td>
                                )
                              })}

                              {/* Away side */}
                              <td className="px-1 py-0 text-[#888] font-medium">
                                {line < 0 ? `+${Math.abs(line).toFixed(2)}` : line === 0 ? line.toFixed(2) : `-${line.toFixed(2)}`}
                              </td>
                              {selectedBookmakers.map(([bookie, odds]) => {
                                const lineIdx = odds.ah_lines?.indexOf(line)
                                const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ah_a?.[lineIdx] : null
                                const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ah_a?.[lineIdx] : null
                                const isHighlighted = shouldHighlightOdds(bookie, 'ah_a', line, selectedFixture.filter_matches)
                                const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ah_a', line, selectedFixture.filter_matches)
                                return (
                                  <td key={`away-${bookie}`} className="p-0 text-center">
                                    {value ? (
                                      <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                        <div className="text-white font-medium">{formatOdds(value)}</div>
                                        {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                      </div>
                                    ) : (
                                      <div className="text-[#444]">-</div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Over/Under - Combined Over/Under */}
              {(() => {
                // Get all unique OU lines
                const allOuLines = new Set<number>()
                selectedBookmakers.forEach(([_, odds]) => {
                  if (odds.ou_lines && Array.isArray(odds.ou_lines)) {
                    odds.ou_lines.forEach(line => allOuLines.add(line))
                  }
                })
                const sortedOuLines = Array.from(allOuLines).sort((a, b) => a - b)

                // Filter lines where at least one bookmaker has both over and under odds
                const linesWithData = sortedOuLines.filter(line =>
                  selectedBookmakers.some(([bookie, odds]) => {
                    const lineIdx = odds.ou_lines?.indexOf(line)
                    if (lineIdx === undefined || lineIdx < 0) return false

                    const overOdds = odds.ou_o?.[lineIdx]
                    const underOdds = odds.ou_u?.[lineIdx]

                    return overOdds && overOdds > 0 && underOdds && underOdds > 0
                  })
                )

                if (linesWithData.length === 0) return null

                return (
                  <div className="bg-[#0a0a0f] rounded p-2">
                    <div className="text-[#ff9500] text-[9px] font-semibold uppercase">Over/Under</div>
                    <div className="overflow-x-auto max-h-68 overflow-y-auto">
                      <table className="w-full text-[9px] font-mono border-separate border-spacing-0">
                        <thead className="sticky top-0 bg-[#0a0a0f]">
                          <tr className="bg-transparent">
                            <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Over</th>
                            {selectedBookmakers.map(([bookie]) => (
                              <th key={`over-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                                {bookie}
                              </th>
                            ))}
                            <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Under</th>
                            {selectedBookmakers.map(([bookie]) => (
                              <th key={`under-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                                {bookie}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linesWithData.map(line => (
                            <tr key={line}>
                              {/* Over side */}
                              <td className="px-1 py-0 text-[#888] font-medium">
                                O {line.toFixed(2)}
                              </td>
                              {selectedBookmakers.map(([bookie, odds]) => {
                                const lineIdx = odds.ou_lines?.indexOf(line)
                                const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ou_o?.[lineIdx] : null
                                const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ou_o?.[lineIdx] : null
                                const isHighlighted = shouldHighlightOdds(bookie, 'ou_o', line, selectedFixture.filter_matches)
                                const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ou_o', line, selectedFixture.filter_matches)
                                return (
                                  <td key={`over-${bookie}`} className="p-0 text-center">
                                    {value ? (
                                      <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                        <div className="text-white font-medium">{formatOdds(value)}</div>
                                        {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                      </div>
                                    ) : (
                                      <div className="text-[#444]">-</div>
                                    )}
                                  </td>
                                )
                              })}

                              {/* Under side */}
                              <td className="px-1 py-0 text-[#888] font-medium">
                                U {line.toFixed(2)}
                              </td>
                              {selectedBookmakers.map(([bookie, odds]) => {
                                const lineIdx = odds.ou_lines?.indexOf(line)
                                const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ou_u?.[lineIdx] : null
                                const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ou_u?.[lineIdx] : null
                                const isHighlighted = shouldHighlightOdds(bookie, 'ou_u', line, selectedFixture.filter_matches)
                                const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ou_u', line, selectedFixture.filter_matches)
                                return (
                                  <td key={`under-${bookie}`} className="p-0 text-center">
                                    {value ? (
                                      <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                        <div className="text-white font-medium">{formatOdds(value)}</div>
                                        {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                      </div>
                                    ) : (
                                      <div className="text-[#444]">-</div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* Right Panel: Selected Fixture Details */}
        <div className="bg-[#12121a] rounded overflow-hidden flex flex-col"
             style={{ gridArea: 'details' }}>
          <div className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold shrink-0">
            <span>Fixture Details</span>
            {selectedFixture && (
              <span className="ml-2 text-[#00ff88]">#{selectedFixture.id}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {!selectedFixture ? (
              <div className="text-center py-8 text-[#666]">Select a fixture</div>
            ) : (
              <div className="space-y-2">
                {/* Match Info */}
                <div className="bg-[#0a0a0f] rounded p-2">
                  <div className="text-[#ff9500] text-[9px] font-semibold uppercase mb-1">Match Info</div>
                  <div className="space-y-1 text-[9px]">
                    <div className="flex justify-between">
                      <span className="text-[#666]">Home:</span>
                      <span className="text-white font-semibold">{selectedFixture.home_team_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#666]">Away:</span>
                      <span className="text-white font-semibold">{selectedFixture.away_team_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#666]">League:</span>
                      <span className="text-[#888]">{selectedFixture.league_name || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#666]">Date:</span>
                      <span className="text-[#888]">{selectedFixture.date ? new Date(selectedFixture.date).toLocaleString() : '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#666]">Latency:</span>
                      <span className={getLatencyClass(selectedFixture.latency)}>
                        {selectedFixture.latency !== undefined ? `${selectedFixture.latency}ms` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Filter Matches - Why this fixture was shown */}
                {selectedFixture.filter_matches && selectedFixture.filter_matches.length > 0 && (
                  <div className="bg-[#0a0a0f] rounded p-2 border border-[#00ff88]/20">
                    <div className="text-[#00ff88] text-[9px] font-semibold uppercase mb-1">Filter Matches</div>
                    <div className="space-y-1">
                      {selectedFixture.filter_matches.map((match, idx) => (
                        <div key={idx} className="bg-[#12121a] rounded p-1.5 border-l-2 border-[#00ff88]">
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="text-[#00ff88] font-bold text-[8px]">
                              {match.calculation_op?.toUpperCase() || match.op.toUpperCase()}
                            </span>
                            <span className="text-white font-mono text-[9px]">
                              {match.result.toFixed(4)}
                            </span>
                            <span className="text-[#888] text-[8px]">
                              {match.op} {match.threshold}
                            </span>
                            <span className="text-[#00ff88] text-[8px]">✓</span>
                          </div>
                          {match.left_operand && (
                            <div className="text-[8px] font-mono space-y-0.5">
                              <div className="flex gap-1">
                                <span className="text-[#2196F3] truncate">{match.left_operand.path}</span>
                                <span className="text-white">= {formatOdds(match.left_operand.value)}</span>
                              </div>
                              {match.right_operand && (
                                <div className="flex gap-1">
                                  <span className="text-[#9C27B0] truncate">{match.right_operand.path}</span>
                                  <span className="text-white">= {formatOdds(match.right_operand.value)}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom scrollbar styles */}
      <style jsx global>{`
        .overflow-y-auto::-webkit-scrollbar {
          width: 4px;
        }
        .overflow-y-auto::-webkit-scrollbar-track {
          background: #0a0a0f;
        }
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 2px;
        }
      `}</style>
    </div>
  )
}
