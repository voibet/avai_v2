import { useState, useEffect, useMemo } from 'react'
import type { FixtureWithOdds } from '../types'
import { RECENT_UPDATE_WINDOW } from '../constants'

export function useComputedValues(
  fixtures: Map<number, FixtureWithOdds>,
  fixturesHistory: FixtureWithOdds[],
  selectedFixtureId: number | null
) {
  const [now, setNow] = useState(Date.now())

  // Update "now" every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

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

  return {
    now,
    sortedFixtures,
    recentlyUpdated,
    selectedFixture,
    selectedBookmakers,
  }
}
