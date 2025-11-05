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

export interface BookieRatio {
  fair_odds_bookie: string
  odds_bookie: string
  ratios_x12?: number[]
  ratios_ah?: {
    ratios_ah_a?: number[]
    ratios_ah_h?: number[]
  }
  ratios_ou?: {
    ratios_ou_o?: number[]
    ratios_ou_u?: number[]
  }
  ratios_lines?: {
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

export interface ValueOpportunityWithRatios {
  fixture: Fixture & {
    ratios: BookieRatio[]
  }
}

export interface ValueAnalysisConfig {
  fairOddsBookie: string | string[]
  oddsRatioBookies: string | string[]
  minRatio: number
  maxOdds?: number
  futureOnly?: boolean
}

/**
 * Analyzes fixtures for all value opportunities by comparing odds ratios between bookies
 * Returns ratios for all markets, outcomes and lines organized by bookie combinations
 * @param fixtures Array of fixtures to analyze
 * @param config Configuration for the analysis
 * @returns Object containing opportunities and analyzed fixtures count
 */
export function analyzeValueOpportunities(
  fixtures: Fixture[],
  config: ValueAnalysisConfig
): { opportunities: ValueOpportunityWithRatios[]; analyzedFixtures: number } {
  const { fairOddsBookie, oddsRatioBookies, maxOdds, futureOnly = true } = config

  // Normalize fairOddsBookie and oddsRatioBookies to arrays
  const fairBookies = Array.isArray(fairOddsBookie) ? fairOddsBookie : [fairOddsBookie]
  const oddsBookies = Array.isArray(oddsRatioBookies) ? oddsRatioBookies : [oddsRatioBookies]

  const opportunities: ValueOpportunityWithRatios[] = []
  let analyzedFixtures = 0

  fixtures.forEach(fixture => {
    // Optionally filter to future fixtures only
    if (futureOnly) {
      const fixtureDate = new Date(fixture.date)
      const now = new Date()
      if (fixtureDate <= now) return
    }

    // Find all fair odds and odds bookies for this fixture
    const fairOddsBookieDataList = fairBookies
      .map(bookie => fixture.odds.find(o => o.bookie === bookie))
      .filter(Boolean)

    const oddsBookieDataList = oddsBookies
      .map(bookie => fixture.odds.find(o => o.bookie === bookie))
      .filter(Boolean)

    if (fairOddsBookieDataList.length === 0 || oddsBookieDataList.length === 0) return

    analyzedFixtures++

    const fixtureRatios: BookieRatio[] = []

    // For each fair odds bookie
    fairOddsBookieDataList.forEach(fairOddsBookieData => {
      if (!fairOddsBookieData) return

      // For each odds bookie
      oddsBookieDataList.forEach(oddsBookieData => {
        if (!oddsBookieData) return

        const bookieRatio: BookieRatio = {
          fair_odds_bookie: fairOddsBookieData.bookie,
          odds_bookie: oddsBookieData.bookie
        }

        // Calculate X12 ratios
        if (oddsBookieData.odds_x12 && oddsBookieData.odds_x12.length > 0 &&
            fairOddsBookieData.fair_odds_x12) {
          const oddsBookieX12 = oddsBookieData.odds_x12[0].x12
          const fairBookieX12 = fairOddsBookieData.fair_odds_x12
          const ratios_x12: number[] = []

          oddsBookieX12.forEach((odds, index) => {
            if (odds <= 0 || !fairBookieX12[index] || fairBookieX12[index] <= 0) {
              ratios_x12.push(0)
              return
            }

            const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
            const fairDecimal = fairBookieX12[index] / Math.pow(10, fairOddsBookieData.decimals)

            // Apply max odds filter if specified
            if (maxOdds && oddsDecimal > maxOdds) {
              ratios_x12.push(0)
              return
            }

            const ratio = oddsDecimal / fairDecimal
            ratios_x12.push(ratio)
          })

          bookieRatio.ratios_x12 = ratios_x12
        }

        // Calculate AH ratios with line matching
        if (oddsBookieData.odds_ah && oddsBookieData.odds_ah.length > 0 &&
            fairOddsBookieData.fair_odds_ah) {
          const oddsBookieAH = oddsBookieData.odds_ah[0]
          const oddsBookieLines = oddsBookieData.lines?.[0]?.ah || []
          const fairBookieAH = fairOddsBookieData.fair_odds_ah
          const fairBookieLines = fairOddsBookieData.fair_odds_lines?.ah || []

          const ratios_ah_a: number[] = []
          const ratios_ah_h: number[] = []

          // Find matching lines and calculate ratios
          oddsBookieLines.forEach((oddsLine, oddsIndex) => {
            const fairIndex = fairBookieLines.indexOf(oddsLine)
            if (fairIndex === -1) {
              ratios_ah_a.push(0)
              ratios_ah_h.push(0)
              return
            }

            // AH Away ratios
            if (oddsBookieAH.ah_a?.[oddsIndex] && fairBookieAH.fair_ah_a?.[fairIndex]) {
              const odds = oddsBookieAH.ah_a[oddsIndex]
              const fairOdds = fairBookieAH.fair_ah_a[fairIndex]

              if (odds > 0 && fairOdds > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairOdds / Math.pow(10, fairOddsBookieData.decimals)

                if (!maxOdds || oddsDecimal <= maxOdds) {
                  ratios_ah_a.push(oddsDecimal / fairDecimal)
                } else {
                  ratios_ah_a.push(0)
                }
              } else {
                ratios_ah_a.push(0)
              }
            } else {
              ratios_ah_a.push(0)
            }

            // AH Home ratios
            if (oddsBookieAH.ah_h?.[oddsIndex] && fairBookieAH.fair_ah_h?.[fairIndex]) {
              const odds = oddsBookieAH.ah_h[oddsIndex]
              const fairOdds = fairBookieAH.fair_ah_h[fairIndex]

              if (odds > 0 && fairOdds > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairOdds / Math.pow(10, fairOddsBookieData.decimals)

                if (!maxOdds || oddsDecimal <= maxOdds) {
                  ratios_ah_h.push(oddsDecimal / fairDecimal)
                } else {
                  ratios_ah_h.push(0)
                }
              } else {
                ratios_ah_h.push(0)
              }
            } else {
              ratios_ah_h.push(0)
            }
          })

          bookieRatio.ratios_ah = {
            ratios_ah_a,
            ratios_ah_h
          }
          bookieRatio.ratios_lines = {
            ...bookieRatio.ratios_lines,
            ah: oddsBookieLines
          }
        }

        // Calculate OU ratios with line matching
        if (oddsBookieData.odds_ou && oddsBookieData.odds_ou.length > 0 &&
            fairOddsBookieData.fair_odds_ou) {
          const oddsBookieOU = oddsBookieData.odds_ou[0]
          const oddsBookieLines = oddsBookieData.lines?.[0]?.ou || []
          const fairBookieOU = fairOddsBookieData.fair_odds_ou
          const fairBookieLines = fairOddsBookieData.fair_odds_lines?.ou || []

          const ratios_ou_o: number[] = []
          const ratios_ou_u: number[] = []

          // Find matching lines and calculate ratios
          oddsBookieLines.forEach((oddsLine, oddsIndex) => {
            const fairIndex = fairBookieLines.indexOf(oddsLine)
            if (fairIndex === -1) {
              ratios_ou_o.push(0)
              ratios_ou_u.push(0)
              return
            }

            // OU Over ratios
            if (oddsBookieOU.ou_o?.[oddsIndex] && fairBookieOU.fair_ou_o?.[fairIndex]) {
              const odds = oddsBookieOU.ou_o[oddsIndex]
              const fairOdds = fairBookieOU.fair_ou_o[fairIndex]

              if (odds > 0 && fairOdds > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairOdds / Math.pow(10, fairOddsBookieData.decimals)

                if (!maxOdds || oddsDecimal <= maxOdds) {
                  ratios_ou_o.push(oddsDecimal / fairDecimal)
                } else {
                  ratios_ou_o.push(0)
                }
              } else {
                ratios_ou_o.push(0)
              }
            } else {
              ratios_ou_o.push(0)
            }

            // OU Under ratios
            if (oddsBookieOU.ou_u?.[oddsIndex] && fairBookieOU.fair_ou_u?.[fairIndex]) {
              const odds = oddsBookieOU.ou_u[oddsIndex]
              const fairOdds = fairBookieOU.fair_ou_u[fairIndex]

              if (odds > 0 && fairOdds > 0) {
                const oddsDecimal = odds / Math.pow(10, oddsBookieData.decimals)
                const fairDecimal = fairOdds / Math.pow(10, fairOddsBookieData.decimals)

                if (!maxOdds || oddsDecimal <= maxOdds) {
                  ratios_ou_u.push(oddsDecimal / fairDecimal)
                } else {
                  ratios_ou_u.push(0)
                }
              } else {
                ratios_ou_u.push(0)
              }
            } else {
              ratios_ou_u.push(0)
            }
          })

          bookieRatio.ratios_ou = {
            ratios_ou_o,
            ratios_ou_u
          }
          bookieRatio.ratios_lines = {
            ...bookieRatio.ratios_lines,
            ou: oddsBookieLines
          }
        }

        fixtureRatios.push(bookieRatio)
      })
    })

    opportunities.push({
      fixture: {
        ...fixture,
        ratios: fixtureRatios
      } as Fixture & { ratios: BookieRatio[] }
    })
  })

  return { opportunities, analyzedFixtures }
}
