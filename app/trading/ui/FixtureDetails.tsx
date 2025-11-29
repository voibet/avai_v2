import { useState } from 'react'
import type { FixtureWithOdds } from '../types'
import { formatOdds, getLatencyClass, parseDropInfo, parseValueInfo, parseArbInfo, formatTimestamp } from '../utils'

interface FixtureDetailsProps {
  selectedFixture: FixtureWithOdds | null
}

export function FixtureDetails({ selectedFixture }: FixtureDetailsProps) {
  const [showRawJson, setShowRawJson] = useState(false)
  const dropInfo = selectedFixture ? parseDropInfo(selectedFixture.filter_matches, selectedFixture) : null
  const valueInfo = selectedFixture ? parseValueInfo(selectedFixture.filter_matches, selectedFixture) : null
  const arbInfo = selectedFixture ? parseArbInfo(selectedFixture.filter_matches) : null

  return (
    <div className="bg-[#12121a] rounded flex flex-col overflow-hidden min-h-0"
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

            {/* Drop Information */}
            {dropInfo && (
              <div className="bg-[#0a0a0f] rounded p-2 border border-[#ff9500]/30">
                <div className="text-[#ff9500] text-[9px] font-semibold uppercase mb-1.5">Drop Information</div>
                <div className="space-y-1 text-[9px]">
                  <div className="flex justify-between">
                    <span className="text-[#666]">Drop Time:</span>
                    <span className="text-white font-mono">{formatTimestamp(dropInfo.timestamp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Bookmaker:</span>
                    <span className="text-[#00ff88] font-semibold">{dropInfo.bookmaker}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Market:</span>
                    <span className="text-[#00ff88] font-semibold">{dropInfo.market}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Current Odds:</span>
                    <span className="text-white font-mono">
                      {formatOdds(dropInfo.droppedOdds)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Historical Odds:</span>
                    <span className="text-[#888] font-mono">
                      {formatOdds(dropInfo.historicalOdds)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Drop Ratio:</span>
                    <span className="text-[#ff9500] font-mono">×{dropInfo.dropRatio.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Value Information */}
            {valueInfo && (
              <div className="bg-[#0a0a0f] rounded p-2 border border-[#00ff88]/30">
                <div className="text-[#00ff88] text-[9px] font-semibold uppercase mb-1.5">Value Information</div>
                <div className="space-y-1 text-[9px]">
                  <div className="flex justify-between">
                    <span className="text-[#666]">Bookmaker:</span>
                    <span className="text-[#00ff88] font-semibold">{valueInfo.bookmaker}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Market:</span>
                    <span className="text-[#00ff88] font-semibold">
                      {valueInfo.market}
                      {valueInfo.line !== undefined && (
                        <span className="text-white ml-1">[{valueInfo.line}]</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Odds:</span>
                    <span className="text-white font-mono">
                      {formatOdds(valueInfo.odds)}
                      <span className="text-[#666] text-[8px] ml-1">({valueInfo.odds})</span>
                    </span>
                  </div>
                  {valueInfo.fairOdds && (
                    <div className="flex justify-between">
                      <span className="text-[#666]">Fair Odds:</span>
                      <span className="text-[#888] font-mono">{formatOdds(valueInfo.fairOdds)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#666]">Value Ratio:</span>
                    <span className="text-[#00ff88] font-mono">{(valueInfo.valueRatio * 100 - 100).toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Arb Information */}
            {arbInfo && (
              <div className="bg-[#0a0a0f] rounded p-2 border border-[#ff9500]/30">
                <div className="text-[#ff9500] text-[9px] font-semibold uppercase mb-1.5">Arbitrage Information</div>
                <div className="space-y-1 text-[9px]">
                  <div className="flex justify-between">
                    <span className="text-[#666]">Market:</span>
                    <span className="text-[#00ff88] font-semibold">
                      {arbInfo.market}
                      {arbInfo.line !== undefined && (
                        <span className="text-white ml-1">[{arbInfo.line}]</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#666]">Profit:</span>
                    <span className="text-[#00ff88] font-mono font-bold">{arbInfo.profit.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            )}



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
                            <span className="text-white">
                              = {match.left_operand.value >= 100
                                ? formatOdds(match.left_operand.value)
                                : match.left_operand.value.toFixed(4)}
                            </span>
                          </div>
                          {match.right_operand && (
                            <div className="flex gap-1">
                              <span className="text-[#9C27B0] truncate">{match.right_operand.path}</span>
                              <span className="text-white">
                                = {match.right_operand.value >= 100
                                  ? formatOdds(match.right_operand.value)
                                  : match.right_operand.value.toFixed(4)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw JSON Response */}
            <div className="bg-[#0a0a0f] rounded border border-[#666]/30">
              <div
                className="px-2 py-1.5 cursor-pointer flex justify-between items-center hover:bg-[#1a1a2e]/50 transition-colors"
                onClick={() => setShowRawJson(!showRawJson)}
              >
                <div className="text-[#666] text-[9px] font-semibold uppercase">Raw JSON Response</div>
                <span className="text-[#666] text-[8px]">{showRawJson ? '▼' : '▶'}</span>
              </div>
              {showRawJson && selectedFixture && (
                <div className="border-t border-[#666]/20">
                  <div className="max-h-64 overflow-auto">
                    <pre className="text-[8px] font-mono text-[#888] whitespace-pre-wrap bg-[#000]/20 p-2 rounded">
                      {JSON.stringify(selectedFixture, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
