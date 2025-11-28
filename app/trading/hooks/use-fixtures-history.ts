import { useState, useMemo } from 'react'
import type { FixtureWithOdds } from '../types'

export function useFixturesHistory() {
  const [fixturesHistory, setFixturesHistory] = useState<FixtureWithOdds[]>([])
  const [showFixturesHistory, setShowFixturesHistory] = useState(true)

  return {
    fixturesHistory,
    setFixturesHistory,
    showFixturesHistory,
    setShowFixturesHistory,
  }
}
