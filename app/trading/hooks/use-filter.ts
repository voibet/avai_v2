import { useState, useCallback } from 'react'
import type { FixtureWithOdds } from '../types'

export function useFilter(ws: WebSocket | null, setFixtures: (updater: (prev: Map<number, FixtureWithOdds>) => Map<number, FixtureWithOdds>) => void, setFixturesHistory: (updater: (prev: FixtureWithOdds[]) => FixtureWithOdds[]) => void) {
  const [showFilter, setShowFilter] = useState(false)
  const [filterInput, setFilterInput] = useState('')
  const [filterError, setFilterError] = useState<string | null>(null)

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

      // Clear fixtures history when filter changes
      setFixturesHistory(() => [])
    } catch (e) {
      setFilterError('Invalid JSON')
    }
  }, [filterInput, ws, setFixtures, setFixturesHistory])

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

    // Clear fixtures history when filter is removed
    setFixturesHistory(() => [])
  }, [ws, setFixtures, setFixturesHistory])

  return {
    showFilter,
    setShowFilter,
    filterInput,
    setFilterInput,
    filterError,
    applyFilter,
    clearFilter,
  }
}
