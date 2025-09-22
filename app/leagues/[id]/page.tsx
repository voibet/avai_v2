'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLeagueDetails } from '../../../lib/hooks/use-football-data'
import LoadingSpinner from '../../../components/ui/loading-spinner'
import ErrorMessage from '../../../components/ui/error-message'

export default function LeagueDetailsPage() {
  const params = useParams()
  const leagueId = params.id as string

  const { data, loading, error } = useLeagueDetails(leagueId)

  if (loading) {
    return <LoadingSpinner message="Loading league details..." />
  }

  if (error) {
    return <ErrorMessage message={`Error loading league details: ${error}`} />
  }

  if (!data) {
    return <ErrorMessage message="League not found" />
  }

  const { league, seasons } = data

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-4 py-1 border-b border-gray-600">
        <Link href="/" className="text-blue-400 hover:text-blue-300 text-xs">
          ← BACK TO HOME
        </Link>
        <span className="text-gray-500 text-xs">League Details</span>
      </div>

      {/* League Header */}
      <div className="grid grid-cols-12 gap-1 py-1 border-b border-gray-600 bg-gray-800">
        <div className="col-span-8 text-white text-lg font-mono truncate">
          {league.name}
        </div>
        <div className="col-span-4 text-gray-400 text-sm font-mono text-right">
          {league.country}
        </div>
      </div>

      {/* League Info */}
      <div className="border-b border-gray-600">
        <div className="grid grid-cols-12 gap-1 py-1">
          <div className="col-span-3 text-white text-xs font-mono">TYPE</div>
          <div className="col-span-9 text-gray-400 text-xs font-mono">{league.type || 'League'}</div>
        </div>
        <div className="grid grid-cols-12 gap-1 py-1">
          <div className="col-span-3 text-white text-xs font-mono">COUNTRY</div>
          <div className="col-span-9 text-gray-400 text-xs font-mono">{league.country}</div>
        </div>
      </div>

      {/* Seasons Section */}
      {seasons && seasons.length > 0 && (
        <div className="space-y-1">
          <div className="py-1 border-b border-gray-600 bg-gray-800">
            <span className="text-white text-xs font-mono">AVAILABLE SEASONS</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {seasons.map((season) => (
              <Link key={season} href={`/leagues/${leagueId}/seasons/${season}`}>
                <div className="bg-gray-800 border border-gray-600 p-3 hover:bg-gray-700 transition-colors">
                  <h3 className="text-white font-mono font-bold">{season}</h3>
                  <p className="text-gray-400 text-xs font-mono mt-1">Season {season}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-gray-600 pt-2">
        <div className="flex gap-2">
          <Link href={`/fixtures?league_id=${leagueId}`}>
            <button className="px-3 py-1 bg-blue-800 hover:bg-blue-700 text-white text-xs font-mono transition-colors">
              VIEW FIXTURES
            </button>
          </Link>
        </div>
      </div>
    </div>
  )
}
