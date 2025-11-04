export interface Fixture {
  fixture_id: string
  home_team: string
  away_team: string
  date: string
  league: string
  odds: BookieOdds[]
  home_team_id?: number
  away_team_id?: number
  league_id?: number
  season?: string | number
  status_short?: string
  round?: string
}

export interface BookieOdds {
  bookie: string
  decimals: number
  updated_at?: number
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
  fair_odds_lines?: {
    ah?: number[]
    ou?: number[]
  }
}

export interface ValueOpportunity {
  fixture: Fixture
  bookie: string
  type: 'x12' | 'ah' | 'ou'
  lineIndex?: number
  oddsIndex?: number
  oddsBookieOdds: number
  fairOddsBookieOdds: number
  ratio: number
  line?: number
}

export interface ValueAnalysisConfig {
  fairOddsBookie: string | string[]
  oddsRatioBookies: string | string[]
  minRatio: number
  maxOdds?: number
  futureOnly?: boolean
}

/**
 * Analyzes fixtures for value opportunities by comparing odds ratios between bookies
 * @param fixtures Array of fixtures to analyze
 * @param config Configuration for the analysis
 * @returns Object containing opportunities and analyzed fixtures count
 */
export function analyzeValueOpportunities(
  fixtures: Fixture[],
  config: ValueAnalysisConfig
): { opportunities: ValueOpportunity[]; analyzedFixtures: number } {
  const { fairOddsBookie, oddsRatioBookies, minRatio, maxOdds, futureOnly = true } = config

  // Normalize fairOddsBookie and oddsRatioBookies to arrays
  const fairBookies = Array.isArray(fairOddsBookie) ? fairOddsBookie : [fairOddsBookie]
  const oddsBookies = Array.isArray(oddsRatioBookies) ? oddsRatioBookies : [oddsRatioBookies]

  // Compares odds using exact line matching - only lines that exist in both bookies are compared!
  // This ensures we're comparing equivalent handicap/over-under values between bookies.
  const opportunities: ValueOpportunity[] = []
  let analyzedFixtures = 0

  fixtures.forEach(fixture => {
    // Optionally filter to future fixtures only
    if (futureOnly) {
      const fixtureDate = new Date(fixture.date)
      const now = new Date()
      if (fixtureDate <= now) return
    }

    // Find all fair odds bookies
    const fairOddsBookieDataList = fairBookies
      .map(bookie => fixture.odds.find(o => o.bookie === bookie))
      .filter(Boolean)
    
    const oddsBookieDataList = oddsBookies
      .map(bookie => fixture.odds.find(o => o.bookie === bookie))
      .filter(Boolean)

    if (fairOddsBookieDataList.length === 0 || oddsBookieDataList.length === 0) return

    analyzedFixtures++

    // Analyze for each odds bookie
    oddsBookieDataList.forEach(oddsBookieData => {
      if (!oddsBookieData) return

      // Analyze X12 odds (always 3 outcomes: Home, Draw, Away - no line matching needed)
      if (oddsBookieData.odds_x12 && oddsBookieData.odds_x12.length > 0) {
        const oddsBookieX12 = oddsBookieData.odds_x12[0].x12

        oddsBookieX12.forEach((odds, index) => {
          if (odds <= 0) return

          const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)

          // Apply max odds filter if specified
          if (maxOdds && oddsDecimal > maxOdds) return

          // Check ratio against ALL fair odds bookies - must pass for ALL
          let passesAllFairBookies = true
          let minRatioValue = Infinity
          let primaryFairOdds = 0

          for (const fairOddsBookieData of fairOddsBookieDataList) {
            if (!fairOddsBookieData || !fairOddsBookieData.fair_odds_x12) {
              passesAllFairBookies = false
              break
            }

            const fairBookieX12 = fairOddsBookieData.fair_odds_x12
            if (!fairBookieX12[index] || fairBookieX12[index] <= 0) {
              passesAllFairBookies = false
              break
            }

            const fairDecimal = fairBookieX12[index] / Math.pow(10, fairOddsBookieData.decimals)
            const ratio = oddsDecimal / fairDecimal

            if (ratio <= minRatio) {
              passesAllFairBookies = false
              break
            }

            // Track the minimum ratio and use the first fair bookie's odds for display
            if (ratio < minRatioValue) {
              minRatioValue = ratio
              primaryFairOdds = fairBookieX12[index]
            }
          }

          if (passesAllFairBookies && minRatioValue > minRatio) {
            opportunities.push({
              fixture,
              bookie: oddsBookieData.bookie,
              type: 'x12',
              oddsIndex: index,
              oddsBookieOdds: odds,
              fairOddsBookieOdds: primaryFairOdds,
              ratio: minRatioValue
            })
          }
        })
      }

      // Only use lines that exist in both bookies (exact matches only)
      const findMatchingLineIndex = (oddsBookieLines: number[], fairBookieLines: number[], targetLine: number): number | null => {
        // Find exact match only
        const fairBookieIndex = fairBookieLines.indexOf(targetLine)
        return fairBookieIndex !== -1 ? fairBookieIndex : null
      }

      // Analyze AH odds with line matching
      if (oddsBookieData.odds_ah && oddsBookieData.odds_ah.length > 0) {
        const oddsBookieAH = oddsBookieData.odds_ah[0]
        const oddsBookieLines = oddsBookieData.lines?.[0]?.ah || []

        // AH Away - match by lines
        if (oddsBookieAH.ah_a && oddsBookieLines.length > 0) {
          oddsBookieAH.ah_a.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine === undefined || odds <= 0) return

            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)

            // Apply max odds filter if specified
            if (maxOdds && oddsDecimal > maxOdds) return

            // Check ratio against ALL fair odds bookies - must pass for ALL
            let passesAllFairBookies = true
            let minRatioValue = Infinity
            let primaryFairOdds = 0

            for (const fairOddsBookieData of fairOddsBookieDataList) {
              if (!fairOddsBookieData || !fairOddsBookieData.fair_odds_ah) {
                passesAllFairBookies = false
                break
              }

              const fairBookieAH = fairOddsBookieData.fair_odds_ah
              const fairBookieLines = fairOddsBookieData.fair_odds_lines?.ah || []

              if (fairBookieLines.length === 0) {
                passesAllFairBookies = false
                break
              }

              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex === null || !fairBookieAH.fair_ah_a?.[fairBookieIndex] || fairBookieAH.fair_ah_a[fairBookieIndex] <= 0) {
                passesAllFairBookies = false
                break
              }

              const fairDecimal = fairBookieAH.fair_ah_a[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
              const ratio = oddsDecimal / fairDecimal

              if (ratio <= minRatio) {
                passesAllFairBookies = false
                break
              }

              // Track the minimum ratio and use the first fair bookie's odds for display
              if (ratio < minRatioValue) {
                minRatioValue = ratio
                primaryFairOdds = fairBookieAH.fair_ah_a[fairBookieIndex]
              }
            }

            if (passesAllFairBookies && minRatioValue > minRatio) {
              opportunities.push({
                fixture,
                bookie: oddsBookieData.bookie,
                type: 'ah',
                lineIndex: oddsBookieIndex,
                oddsIndex: 0, // away
                oddsBookieOdds: odds,
                fairOddsBookieOdds: primaryFairOdds,
                ratio: minRatioValue,
                line: oddsBookieLine === 0 ? 0 : -oddsBookieLine
              })
            }
          })
        }

        // AH Home - match by lines
        if (oddsBookieAH.ah_h && oddsBookieLines.length > 0) {
          oddsBookieAH.ah_h.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine === undefined || odds <= 0) return

            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)

            // Apply max odds filter if specified
            if (maxOdds && oddsDecimal > maxOdds) return

            // Check ratio against ALL fair odds bookies - must pass for ALL
            let passesAllFairBookies = true
            let minRatioValue = Infinity
            let primaryFairOdds = 0

            for (const fairOddsBookieData of fairOddsBookieDataList) {
              if (!fairOddsBookieData || !fairOddsBookieData.fair_odds_ah) {
                passesAllFairBookies = false
                break
              }

              const fairBookieAH = fairOddsBookieData.fair_odds_ah
              const fairBookieLines = fairOddsBookieData.fair_odds_lines?.ah || []

              if (fairBookieLines.length === 0) {
                passesAllFairBookies = false
                break
              }

              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex === null || !fairBookieAH.fair_ah_h?.[fairBookieIndex] || fairBookieAH.fair_ah_h[fairBookieIndex] <= 0) {
                passesAllFairBookies = false
                break
              }

              const fairDecimal = fairBookieAH.fair_ah_h[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
              const ratio = oddsDecimal / fairDecimal

              if (ratio <= minRatio) {
                passesAllFairBookies = false
                break
              }

              // Track the minimum ratio and use the first fair bookie's odds for display
              if (ratio < minRatioValue) {
                minRatioValue = ratio
                primaryFairOdds = fairBookieAH.fair_ah_h[fairBookieIndex]
              }
            }

            if (passesAllFairBookies && minRatioValue > minRatio) {
              opportunities.push({
                fixture,
                bookie: oddsBookieData.bookie,
                type: 'ah',
                lineIndex: oddsBookieIndex,
                oddsIndex: 1, // home
                oddsBookieOdds: odds,
                fairOddsBookieOdds: primaryFairOdds,
                ratio: minRatioValue,
                line: oddsBookieLine
              })
            }
          })
        }
      }

      // Analyze OU odds with line matching
      if (oddsBookieData.odds_ou && oddsBookieData.odds_ou.length > 0) {
        const oddsBookieOU = oddsBookieData.odds_ou[0]
        const oddsBookieLines = oddsBookieData.lines?.[0]?.ou || []

        // OU Over - match by lines
        if (oddsBookieOU.ou_o && oddsBookieLines.length > 0) {
          oddsBookieOU.ou_o.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine === undefined || odds <= 0) return

            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)

            // Apply max odds filter if specified
            if (maxOdds && oddsDecimal > maxOdds) return

            // Check ratio against ALL fair odds bookies - must pass for ALL
            let passesAllFairBookies = true
            let minRatioValue = Infinity
            let primaryFairOdds = 0

            for (const fairOddsBookieData of fairOddsBookieDataList) {
              if (!fairOddsBookieData || !fairOddsBookieData.fair_odds_ou) {
                passesAllFairBookies = false
                break
              }

              const fairBookieOU = fairOddsBookieData.fair_odds_ou
              const fairBookieLines = fairOddsBookieData.fair_odds_lines?.ou || []

              if (fairBookieLines.length === 0) {
                passesAllFairBookies = false
                break
              }

              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex === null || !fairBookieOU.fair_ou_o?.[fairBookieIndex] || fairBookieOU.fair_ou_o[fairBookieIndex] <= 0) {
                passesAllFairBookies = false
                break
              }

              const fairDecimal = fairBookieOU.fair_ou_o[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
              const ratio = oddsDecimal / fairDecimal

              if (ratio <= minRatio) {
                passesAllFairBookies = false
                break
              }

              // Track the minimum ratio and use the first fair bookie's odds for display
              if (ratio < minRatioValue) {
                minRatioValue = ratio
                primaryFairOdds = fairBookieOU.fair_ou_o[fairBookieIndex]
              }
            }

            if (passesAllFairBookies && minRatioValue > minRatio) {
              opportunities.push({
                fixture,
                bookie: oddsBookieData.bookie,
                type: 'ou',
                lineIndex: oddsBookieIndex,
                oddsIndex: 0, // over
                oddsBookieOdds: odds,
                fairOddsBookieOdds: primaryFairOdds,
                ratio: minRatioValue,
                line: oddsBookieLine
              })
            }
          })
        }

        // OU Under - match by lines
        if (oddsBookieOU.ou_u && oddsBookieLines.length > 0) {
          oddsBookieOU.ou_u.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine === undefined || odds <= 0) return

            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)

            // Apply max odds filter if specified
            if (maxOdds && oddsDecimal > maxOdds) return

            // Check ratio against ALL fair odds bookies - must pass for ALL
            let passesAllFairBookies = true
            let minRatioValue = Infinity
            let primaryFairOdds = 0

            for (const fairOddsBookieData of fairOddsBookieDataList) {
              if (!fairOddsBookieData || !fairOddsBookieData.fair_odds_ou) {
                passesAllFairBookies = false
                break
              }

              const fairBookieOU = fairOddsBookieData.fair_odds_ou
              const fairBookieLines = fairOddsBookieData.fair_odds_lines?.ou || []

              if (fairBookieLines.length === 0) {
                passesAllFairBookies = false
                break
              }

              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex === null || !fairBookieOU.fair_ou_u?.[fairBookieIndex] || fairBookieOU.fair_ou_u[fairBookieIndex] <= 0) {
                passesAllFairBookies = false
                break
              }

              const fairDecimal = fairBookieOU.fair_ou_u[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
              const ratio = oddsDecimal / fairDecimal

              if (ratio <= minRatio) {
                passesAllFairBookies = false
                break
              }

              // Track the minimum ratio and use the first fair bookie's odds for display
              if (ratio < minRatioValue) {
                minRatioValue = ratio
                primaryFairOdds = fairBookieOU.fair_ou_u[fairBookieIndex]
              }
            }

            if (passesAllFairBookies && minRatioValue > minRatio) {
              opportunities.push({
                fixture,
                bookie: oddsBookieData.bookie,
                type: 'ou',
                lineIndex: oddsBookieIndex,
                oddsIndex: 1, // under
                oddsBookieOdds: odds,
                fairOddsBookieOdds: primaryFairOdds,
                ratio: minRatioValue,
                line: oddsBookieLine
              })
            }
          })
        }
      }
    })
  })

  return { opportunities, analyzedFixtures }
}
