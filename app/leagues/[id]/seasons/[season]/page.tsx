'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useFixtures, useLeagueDetails } from '../../../../../lib/hooks/use-football-data'
import LoadingSpinner from '../../../../../components/ui/loading-spinner'
import ErrorMessage from '../../../../../components/ui/error-message'
import DataTable, { Column } from '../../../../../components/ui/data-table'


export default function LeagueSeasonPage() {
  const params = useParams()
  const leagueId = params.id as string
  const season = params.season as string

  // Get league details for the header
  const { data: leagueData } = useLeagueDetails(leagueId)

  // Get fixtures for this league and season
  const fixturesOptions = useMemo(() => ({
    leagueId: leagueId,
    season: season,
    page: 1,
    limit: 100
  }), [leagueId, season])

  const { data: fixturesData, loading, error } = useFixtures(fixturesOptions)

  const fixtures = fixturesData?.fixtures || []

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const seasonColumns: Column<any>[] = [
    {
      key: 'date',
      header: 'DATE',
      span: 2,
      sortType: 'date',
      render: (fixture) => (
        <div className="text-gray-400 text-xs">
          {formatDate(fixture.date)}
        </div>
      )
    },
    {
      key: 'home',
      header: 'HOME',
      span: 3,
      sortType: 'string',
      render: (fixture) => (
        <div className="truncate text-white font-bold">
          {fixture.home_team_name}
        </div>
      )
    },
    {
      key: 'score',
      header: 'SCORE',
      span: 2,
      render: (fixture) => (
        <div className="flex items-center">
          {fixture.goals_home !== null && fixture.goals_away !== null ? (
            <span className="text-green-400 font-bold">
              {fixture.goals_home}-{fixture.goals_away}
            </span>
          ) : (
            <span className="text-gray-500">-</span>
          )}
        </div>
      )
    },
    {
      key: 'away',
      header: 'AWAY',
      span: 3,
      sortType: 'string',
      render: (fixture) => (
        <div className="truncate text-gray-400">
          {fixture.away_team_name}
        </div>
      )
    },
    {
      key: 'status',
      header: 'STATUS',
      span: 2,
      sortType: 'string',
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
    }
  ]

  if (loading) {
    return <LoadingSpinner message="Loading season fixtures..." />
  }

  if (error) {
    return <ErrorMessage message={`Error loading season fixtures: ${error}`} />
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-4 py-1 border-b border-gray-600">
        <Link href={`/leagues/${leagueId}`} className="text-blue-400 hover:text-blue-300 text-xs">
          ← BACK TO LEAGUE
        </Link>
        <span className="text-gray-500 text-xs">Season Details</span>
      </div>

      {/* Season Header */}
      <div className="grid grid-cols-12 gap-1 py-1 border-b border-gray-600 bg-gray-800">
        <div className="col-span-8 text-white text-lg font-mono truncate">
          {leagueData?.league?.name || `League ${leagueId}`}
        </div>
        <div className="col-span-4 text-gray-400 text-sm font-mono text-right">
          Season {season}
        </div>
      </div>

      <DataTable
        title=""
        subtitle={`SHOWING ${fixtures.length} FIXTURES FOR SEASON ${season}`}
        data={fixtures}
        columns={seasonColumns}
        getItemId={(fixture) => fixture.id}
        getItemHref={(fixture) => `/fixtures/${fixture.id}`}
        emptyMessage="No fixtures found for this season"
        filterable={true}
      />
    </div>
  )
}
