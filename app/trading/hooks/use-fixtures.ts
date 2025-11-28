import { useState, useEffect } from 'react'
import type { FixtureWithOdds } from '../types'

export function useFixtures() {
  const [fixtures, setFixtures] = useState<Map<number, FixtureWithOdds>>(new Map())
  const [loading, setLoading] = useState(true)

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
        setLoading(false)
      } catch (error) {
        console.error('Failed to fetch fixtures:', error)
        setLoading(false)
      }
    }

    fetchFixtures()
  }, [])

  return { fixtures, setFixtures, loading }
}
