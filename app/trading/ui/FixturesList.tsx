import type { FixtureWithOdds } from '../types'
import { FixtureRow } from '../components'

interface FixturesListProps {
  sortedFixtures: FixtureWithOdds[]
  loading: boolean
  selectedFixtureId: number | null
  setSelectedFixtureId: (id: number | null) => void
  now: number
}

export function FixturesList({
  sortedFixtures,
  loading,
  selectedFixtureId,
  setSelectedFixtureId,
  now,
}: FixturesListProps) {
  return (
    <div className="bg-[#12121a] rounded flex flex-col"
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
  )
}
