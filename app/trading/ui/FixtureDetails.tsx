import type { FixtureWithOdds } from '../types'
import { formatOdds, getLatencyClass } from '../utils'

interface FixtureDetailsProps {
  selectedFixture: FixtureWithOdds | null
}

export function FixtureDetails({ selectedFixture }: FixtureDetailsProps) {
  return (
    <div className="bg-[#12121a] rounded flex flex-col"
         style={{ gridArea: 'details' }}>
      <div className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold shrink-0">
        <span>Fixture Details</span>
        {selectedFixture && (
          <span className="ml-2 text-[#00ff88]">#{selectedFixture.id}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {!selectedFixture ? (
          <div className="text-center py-8 text-[#666]">Select a fixture</div>
        ) : (
          <div className="space-y-2">
            {/* Match Info */}
            <div className="bg-[#0a0a0f] rounded p-2">
              <div className="text-[#ff9500] text-[9px] font-semibold uppercase mb-1">Match Info</div>
              <div className="space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-[#666]">Home:</span>
                  <span className="text-white font-semibold">{selectedFixture.home_team_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#666]">Away:</span>
                  <span className="text-white font-semibold">{selectedFixture.away_team_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#666]">League:</span>
                  <span className="text-[#888]">{selectedFixture.league_name || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#666]">Date:</span>
                  <span className="text-[#888]">{selectedFixture.date ? new Date(selectedFixture.date).toLocaleString() : '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#666]">Latency:</span>
                  <span className={getLatencyClass(selectedFixture.latency)}>
                    {selectedFixture.latency !== undefined ? `${selectedFixture.latency}ms` : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Filter Matches - Why this fixture was shown */}
            {selectedFixture.filter_matches && selectedFixture.filter_matches.length > 0 && (
              <div className="bg-[#0a0a0f] rounded p-2 border border-[#00ff88]/20">
                <div className="text-[#00ff88] text-[9px] font-semibold uppercase mb-1">Filter Matches</div>
                <div className="space-y-1">
                  {selectedFixture.filter_matches.map((match, idx) => (
                    <div key={idx} className="bg-[#12121a] rounded p-1.5 border-l-2 border-[#00ff88]">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-[#00ff88] font-bold text-[8px]">
                          {match.calculation_op?.toUpperCase() || match.op.toUpperCase()}
                        </span>
                        <span className="text-white font-mono text-[9px]">
                          {match.result.toFixed(4)}
                        </span>
                        <span className="text-[#888] text-[8px]">
                          {match.op} {match.threshold}
                        </span>
                        <span className="text-[#00ff88] text-[8px]">✓</span>
                      </div>
                      {match.left_operand && (
                        <div className="text-[8px] font-mono space-y-0.5">
                          <div className="flex gap-1">
                            <span className="text-[#2196F3] truncate">{match.left_operand.path}</span>
                            <span className="text-white">= {formatOdds(match.left_operand.value)}</span>
                          </div>
                          {match.right_operand && (
                            <div className="flex gap-1">
                              <span className="text-[#9C27B0] truncate">{match.right_operand.path}</span>
                              <span className="text-white">= {formatOdds(match.right_operand.value)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
