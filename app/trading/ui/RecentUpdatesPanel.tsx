import type { FixtureWithOdds } from '../types'
import { FixturesHistoryItem, RecentUpdateItem } from '../components'

interface RecentUpdatesPanelProps {
  showRecentUpdates: boolean
  setShowRecentUpdates: (show: boolean) => void
  recentlyUpdated: FixtureWithOdds[]
  loading: boolean
  selectedFixtureId: number | null
  setSelectedFixtureId: (id: number | null) => void
  showFixturesHistory: boolean
  setShowFixturesHistory: (show: boolean) => void
  fixturesHistory: FixtureWithOdds[]
  now: number
}

export function RecentUpdatesPanel({
  showRecentUpdates,
  setShowRecentUpdates,
  recentlyUpdated,
  loading,
  selectedFixtureId,
  setSelectedFixtureId,
  showFixturesHistory,
  setShowFixturesHistory,
  fixturesHistory,
  now,
}: RecentUpdatesPanelProps) {
  return (
    <>
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
        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
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
    </>
  )
}
