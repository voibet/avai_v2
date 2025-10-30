'use client'

import { useState, useEffect } from 'react'

interface Fixture {
  fixture_id: string
  home_team: string
  away_team: string
  date: string
  league: string
  odds: BookieOdds[]
}

interface BookieOdds {
  bookie: string
  decimals: number
  odds_x12?: Array<{ t: number; x12: number[] }>
  odds_ah?: Array<{ t: number; ah_a: number[]; ah_h: number[] }>
  odds_ou?: Array<{ t: number; ou_o: number[]; ou_u: number[] }>
  lines?: Array<{ t: number; ah: number[]; ou: number[] }>
  fair_odds_x12?: number[]
  fair_odds_ah?: {
    fair_ah_a?: number[]
    fair_ah_h?: number[]
  }
  fair_odds_ou?: {
    fair_ou_o?: number[]
    fair_ou_u?: number[]
  }
  fair_latest_lines?: {
    ah?: number[]
    ou?: number[]
  }
}

interface ValueOpportunity {
  fixture: Fixture
  bookie: string
  type: 'x12' | 'ah' | 'ou'
  lineIndex?: number
  oddsIndex?: number
  veikkausOdds: number
  pinnacleFairOdds: number
  ratio: number
  line?: number
}

export default function ValuesPage() {
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [opportunities, setOpportunities] = useState<ValueOpportunity[]>([])
  const [analyzedFixtures, setAnalyzedFixtures] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchValues()
  }, [])

  const fetchValues = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/odds?latest=true&fair_odds=true&limit=3000')
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      setFixtures(data.fixtures || [])
      const result = analyzeOpportunities(data.fixtures || [])
      setOpportunities(result.opportunities)
      setAnalyzedFixtures(result.analyzedFixtures)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const analyzeOpportunities = (fixtures: Fixture[]) => {
    // Compares odds using exact line matching - only lines that exist in both bookies are compared!
    // This ensures we're comparing equivalent handicap/over-under values between bookies.
    const opportunities: ValueOpportunity[] = []
    let analyzedFixtures = 0

    fixtures.forEach(fixture => {
      // Only analyze fixtures that haven't started yet
      const fixtureDate = new Date(fixture.date)
      const now = new Date()
      if (fixtureDate <= now) return

      // Find Veikkaus and Pinnacle bookies
      const veikkausOdds = fixture.odds.find(o => o.bookie === 'Veikkaus')
      const pinnacleOdds = fixture.odds.find(o => o.bookie === 'Pinnacle')

      if (!veikkausOdds || !pinnacleOdds) return

      analyzedFixtures++

      // Analyze X12 odds (always 3 outcomes: Home, Draw, Away - no line matching needed)
      if (veikkausOdds.odds_x12 && pinnacleOdds.fair_odds_x12 && veikkausOdds.odds_x12.length > 0) {
        const veikkausX12 = veikkausOdds.odds_x12[0].x12
        const pinnacleX12 = pinnacleOdds.fair_odds_x12

        veikkausX12.forEach((odds, index) => {
          if (pinnacleX12[index] && odds > 0 && pinnacleX12[index] > 0) {
            const vDecimal = odds / Math.pow(10, veikkausOdds.decimals)
            const pDecimal = pinnacleX12[index] / Math.pow(10, pinnacleOdds.decimals)
            const ratio = vDecimal / pDecimal
            if (ratio > 1.03) {
              console.log(`X12 Opportunity found: ${fixture.home_team} vs ${fixture.away_team}, outcome: ${['Home', 'Draw', 'Away'][index]}, ratio: ${ratio.toFixed(3)}, vDecimal: ${vDecimal}, pDecimal: ${pDecimal}`)
              opportunities.push({
                fixture,
                bookie: 'Veikkaus',
                type: 'x12',
                oddsIndex: index,
                veikkausOdds: odds,
                pinnacleFairOdds: pinnacleX12[index],
                ratio
              })
            }
          }
        })
      }

      // Only use lines that exist in both bookies (exact matches only)
      const findMatchingLineIndex = (veikkausLines: number[], pinnacleLines: number[], targetLine: number): number | null => {
        // Find exact match only
        const pinnacleIndex = pinnacleLines.indexOf(targetLine)
        return pinnacleIndex !== -1 ? pinnacleIndex : null
      }

      // Analyze AH odds with line matching
      if (veikkausOdds.odds_ah && pinnacleOdds.fair_odds_ah && veikkausOdds.odds_ah.length > 0) {
        const veikkausAH = veikkausOdds.odds_ah[0]
        const pinnacleAH = pinnacleOdds.fair_odds_ah
        const veikkausLines = veikkausOdds.lines?.[0]?.ah || []
        const pinnacleLines = pinnacleOdds.fair_latest_lines?.ah || []

        // AH Away - match by lines
        if (veikkausAH.ah_a && pinnacleAH?.fair_ah_a && veikkausLines.length > 0 && pinnacleLines.length > 0) {
          veikkausAH.ah_a.forEach((odds, veikkausIndex) => {
            const veikkausLine = veikkausLines[veikkausIndex]
            if (veikkausLine !== undefined && odds > 0) {
              const pinnacleIndex = findMatchingLineIndex(veikkausLines, pinnacleLines, veikkausLine)
              if (pinnacleIndex !== null && pinnacleAH.fair_ah_a?.[pinnacleIndex] && pinnacleAH.fair_ah_a[pinnacleIndex] > 0) {
                const vDecimal = odds / Math.pow(10, veikkausOdds.decimals)
                const pDecimal = pinnacleAH.fair_ah_a[pinnacleIndex] / Math.pow(10, pinnacleOdds.decimals)
                const ratio = vDecimal / pDecimal
                if (ratio > 1.03) {
                  console.log(`AH Away Opportunity found: ${fixture.home_team} vs ${fixture.away_team}, line: ${veikkausLine}, ratio: ${ratio.toFixed(3)}, vDecimal: ${vDecimal}, pDecimal: ${pDecimal}`)
                  opportunities.push({
                    fixture,
                    bookie: 'Veikkaus',
                    type: 'ah',
                    lineIndex: veikkausIndex,
                    oddsIndex: 0, // away
                    veikkausOdds: odds,
                    pinnacleFairOdds: pinnacleAH.fair_ah_a[pinnacleIndex],
                    ratio,
                    line: veikkausLine
                  })
                }
              }
            }
          })
        }

        // AH Home - match by lines
        if (veikkausAH.ah_h && pinnacleAH?.fair_ah_h && veikkausLines.length > 0 && pinnacleLines.length > 0) {
          veikkausAH.ah_h.forEach((odds, veikkausIndex) => {
            const veikkausLine = veikkausLines[veikkausIndex]
            if (veikkausLine !== undefined && odds > 0) {
              const pinnacleIndex = findMatchingLineIndex(veikkausLines, pinnacleLines, veikkausLine)
              if (pinnacleIndex !== null && pinnacleAH.fair_ah_h?.[pinnacleIndex] && pinnacleAH.fair_ah_h[pinnacleIndex] > 0) {
                const vDecimal = odds / Math.pow(10, veikkausOdds.decimals)
                const pDecimal = pinnacleAH.fair_ah_h[pinnacleIndex] / Math.pow(10, pinnacleOdds.decimals)
                const ratio = vDecimal / pDecimal
                if (ratio > 1.03) {
                  opportunities.push({
                    fixture,
                    bookie: 'Veikkaus',
                    type: 'ah',
                    lineIndex: veikkausIndex,
                    oddsIndex: 1, // home
                    veikkausOdds: odds,
                    pinnacleFairOdds: pinnacleAH.fair_ah_h[pinnacleIndex],
                    ratio,
                    line: veikkausLine
                  })
                }
              }
            }
          })
        }
      }

      // Analyze OU odds with line matching
      if (veikkausOdds.odds_ou && pinnacleOdds.fair_odds_ou && veikkausOdds.odds_ou.length > 0) {
        const veikkausOU = veikkausOdds.odds_ou[0]
        const pinnacleOU = pinnacleOdds.fair_odds_ou
        const veikkausLines = veikkausOdds.lines?.[0]?.ou || []
        const pinnacleLines = pinnacleOdds.fair_latest_lines?.ou || []

        // OU Over - match by lines
        if (veikkausOU.ou_o && pinnacleOU?.fair_ou_o && veikkausLines.length > 0 && pinnacleLines.length > 0) {
          veikkausOU.ou_o.forEach((odds, veikkausIndex) => {
            const veikkausLine = veikkausLines[veikkausIndex]
            if (veikkausLine !== undefined && odds > 0) {
              const pinnacleIndex = findMatchingLineIndex(veikkausLines, pinnacleLines, veikkausLine)
              if (pinnacleIndex !== null && pinnacleOU.fair_ou_o?.[pinnacleIndex] && pinnacleOU.fair_ou_o[pinnacleIndex] > 0) {
                const vDecimal = odds / Math.pow(10, veikkausOdds.decimals)
                const pDecimal = pinnacleOU.fair_ou_o[pinnacleIndex] / Math.pow(10, pinnacleOdds.decimals)
                const ratio = vDecimal / pDecimal
                if (ratio > 1.03) {
                  opportunities.push({
                    fixture,
                    bookie: 'Veikkaus',
                    type: 'ou',
                    lineIndex: veikkausIndex,
                    oddsIndex: 0, // over
                    veikkausOdds: odds,
                    pinnacleFairOdds: pinnacleOU.fair_ou_o[pinnacleIndex],
                    ratio,
                    line: veikkausLine
                  })
                }
              }
            }
          })
        }

        // OU Under - match by lines
        if (veikkausOU.ou_u && pinnacleOU?.fair_ou_u && veikkausLines.length > 0 && pinnacleLines.length > 0) {
          veikkausOU.ou_u.forEach((odds, veikkausIndex) => {
            const veikkausLine = veikkausLines[veikkausIndex]
            if (veikkausLine !== undefined && odds > 0) {
              const pinnacleIndex = findMatchingLineIndex(veikkausLines, pinnacleLines, veikkausLine)
              if (pinnacleIndex !== null && pinnacleOU.fair_ou_u?.[pinnacleIndex] && pinnacleOU.fair_ou_u[pinnacleIndex] > 0) {
                const vDecimal = odds / Math.pow(10, veikkausOdds.decimals)
                const pDecimal = pinnacleOU.fair_ou_u[pinnacleIndex] / Math.pow(10, pinnacleOdds.decimals)
                const ratio = vDecimal / pDecimal
                if (ratio > 1.03) {
                  opportunities.push({
                    fixture,
                    bookie: 'Veikkaus',
                    type: 'ou',
                    lineIndex: veikkausIndex,
                    oddsIndex: 1, // under
                    veikkausOdds: odds,
                    pinnacleFairOdds: pinnacleOU.fair_ou_u[pinnacleIndex],
                    ratio,
                    line: veikkausLine
                  })
                }
              }
            }
          })
        }
      }
    })

    return { opportunities, analyzedFixtures }
  }

  const formatOdds = (odds: number, decimals: number) => {
    return (odds / Math.pow(10, decimals)).toFixed(decimals === 2 ? 2 : 3)
  }

  const getTypeLabel = (type: string, oddsIndex?: number, line?: number) => {
    switch (type) {
      case 'x12':
        const outcomes = ['Home', 'Draw', 'Away']
        return `X12 ${outcomes[oddsIndex || 0]}`
      case 'ah':
        return `AH ${line} ${oddsIndex === 0 ? 'Away' : 'Home'}`
      case 'ou':
        return `OU ${line} ${oddsIndex === 0 ? 'Over' : 'Under'}`
      default:
        return type
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-400">Loading values...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-red-400 p-4">
        Error: {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-xl font-bold mb-4">VALUES - Veikkaus vs Pinnacle Fair Odds (Ratio &gt; 1.03)</div>

      <div className="text-sm text-gray-400 mb-4">
        Found {opportunities.length} value opportunities from {analyzedFixtures} analyzed fixtures ({fixtures.length} total fixtures)
      </div>

      <div className="space-y-4">
        {opportunities.map((opp, index) => {
          const veikkausBookie = opp.fixture.odds.find(o => o.bookie === 'Veikkaus')
          const pinnacleBookie = opp.fixture.odds.find(o => o.bookie === 'Pinnacle')
          return (
            <div key={index} className="bg-gray-900 p-4 rounded border border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <div className="text-sm text-gray-400">Fixture</div>
                  <div className="font-semibold">
                    {opp.fixture.home_team} vs {opp.fixture.away_team}
                  </div>
                  <div className="text-sm text-gray-400">
                    {opp.fixture.league} • {new Date(opp.fixture.date).toLocaleString()}
                  </div>
                </div>

                <div className="md:col-span-1">
                  <div className="text-sm text-gray-400">Market</div>
                  <div className="font-semibold">
                    {getTypeLabel(opp.type, opp.oddsIndex, opp.line)}
                  </div>
                  <div className="text-sm text-gray-400">Bookie: {opp.bookie}</div>
                </div>

                <div className="md:col-span-1">
                  <div className="text-sm text-gray-400">Odds & Ratio</div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Veikkaus:</span>
                      <span className="font-semibold">
                        {veikkausBookie ? formatOdds(opp.veikkausOdds, veikkausBookie.decimals) : opp.veikkausOdds}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pinnacle Fair:</span>
                      <span>{(opp.pinnacleFairOdds / Math.pow(10, pinnacleBookie?.decimals || 3)).toFixed(pinnacleBookie?.decimals === 2 ? 2 : 3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Ratio:</span>
                      <span className="font-bold text-green-400">{opp.ratio.toFixed(3)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {opportunities.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            No value opportunities found with ratio &gt; 1.03
          </div>
        )}
      </div>

      {/* Debug section - show 5 random fixtures with all odds ratios */}
      {fixtures.length > 0 && (
        <div className="bg-yellow-900 p-4 rounded border border-yellow-700 mt-6">
          <div className="text-yellow-400 font-bold mb-2">DEBUG - 5 Random Fixtures (All Odds Ratios - Including Past Fixtures):</div>
          <div className="space-y-4 text-sm">
            {[...fixtures].sort(() => 0.5 - Math.random()).slice(0, Math.min(5, fixtures.length)).map((fixture, fixtureIndex) => {
              const veikkausOdds = fixture.odds.find(o => o.bookie === 'Veikkaus')
              const pinnacleOdds = fixture.odds.find(o => o.bookie === 'Pinnacle')

              if (!veikkausOdds || !pinnacleOdds) {
                return (
                  <div key={fixtureIndex} className="text-yellow-300">
                    {fixtureIndex + 1}. {fixture.home_team} vs {fixture.away_team} - Missing Veikkaus or Pinnacle data
                  </div>
                )
              }

              return (
                <div key={fixtureIndex} className="border border-yellow-700 p-2 rounded">
                  <div className="text-yellow-300 font-semibold mb-2">
                    {fixtureIndex + 1}. {fixture.home_team} vs {fixture.away_team} ({fixture.league})
                  </div>

                  {/* X12 Odds */}
                  {veikkausOdds.odds_x12 && pinnacleOdds.fair_odds_x12 && (
                    <div className="mb-2">
                      <div className="text-yellow-400 text-xs">X12 Odds:</div>
                      {['Home', 'Draw', 'Away'].map((outcome, idx) => {
                        const vOdds = veikkausOdds.odds_x12?.[0]?.x12?.[idx]
                        const pOdds = pinnacleOdds.fair_odds_x12?.[idx]
                        const vDecimal = vOdds ? vOdds / Math.pow(10, veikkausOdds.decimals) : null
                        const pDecimal = pOdds ? pOdds / Math.pow(10, pinnacleOdds.decimals) : null
                        const ratio = vDecimal && pDecimal ? (vDecimal / pDecimal).toFixed(3) : 'N/A'
                        return (
                          <div key={idx} className="text-yellow-200 text-xs ml-2">
                            {outcome}: V={vDecimal ? vDecimal.toFixed(veikkausOdds.decimals === 2 ? 2 : 3) : 'N/A'} P={pDecimal ? pDecimal.toFixed(pinnacleOdds.decimals === 2 ? 2 : 3) : 'N/A'} Ratio={ratio}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* AH Odds */}
                  {veikkausOdds.odds_ah && pinnacleOdds.fair_odds_ah && (
                    <div className="mb-2">
                      <div className="text-yellow-400 text-xs">AH Odds (Away/Home):</div>
                      <div className="text-yellow-500 text-xs ml-2 mb-1">
                        Lines - V: [{veikkausOdds.lines?.[0]?.ah?.join(',')}] P: [{pinnacleOdds.fair_latest_lines?.ah?.join(',')}]
                      </div>
                      {(() => {
                        const debugItems: JSX.Element[] = []
                        const veikkausLines = veikkausOdds.lines?.[0]?.ah || []
                        const pinnacleLines = pinnacleOdds.fair_latest_lines?.ah || []

                        // Find lines that exist in both bookies
                        const commonLines = veikkausLines.filter(line => pinnacleLines.includes(line))

                        // Show only AH odds for lines that exist in both bookies
                        commonLines.forEach(line => {
                          const veikkausAwayIndex = veikkausLines.indexOf(line)
                          const veikkausHomeIndex = veikkausLines.indexOf(line)
                          const pinnacleIndex = pinnacleLines.indexOf(line)

                          // Away odds
                          const vAwayOdds = veikkausOdds.odds_ah?.[0]?.ah_a?.[veikkausAwayIndex]
                          const pAwayOdds = pinnacleOdds.fair_odds_ah?.fair_ah_a?.[pinnacleIndex]
                          if (vAwayOdds && pAwayOdds) {
                            const vDecimal = vAwayOdds / Math.pow(10, veikkausOdds.decimals)
                            const pDecimal = pAwayOdds / Math.pow(10, pinnacleOdds.decimals)
                            const ratio = (vDecimal / pDecimal).toFixed(3)
                            debugItems.push(
                              <div key={`away-${line}`} className="text-yellow-200 text-xs ml-2">
                                AH Away {line}: V={vDecimal.toFixed(veikkausOdds.decimals === 2 ? 2 : 3)} P={pDecimal.toFixed(pinnacleOdds.decimals === 2 ? 2 : 3)} Ratio={ratio}
                              </div>
                            )
                          }

                          // Home odds
                          const vHomeOdds = veikkausOdds.odds_ah?.[0]?.ah_h?.[veikkausHomeIndex]
                          const pHomeOdds = pinnacleOdds.fair_odds_ah?.fair_ah_h?.[pinnacleIndex]
                          if (vHomeOdds && pHomeOdds) {
                            const vDecimal = vHomeOdds / Math.pow(10, veikkausOdds.decimals)
                            const pDecimal = pHomeOdds / Math.pow(10, pinnacleOdds.decimals)
                            const ratio = (vDecimal / pDecimal).toFixed(3)
                            debugItems.push(
                              <div key={`home-${line}`} className="text-yellow-200 text-xs ml-2">
                                AH Home {line}: V={vDecimal.toFixed(veikkausOdds.decimals === 2 ? 2 : 3)} P={pDecimal.toFixed(pinnacleOdds.decimals === 2 ? 2 : 3)} Ratio={ratio}
                              </div>
                            )
                          }
                        })

                        return debugItems
                      })()}
                    </div>
                  )}

                  {/* OU Odds */}
                  {veikkausOdds.odds_ou && pinnacleOdds.fair_odds_ou && (
                    <div className="mb-2">
                      <div className="text-yellow-400 text-xs">OU Odds (Over/Under):</div>
                      <div className="text-yellow-500 text-xs ml-2 mb-1">
                        Lines - V: [{veikkausOdds.lines?.[0]?.ou?.join(',')}] P: [{pinnacleOdds.fair_latest_lines?.ou?.join(',')}]
                      </div>
                      {(() => {
                        const debugItems: JSX.Element[] = []
                        const veikkausLines = veikkausOdds.lines?.[0]?.ou || []
                        const pinnacleLines = pinnacleOdds.fair_latest_lines?.ou || []

                        // Find lines that exist in both bookies
                        const commonLines = veikkausLines.filter(line => pinnacleLines.includes(line))

                        // Show only OU odds for lines that exist in both bookies
                        commonLines.forEach(line => {
                          const veikkausIndex = veikkausLines.indexOf(line)
                          const pinnacleIndex = pinnacleLines.indexOf(line)

                          // Over odds
                          const vOverOdds = veikkausOdds.odds_ou?.[0]?.ou_o?.[veikkausIndex]
                          const pOverOdds = pinnacleOdds.fair_odds_ou?.fair_ou_o?.[pinnacleIndex]
                          if (vOverOdds && pOverOdds) {
                            const vDecimal = vOverOdds / Math.pow(10, veikkausOdds.decimals)
                            const pDecimal = pOverOdds / Math.pow(10, pinnacleOdds.decimals)
                            const ratio = (vDecimal / pDecimal).toFixed(3)
                            debugItems.push(
                              <div key={`over-${line}`} className="text-yellow-200 text-xs ml-2">
                                OU Over {line}: V={vDecimal.toFixed(veikkausOdds.decimals === 2 ? 2 : 3)} P={pDecimal.toFixed(pinnacleOdds.decimals === 2 ? 2 : 3)} Ratio={ratio}
                              </div>
                            )
                          }

                          // Under odds
                          const vUnderOdds = veikkausOdds.odds_ou?.[0]?.ou_u?.[veikkausIndex]
                          const pUnderOdds = pinnacleOdds.fair_odds_ou?.fair_ou_u?.[pinnacleIndex]
                          if (vUnderOdds && pUnderOdds) {
                            const vDecimal = vUnderOdds / Math.pow(10, veikkausOdds.decimals)
                            const pDecimal = pUnderOdds / Math.pow(10, pinnacleOdds.decimals)
                            const ratio = (vDecimal / pDecimal).toFixed(3)
                            debugItems.push(
                              <div key={`under-${line}`} className="text-yellow-200 text-xs ml-2">
                                OU Under {line}: V={vDecimal.toFixed(veikkausOdds.decimals === 2 ? 2 : 3)} P={pDecimal.toFixed(pinnacleOdds.decimals === 2 ? 2 : 3)} Ratio={ratio}
                              </div>
                            )
                          }
                        })

                        return debugItems
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="text-yellow-500 text-xs mt-2">
            ✅ Using exact line matching - only comparing lines that exist in both bookies!
          </div>
        </div>
      )}
    </div>
  )
}