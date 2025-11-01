export interface Fixture {
  fixture_id: string
  home_team: string
  away_team: string
  date: string
  league: string
  odds: BookieOdds[]
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
  fair_latest_lines?: {
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
  fairOddsBookie: string
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

  // Normalize oddsRatioBookies to array
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

    // Find the fair odds bookie and all odds ratio bookies
    const fairOddsBookieData = fixture.odds.find(o => o.bookie === fairOddsBookie)
    const oddsBookieDataList = oddsBookies
      .map(bookie => fixture.odds.find(o => o.bookie === bookie))
      .filter(Boolean)

    if (!fairOddsBookieData || oddsBookieDataList.length === 0) return

    analyzedFixtures++

    // Analyze for each odds bookie
    oddsBookieDataList.forEach(oddsBookieData => {
      if (!oddsBookieData) return

      // Analyze X12 odds (always 3 outcomes: Home, Draw, Away - no line matching needed)
      if (oddsBookieData.odds_x12 && fairOddsBookieData.fair_odds_x12 && oddsBookieData.odds_x12.length > 0) {
        const oddsBookieX12 = oddsBookieData.odds_x12[0].x12
        const fairBookieX12 = fairOddsBookieData.fair_odds_x12

        oddsBookieX12.forEach((odds, index) => {
          if (fairBookieX12[index] && odds > 0 && fairBookieX12[index] > 0) {
            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
            const fairDecimal = fairBookieX12[index] / Math.pow(10, fairOddsBookieData.decimals)
            const ratio = oddsDecimal / fairDecimal

            // Apply max odds filter if specified
            if (maxOdds && oddsDecimal > maxOdds) return

            if (ratio > minRatio) {
              opportunities.push({
                fixture,
                bookie: oddsBookieData.bookie,
                type: 'x12',
                oddsIndex: index,
                oddsBookieOdds: odds,
                fairOddsBookieOdds: fairBookieX12[index],
                ratio
              })
            }
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
      if (oddsBookieData.odds_ah && fairOddsBookieData.fair_odds_ah && oddsBookieData.odds_ah.length > 0) {
        const oddsBookieAH = oddsBookieData.odds_ah[0]
        const fairBookieAH = fairOddsBookieData.fair_odds_ah
        const oddsBookieLines = oddsBookieData.lines?.[0]?.ah || []
        const fairBookieLines = fairOddsBookieData.fair_latest_lines?.ah || []

        // AH Away - match by lines
        if (oddsBookieAH.ah_a && fairBookieAH?.fair_ah_a && oddsBookieLines.length > 0 && fairBookieLines.length > 0) {
          oddsBookieAH.ah_a.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine !== undefined && odds > 0) {
              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex !== null && fairBookieAH.fair_ah_a?.[fairBookieIndex] && fairBookieAH.fair_ah_a[fairBookieIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairBookieAH.fair_ah_a[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
                const ratio = oddsDecimal / fairDecimal

                // Apply max odds filter if specified
                if (maxOdds && oddsDecimal > maxOdds) return

                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ah',
                    lineIndex: oddsBookieIndex,
                    oddsIndex: 0, // away
                    oddsBookieOdds: odds,
                    fairOddsBookieOdds: fairBookieAH.fair_ah_a[fairBookieIndex],
                    ratio,
                    line: oddsBookieLine
                  })
                }
              }
            }
          })
        }

        // AH Home - match by lines
        if (oddsBookieAH.ah_h && fairBookieAH?.fair_ah_h && oddsBookieLines.length > 0 && fairBookieLines.length > 0) {
          oddsBookieAH.ah_h.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine !== undefined && odds > 0) {
              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex !== null && fairBookieAH.fair_ah_h?.[fairBookieIndex] && fairBookieAH.fair_ah_h[fairBookieIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairBookieAH.fair_ah_h[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
                const ratio = oddsDecimal / fairDecimal

                // Apply max odds filter if specified
                if (maxOdds && oddsDecimal > maxOdds) return

                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ah',
                    lineIndex: oddsBookieIndex,
                    oddsIndex: 1, // home
                    oddsBookieOdds: odds,
                    fairOddsBookieOdds: fairBookieAH.fair_ah_h[fairBookieIndex],
                    ratio,
                    line: oddsBookieLine
                  })
                }
              }
            }
          })
        }
      }

      // Analyze OU odds with line matching
      if (oddsBookieData.odds_ou && fairOddsBookieData.fair_odds_ou && oddsBookieData.odds_ou.length > 0) {
        const oddsBookieOU = oddsBookieData.odds_ou[0]
        const fairBookieOU = fairOddsBookieData.fair_odds_ou
        const oddsBookieLines = oddsBookieData.lines?.[0]?.ou || []
        const fairBookieLines = fairOddsBookieData.fair_latest_lines?.ou || []

        // OU Over - match by lines
        if (oddsBookieOU.ou_o && fairBookieOU?.fair_ou_o && oddsBookieLines.length > 0 && fairBookieLines.length > 0) {
          oddsBookieOU.ou_o.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine !== undefined && odds > 0) {
              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex !== null && fairBookieOU.fair_ou_o?.[fairBookieIndex] && fairBookieOU.fair_ou_o[fairBookieIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairBookieOU.fair_ou_o[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
                const ratio = oddsDecimal / fairDecimal

                // Apply max odds filter if specified
                if (maxOdds && oddsDecimal > maxOdds) return

                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ou',
                    lineIndex: oddsBookieIndex,
                    oddsIndex: 0, // over
                    oddsBookieOdds: odds,
                    fairOddsBookieOdds: fairBookieOU.fair_ou_o[fairBookieIndex],
                    ratio,
                    line: oddsBookieLine
                  })
                }
              }
            }
          })
        }

        // OU Under - match by lines
        if (oddsBookieOU.ou_u && fairBookieOU?.fair_ou_u && oddsBookieLines.length > 0 && fairBookieLines.length > 0) {
          oddsBookieOU.ou_u.forEach((odds, oddsBookieIndex) => {
            const oddsBookieLine = oddsBookieLines[oddsBookieIndex]
            if (oddsBookieLine !== undefined && odds > 0) {
              const fairBookieIndex = findMatchingLineIndex(oddsBookieLines, fairBookieLines, oddsBookieLine)
              if (fairBookieIndex !== null && fairBookieOU.fair_ou_u?.[fairBookieIndex] && fairBookieOU.fair_ou_u[fairBookieIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairBookieOU.fair_ou_u[fairBookieIndex] / Math.pow(10, fairOddsBookieData.decimals)
                const ratio = oddsDecimal / fairDecimal

                // Apply max odds filter if specified
                if (maxOdds && oddsDecimal > maxOdds) return

                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ou',
                    lineIndex: oddsBookieIndex,
                    oddsIndex: 1, // under
                    oddsBookieOdds: odds,
                    fairOddsBookieOdds: fairBookieOU.fair_ou_u[fairBookieIndex],
                    ratio,
                    line: oddsBookieLine
                  })
                }
              }
            }
          })
        }
      }
    })
  })

  return { opportunities, analyzedFixtures }
}
