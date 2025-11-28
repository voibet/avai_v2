import { useState, useEffect } from 'react'
import { ODDS_PROCESSOR_STATS } from '../constants'

export function useStats() {
  const [stats, setStats] = useState({
    fixturesCount: 0,
    updatesReceived: 0,
    rate: 0,
    wsClients: 0,
    uptime: 0,
  })

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

  return { stats, setStats }
}
