import { memo } from 'react'
import type { FixtureWithOdds } from '../types'
import { formatDateShort, formatUptime, getLatencyClass, formatOdds } from '../utils'

// Memoized components
export const FixtureRow = memo(function FixtureRow({
  fixture,
  isSelected,
  hasRecentUpdate,
  onSelect,
}: {
  fixture: FixtureWithOdds
  isSelected: boolean
  hasRecentUpdate: boolean
  onSelect: (id: number) => void
}) {
  return (
    <div
      onClick={() => onSelect(fixture.id)}
      className={`grid grid-cols-[60px_1fr_1fr_120px_80px_80px_80px_80px] gap-1 px-2 py-1.5 cursor-pointer transition-colors ${isSelected
        ? 'bg-[#1a2a1e]'
        : hasRecentUpdate
          ? 'bg-[#1a1a2e]'
          : 'hover:bg-[#1a1a2e]/50'
        }`}
    >
      <div className="text-[#00ff88] font-semibold">#{fixture.id}</div>
      <div className="truncate text-white">{fixture.home_team_name}</div>
      <div className="truncate text-white">{fixture.away_team_name}</div>
      <div className="truncate text-[#666] text-[9px]">{fixture.league_name}</div>
      <div className="text-center text-[#888]">{fixture.date ? formatDateShort(fixture.date) : '-'}</div>
      <div className={`text-center font-semibold ${fixture.bestHome ? 'text-white' : 'text-[#666]'}`}>
        {fixture.bestHome ? (fixture.bestHome / 1000).toFixed(3) : '-'}
      </div>
      <div className={`text-center font-semibold ${fixture.bestDraw ? 'text-white' : 'text-[#666]'}`}>
        {fixture.bestDraw ? (fixture.bestDraw / 1000).toFixed(3) : '-'}
      </div>
      <div className={`text-center font-semibold ${fixture.bestAway ? 'text-white' : 'text-[#666]'}`}>
        {fixture.bestAway ? (fixture.bestAway / 1000).toFixed(3) : '-'}
      </div>
    </div>
  )
})

export const RecentUpdateItem = memo(function RecentUpdateItem({
  fixture,
  isSelected,
  onSelect,
}: {
  fixture: FixtureWithOdds
  isSelected: boolean
  onSelect: (id: number) => void
}) {
  const bookieNames = fixture.bookmakers ? Object.keys(fixture.bookmakers).join(', ') : 'No odds'

  return (
    <div
      onClick={() => onSelect(fixture.id)}
      className={`p-1.5 rounded cursor-pointer border-l-2 transition-colors ${isSelected
        ? 'bg-[#1a2a1e] border-l-[#00ff88]'
        : 'border-transparent hover:bg-[#1a1a2e]'
        }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[#00ff88] font-semibold">#{fixture.id}</span>
        <span className={`text-[9px] ${getLatencyClass(fixture.latency)}`}>
          {fixture.latency !== undefined ? `${fixture.latency}ms` : '-'}
        </span>
      </div>
      <div className="text-[10px] text-white truncate">
        {fixture.home_team_name} vs {fixture.away_team_name}
      </div>
      <div className="text-[#666] text-[9px] truncate">{bookieNames}</div>
    </div>
  )
})

export const FixturesHistoryItem = memo(function FixturesHistoryItem({
  fixture,
  isSelected,
  onSelect,
  now,
}: {
  fixture: FixtureWithOdds
  isSelected: boolean
  onSelect: (id: number) => void
  now: number
}) {
  const bookieNames = fixture.bookmakers ? Object.keys(fixture.bookmakers).join(', ') : 'No odds'
  const timeSinceUpdate = fixture.lastUpdate ? now - fixture.lastUpdate : null
  const timeAgo = timeSinceUpdate ? formatUptime(Math.floor(timeSinceUpdate / 1000)) : '-'

  return (
    <div
      onClick={() => onSelect(fixture.id)}
      className={`p-1.5 rounded cursor-pointer border-l-2 transition-colors ${isSelected
        ? 'bg-[#1a2a1e] border-l-[#00ff88]'
        : 'border-transparent hover:bg-[#1a1a2e]'
        }`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[#00ff88] font-semibold">#{fixture.id}</span>
        <span className="text-[#888] text-[9px]">{timeAgo}</span>
      </div>
      <div className="text-[10px] text-white truncate">
        {fixture.home_team_name} vs {fixture.away_team_name}
      </div>
      <div className="text-[#666] text-[9px] truncate">{bookieNames}</div>
    </div>
  )
})
