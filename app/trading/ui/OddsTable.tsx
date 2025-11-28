import type { FixtureWithOdds } from '../types'
import { formatOdds, shouldHighlightOdds } from '../utils'

interface OddsTableProps {
  selectedFixture: FixtureWithOdds
  selectedBookmakers: Array<[string, any]>
}

export function OddsTable({ selectedFixture, selectedBookmakers }: OddsTableProps) {
  return (
    <div className="bg-[#12121a] rounded flex flex-col h-full"
         style={{ gridArea: 'odds' }}>
      <div className="px-2.5 py-2 bg-[#1a1a2e] text-[10px] font-semibold shrink-0">
        <span>Selected Fixture Odds</span>
        <span className="ml-2 text-[#00ff88]">#{selectedFixture.id}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* 1X2 Odds Table */}
        {selectedBookmakers.some(([_, odds]) => odds.x12_h || odds.x12_x || odds.x12_a) && (
          <div className="bg-[#0a0a0f] rounded p-2">
            <div className="text-[#ff9500] text-[9px] font-semibold uppercase">1X2 Odds</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] font-mono border-separate border-spacing-0">
                <thead>
                  <tr className="bg-transparent">
                    <th className="px-1 py-0 text-left text-[#666] font-bold uppercase"></th>
                    {selectedBookmakers.map(([bookie]) => (
                      <th key={bookie} className={`px-1 py-0 text-center min-w-[45px] font-bold uppercase text-[8px] ${bookie === 'Prediction' ? 'text-[#444]' : 'text-[#666]'}`}>
                        {bookie}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {['Home', 'Draw', 'Away'].map((outcome, idx) => {
                    // Check if any bookmaker has odds for this outcome
                    const hasAnyOdds = selectedBookmakers.some(([bookie, odds]) => {
                      const value = idx === 0 ? odds.x12_h : idx === 1 ? odds.x12_x : odds.x12_a
                      return value && value > 0
                    })

                    if (!hasAnyOdds) return null

                    return (
                      <tr key={outcome}>
                        <td className="px-1 py-0 text-[#888] font-medium">{outcome}</td>
                        {selectedBookmakers.map(([bookie, odds]) => {
                          const value = idx === 0 ? odds.x12_h : idx === 1 ? odds.x12_x : odds.x12_a
                          const fairValue = idx === 0 ? odds.fair_x12_h : idx === 1 ? odds.fair_x12_x : odds.fair_x12_a
                          const market = idx === 0 ? 'x12_h' : idx === 1 ? 'x12_x' : 'x12_a'
                          const isHighlighted = shouldHighlightOdds(bookie, market, undefined, selectedFixture.filter_matches)
                          const fairMarket = idx === 0 ? 'fair_x12_h' : idx === 1 ? 'fair_x12_x' : 'fair_x12_a'
                          const fairHighlighted = shouldHighlightOdds(bookie, fairMarket, undefined, selectedFixture.filter_matches)
                          return (
                            <td key={bookie} className="p-0 text-center">
                              {value ? (
                              <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                <div className="text-white font-medium">{formatOdds(value)}</div>
                                {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                              </div>
                              ) : (
                                <div className="text-[#444]">-</div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Asian Handicap - Combined Home/Away */}
        {(() => {
          // Get all unique AH lines
          const allAhLines = new Set<number>()
          selectedBookmakers.forEach(([_, odds]) => {
            if (odds.ah_lines && Array.isArray(odds.ah_lines)) {
              odds.ah_lines.forEach((line: number) => allAhLines.add(line))
            }
          })
          const sortedAhLines = Array.from(allAhLines).sort((a, b) => a - b)

          // Filter lines where at least one bookmaker has both home and away odds
          const linesWithData = sortedAhLines.filter(line =>
            selectedBookmakers.some(([bookie, odds]) => {
              const lineIdx = odds.ah_lines?.indexOf(line)
              if (lineIdx === undefined || lineIdx < 0) return false

              const homeOdds = odds.ah_h?.[lineIdx]
              const awayOdds = odds.ah_a?.[lineIdx]

              return homeOdds && homeOdds > 0 && awayOdds && awayOdds > 0
            })
          )

          if (linesWithData.length === 0) return null

          return (
            <div className="bg-[#0a0a0f] rounded p-2">
              <div className="text-[#ff9500] text-[9px] font-semibold uppercase">Asian Handicap</div>
              <div className="overflow-x-auto max-h-68 overflow-y-auto">
                <table className="w-full text-[9px] font-mono border-separate border-spacing-0">
                  <thead className="sticky top-0 bg-[#0a0a0f]">
                    <tr className="bg-transparent">
                      <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Home</th>
                      {selectedBookmakers.map(([bookie]) => (
                        <th key={`home-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                          {bookie}
                        </th>
                      ))}
                      <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Away</th>
                      {selectedBookmakers.map(([bookie]) => (
                        <th key={`away-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                          {bookie}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linesWithData.map(line => (
                      <tr key={line}>
                        {/* Home side */}
                        <td className="px-1 py-0 text-[#888] font-medium">
                          {line > 0 ? `+${line.toFixed(2)}` : line.toFixed(2)}
                        </td>
                        {selectedBookmakers.map(([bookie, odds]) => {
                          const lineIdx = odds.ah_lines?.indexOf(line)
                          const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ah_h?.[lineIdx] : null
                          const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ah_h?.[lineIdx] : null
                          const isHighlighted = shouldHighlightOdds(bookie, 'ah_h', line, selectedFixture.filter_matches)
                          const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ah_h', line, selectedFixture.filter_matches)
                          return (
                            <td key={`home-${bookie}`} className="p-0 text-center">
                              {value ? (
                                <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                  <div className="text-white font-medium">{formatOdds(value)}</div>
                                  {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                </div>
                              ) : (
                                <div className="text-[#444]">-</div>
                              )}
                            </td>
                          )
                        })}

                        {/* Away side */}
                        <td className="px-1 py-0 text-[#888] font-medium">
                          {line < 0 ? `+${Math.abs(line).toFixed(2)}` : line === 0 ? line.toFixed(2) : `-${line.toFixed(2)}`}
                        </td>
                        {selectedBookmakers.map(([bookie, odds]) => {
                          const lineIdx = odds.ah_lines?.indexOf(line)
                          const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ah_a?.[lineIdx] : null
                          const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ah_a?.[lineIdx] : null
                          const isHighlighted = shouldHighlightOdds(bookie, 'ah_a', line, selectedFixture.filter_matches)
                          const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ah_a', line, selectedFixture.filter_matches)
                          return (
                            <td key={`away-${bookie}`} className="p-0 text-center">
                              {value ? (
                                <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                  <div className="text-white font-medium">{formatOdds(value)}</div>
                                  {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                </div>
                              ) : (
                                <div className="text-[#444]">-</div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* Over/Under - Combined Over/Under */}
        {(() => {
          // Get all unique OU lines
          const allOuLines = new Set<number>()
          selectedBookmakers.forEach(([_, odds]) => {
            if (odds.ou_lines && Array.isArray(odds.ou_lines)) {
              odds.ou_lines.forEach((line: number) => allOuLines.add(line))
            }
          })
          const sortedOuLines = Array.from(allOuLines).sort((a, b) => a - b)

          // Filter lines where at least one bookmaker has both over and under odds
          const linesWithData = sortedOuLines.filter(line =>
            selectedBookmakers.some(([bookie, odds]) => {
              const lineIdx = odds.ou_lines?.indexOf(line)
              if (lineIdx === undefined || lineIdx < 0) return false

              const overOdds = odds.ou_o?.[lineIdx]
              const underOdds = odds.ou_u?.[lineIdx]

              return overOdds && overOdds > 0 && underOdds && underOdds > 0
            })
          )

          if (linesWithData.length === 0) return null

          return (
            <div className="bg-[#0a0a0f] rounded p-2">
              <div className="text-[#ff9500] text-[9px] font-semibold uppercase">Over/Under</div>
              <div className="overflow-x-auto max-h-68 overflow-y-auto">
                <table className="w-full text-[9px] font-mono border-separate border-spacing-0">
                  <thead className="sticky top-0 bg-[#0a0a0f]">
                    <tr className="bg-transparent">
                      <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Over</th>
                      {selectedBookmakers.map(([bookie]) => (
                        <th key={`over-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                          {bookie}
                        </th>
                      ))}
                      <th className="px-1 py-0 text-left text-[#666] font-bold uppercase">Under</th>
                      {selectedBookmakers.map(([bookie]) => (
                        <th key={`under-${bookie}`} className="px-1 py-0 text-center text-[#666] min-w-[45px] font-bold uppercase text-[8px]">
                          {bookie}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linesWithData.map(line => (
                      <tr key={line}>
                        {/* Over side */}
                        <td className="px-1 py-0 text-[#888] font-medium">
                          O {line.toFixed(2)}
                        </td>
                        {selectedBookmakers.map(([bookie, odds]) => {
                          const lineIdx = odds.ou_lines?.indexOf(line)
                          const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ou_o?.[lineIdx] : null
                          const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ou_o?.[lineIdx] : null
                          const isHighlighted = shouldHighlightOdds(bookie, 'ou_o', line, selectedFixture.filter_matches)
                          const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ou_o', line, selectedFixture.filter_matches)
                          return (
                            <td key={`over-${bookie}`} className="p-0 text-center">
                              {value ? (
                                <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                  <div className="text-white font-medium">{formatOdds(value)}</div>
                                  {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                </div>
                              ) : (
                                <div className="text-[#444]">-</div>
                              )}
                            </td>
                          )
                        })}

                        {/* Under side */}
                        <td className="px-1 py-0 text-[#888] font-medium">
                          U {line.toFixed(2)}
                        </td>
                        {selectedBookmakers.map(([bookie, odds]) => {
                          const lineIdx = odds.ou_lines?.indexOf(line)
                          const value = lineIdx !== undefined && lineIdx >= 0 ? odds.ou_u?.[lineIdx] : null
                          const fairValue = lineIdx !== undefined && lineIdx >= 0 ? odds.fair_ou_u?.[lineIdx] : null
                          const isHighlighted = shouldHighlightOdds(bookie, 'ou_u', line, selectedFixture.filter_matches)
                          const fairHighlighted = shouldHighlightOdds(bookie, 'fair_ou_u', line, selectedFixture.filter_matches)
                          return (
                            <td key={`under-${bookie}`} className="p-0 text-center">
                              {value ? (
                                <div className={`rounded px-1 py-0 ${isHighlighted ? 'bg-[#00ff88]/20 border border-[#00ff88]/40' : 'bg-black'}`}>
                                  <div className="text-white font-medium">{formatOdds(value)}</div>
                                  {fairValue && bookie !== 'Prediction' && <div className={`${fairHighlighted ? 'text-[#00ff88]' : 'text-[#56b6c2]'} text-[7px]`}>{formatOdds(fairValue)}</div>}
                                </div>
                              ) : (
                                <div className="text-[#444]">-</div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
