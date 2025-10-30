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

export interface ValueOpportunity {
  fixture: Fixture
  bookie: string
  type: 'x12' | 'ah' | 'ou'
  lineIndex?: number
  oddsIndex?: number
  oddsValue: number
  fairOddsValue: number
  ratio: number
  line?: number
}

export interface ValueCalculationConfig {
  /** Bookie that provides the fair odds baseline */
  fairOddsBookie: string
  /** Bookies to compare against fair odds */
  oddsBookies: string[]
  /** Minimum ratio threshold for value opportunities */
  minRatio: number
  /** Maximum odds threshold (optional) */
  maxOdds?: number
  /** Whether to include past fixtures */
  includePastFixtures?: boolean
}

/**
 * Calculates value opportunities by comparing bookie odds against fair odds
 * Supports multiple bookies, configurable thresholds, and different market types
 */
export function calculateValueOpportunities(
  fixtures: Fixture[],
  config: ValueCalculationConfig
): { opportunities: ValueOpportunity[], analyzedFixtures: number } {
  const {
    fairOddsBookie,
    oddsBookies,
    minRatio,
    maxOdds,
    includePastFixtures = false
  } = config

  const opportunities: ValueOpportunity[] = []
  let analyzedFixtures = 0

  fixtures.forEach(fixture => {
    // Skip past fixtures unless explicitly included
    if (!includePastFixtures) {
      const fixtureDate = new Date(fixture.date)
      const now = new Date()
      if (fixtureDate <= now) return
    }

    // Find fair odds bookie and all odds bookies
    const fairOddsBookieData = fixture.odds.find(o => o.bookie === fairOddsBookie)
    const oddsBookiesData = fixture.odds.filter(o => oddsBookies.includes(o.bookie))

    if (!fairOddsBookieData || oddsBookiesData.length === 0) return

    analyzedFixtures++

    // Process each odds bookie against the fair odds bookie
    oddsBookiesData.forEach(oddsBookieData => {
      // Analyze X12 odds (always 3 outcomes: Home, Draw, Away - no line matching needed)
      if (oddsBookieData.odds_x12 && fairOddsBookieData.fair_odds_x12 && oddsBookieData.odds_x12.length > 0) {
        const oddsX12 = oddsBookieData.odds_x12[0].x12
        const fairX12 = fairOddsBookieData.fair_odds_x12

        oddsX12.forEach((odds, index) => {
          if (fairX12[index] && odds > 0 && fairX12[index] > 0) {
            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
            const fairDecimal = fairX12[index] / Math.pow(10, fairOddsBookieData.decimals)

            // Skip if odds exceed max threshold
            if (maxOdds && oddsDecimal > maxOdds) return

            const ratio = oddsDecimal / fairDecimal
            if (ratio > minRatio) {
              opportunities.push({
                fixture,
                bookie: oddsBookieData.bookie,
                type: 'x12',
                oddsIndex: index,
                oddsValue: odds,
                fairOddsValue: fairX12[index],
                ratio
              })
            }
          }
        })
      }

      // Helper function for exact line matching
      const findMatchingLineIndex = (oddsLines: number[], fairLines: number[], targetLine: number): number | null => {
        const fairIndex = fairLines.indexOf(targetLine)
        return fairIndex !== -1 ? fairIndex : null
      }

      // Analyze AH odds with line matching
      if (oddsBookieData.odds_ah && fairOddsBookieData.fair_odds_ah && oddsBookieData.odds_ah.length > 0) {
        const oddsAH = oddsBookieData.odds_ah[0]
        const fairAH = fairOddsBookieData.fair_odds_ah
        const oddsLines = oddsBookieData.lines?.[0]?.ah || []
        const fairLines = fairOddsBookieData.fair_latest_lines?.ah || []

        // AH Away - match by lines
        if (oddsAH.ah_a && fairAH?.fair_ah_a && oddsLines.length > 0 && fairLines.length > 0) {
          oddsAH.ah_a.forEach((odds, oddsIndex) => {
            const oddsLine = oddsLines[oddsIndex]
            if (oddsLine !== undefined && odds > 0) {
              const fairIndex = findMatchingLineIndex(oddsLines, fairLines, oddsLine)
              if (fairIndex !== null && fairAH.fair_ah_a?.[fairIndex] && fairAH.fair_ah_a[fairIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairAH.fair_ah_a[fairIndex] / Math.pow(10, fairOddsBookieData.decimals)

                // Skip if odds exceed max threshold
                if (maxOdds && oddsDecimal > maxOdds) return

                const ratio = oddsDecimal / fairDecimal
                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ah',
                    lineIndex: oddsIndex,
                    oddsIndex: 0, // away
                    oddsValue: odds,
                    fairOddsValue: fairAH.fair_ah_a[fairIndex],
                    ratio,
                    line: oddsLine
                  })
                }
              }
            }
          })
        }

        // AH Home - match by lines
        if (oddsAH.ah_h && fairAH?.fair_ah_h && oddsLines.length > 0 && fairLines.length > 0) {
          oddsAH.ah_h.forEach((odds, oddsIndex) => {
            const oddsLine = oddsLines[oddsIndex]
            if (oddsLine !== undefined && odds > 0) {
              const fairIndex = findMatchingLineIndex(oddsLines, fairLines, oddsLine)
              if (fairIndex !== null && fairAH.fair_ah_h?.[fairIndex] && fairAH.fair_ah_h[fairIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairAH.fair_ah_h[fairIndex] / Math.pow(10, fairOddsBookieData.decimals)

                // Skip if odds exceed max threshold
                if (maxOdds && oddsDecimal > maxOdds) return

                const ratio = oddsDecimal / fairDecimal
                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ah',
                    lineIndex: oddsIndex,
                    oddsIndex: 1, // home
                    oddsValue: odds,
                    fairOddsValue: fairAH.fair_ah_h[fairIndex],
                    ratio,
                    line: oddsLine
                  })
                }
              }
            }
          })
        }
      }

      // Analyze OU odds with line matching
      if (oddsBookieData.odds_ou && fairOddsBookieData.fair_odds_ou && oddsBookieData.odds_ou.length > 0) {
        const oddsOU = oddsBookieData.odds_ou[0]
        const fairOU = fairOddsBookieData.fair_odds_ou
        const oddsLines = oddsBookieData.lines?.[0]?.ou || []
        const fairLines = fairOddsBookieData.fair_latest_lines?.ou || []

        // OU Over - match by lines
        if (oddsOU.ou_o && fairOU?.fair_ou_o && oddsLines.length > 0 && fairLines.length > 0) {
          oddsOU.ou_o.forEach((odds, oddsIndex) => {
            const oddsLine = oddsLines[oddsIndex]
            if (oddsLine !== undefined && odds > 0) {
              const fairIndex = findMatchingLineIndex(oddsLines, fairLines, oddsLine)
              if (fairIndex !== null && fairOU.fair_ou_o?.[fairIndex] && fairOU.fair_ou_o[fairIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairOU.fair_ou_o[fairIndex] / Math.pow(10, fairOddsBookieData.decimals)

                // Skip if odds exceed max threshold
                if (maxOdds && oddsDecimal > maxOdds) return

                const ratio = oddsDecimal / fairDecimal
                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ou',
                    lineIndex: oddsIndex,
                    oddsIndex: 0, // over
                    oddsValue: odds,
                    fairOddsValue: fairOU.fair_ou_o[fairIndex],
                    ratio,
                    line: oddsLine
                  })
                }
              }
            }
          })
        }

        // OU Under - match by lines
        if (oddsOU.ou_u && fairOU?.fair_ou_u && oddsLines.length > 0 && fairLines.length > 0) {
          oddsOU.ou_u.forEach((odds, oddsIndex) => {
            const oddsLine = oddsLines[oddsIndex]
            if (oddsLine !== undefined && odds > 0) {
              const fairIndex = findMatchingLineIndex(oddsLines, fairLines, oddsLine)
              if (fairIndex !== null && fairOU.fair_ou_u?.[fairIndex] && fairOU.fair_ou_u[fairIndex] > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairOU.fair_ou_u[fairIndex] / Math.pow(10, fairOddsBookieData.decimals)

                // Skip if odds exceed max threshold
                if (maxOdds && oddsDecimal > maxOdds) return

                const ratio = oddsDecimal / fairDecimal
                if (ratio > minRatio) {
                  opportunities.push({
                    fixture,
                    bookie: oddsBookieData.bookie,
                    type: 'ou',
                    lineIndex: oddsIndex,
                    oddsIndex: 1, // under
                    oddsValue: odds,
                    fairOddsValue: fairOU.fair_ou_u[fairIndex],
                    ratio,
                    line: oddsLine
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
