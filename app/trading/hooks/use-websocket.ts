import { useState, useEffect } from 'react'
import type { FixtureWithOdds, WsMessage } from '../types'
import { ODDS_PROCESSOR_WS } from '../constants'
import { calculateBestOdds } from '../utils'

export function useWebSocket(fixtures: Map<number, FixtureWithOdds>, setFixtures: (updater: (prev: Map<number, FixtureWithOdds>) => Map<number, FixtureWithOdds>) => void, setFixturesHistory: (updater: (prev: FixtureWithOdds[]) => FixtureWithOdds[]) => void, loading: boolean) {
  const [connected, setConnected] = useState(false)
  const [ws, setWs] = useState<WebSocket | null>(null)

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
              return updated
            })

            // Add every update to fixtures history, moving existing fixtures to top
            setFixturesHistory(prev => {
              const existingInFixtures = fixtures.get(fixtureId)
              const existingInHistory = prev.find(f => f.id === fixtureId)


              const { bestHome, bestDraw, bestAway } = calculateBestOdds(data.bookmakers)

              // Use existing history data if available, otherwise use fixtures data
              const baseFixture = existingInHistory || existingInFixtures || {
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

              const historyFixture = {
                ...baseFixture,
                bookmakers: data.bookmakers,
                lastUpdate: data.type === 'odds_update' ? Date.now() : existingInFixtures?.lastUpdate,
                latency: data.type === 'odds_update' ? latency : existingInFixtures?.latency,
                bestHome,
                bestDraw,
                bestAway,
                filter_matches: data.filter_matches,
              }

              // Remove existing fixture if it exists, then add to top
              const existingIndex = prev.findIndex(f => f.id === fixtureId)
              let updated: FixtureWithOdds[]

              if (existingIndex !== -1) {
                // Fixture exists in history - remove it and add to front
                const withoutExisting = [...prev.slice(0, existingIndex), ...prev.slice(existingIndex + 1)]
                updated = [historyFixture, ...withoutExisting]
              } else {
                // Fixture not in history - just add to front
                updated = [historyFixture, ...prev]
              }

              // Keep only the last 100 updates in history, newest first
              return updated.slice(0, 100)
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

  return { connected, ws }
}
