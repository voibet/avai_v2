/**
 * Shared utility functions for value calculations and odds processing
 */

import type { BookieOdds } from './value-analysis';

export interface BookieConfig {
  bookie: string;
  required: boolean;
  multiplier: number;
}

/**
 * Calculates weighted average ratio based on bookie multipliers
 * @param availableRatios Array of ratios with their corresponding fair odds bookies
 * @param fairOddsBookies Configuration array for bookie multipliers
 * @returns Weighted average ratio
 */
export function calculateWeightedAverage(
  availableRatios: Array<{fairBookie: string, ratio: number}>,
  fairOddsBookies: BookieConfig[]
): number {
  let totalWeightedSum = 0;
  let totalWeight = 0;

  availableRatios.forEach(({fairBookie, ratio}) => {
    const bookieConfig = fairOddsBookies.find(config => config.bookie === fairBookie);
    const multiplier = bookieConfig?.multiplier || 1;
    totalWeightedSum += ratio * multiplier;
    totalWeight += multiplier;
  });

  return totalWeight > 0 ? totalWeightedSum / totalWeight : 0;
}

/**
 * Converts odds from integer representation to decimal
 * @param odds Integer odds value
 * @param decimals Number of decimal places to divide by (10^decimals)
 * @returns Decimal odds value
 */
export function convertOddsToDecimal(odds: number, decimals: number): number {
  return odds / Math.pow(10, decimals);
}

/**
 * Formats odds for display with specified decimal places
 * @param odds Integer odds value
 * @param decimals Number of decimal places
 * @returns Formatted odds string
 */
export function formatOdds(odds: number, decimals: number): string {
  return convertOddsToDecimal(odds, decimals).toFixed(decimals);
}

/**
 * Gets the divisor for odds conversion (10^decimals)
 * @param decimals Number of decimal places
 * @returns Divisor value
 */
export function getOddsDivisor(decimals: number): number {
  return Math.pow(10, decimals);
}

/**
 * Calculates weighted average fair odds instead of ratios
 * @param availableFairOdds Array of fair odds with their corresponding fair odds bookies
 * @param fairOddsBookies Configuration array for bookie multipliers
 * @returns Weighted average fair odds
 */
export function calculateWeightedAverageFairOdds(
  availableFairOdds: Array<{fairBookie: string, fairOdds: number}>,
  fairOddsBookies: BookieConfig[]
): number {
  let totalWeightedSum = 0;
  let totalWeight = 0;

  availableFairOdds.forEach(({fairBookie, fairOdds}) => {
    const bookieConfig = fairOddsBookies.find(config => config.bookie === fairBookie);
    const multiplier = bookieConfig?.multiplier || 1;
    totalWeightedSum += fairOdds * multiplier;
    totalWeight += multiplier;
  });

  return totalWeight > 0 ? totalWeightedSum / totalWeight : 0;
}

/**
 * Checks if an outcome satisfies the required bookies criterion using ratios
 * @param availableRatios Array of available ratios
 * @param requiredFairBookies Array of required bookie names
 * @returns True if at least one required bookie is available
 */
export function meetsRequiredBookiesCriterionWithRatios(
  availableRatios: Array<{fairBookie: string, ratio: number}>,
  requiredFairBookies: string[]
): boolean {
  if (requiredFairBookies.length === 0) return true;

  // At least ONE required bookie must have data for this outcome
  return requiredFairBookies.some(requiredBookie =>
    availableRatios.some(ratio => ratio.fairBookie === requiredBookie)
  );
}

/**
 * Checks if an outcome satisfies the required bookies criterion using fair odds
 * @param availableFairOdds Array of available fair odds
 * @param requiredFairBookies Array of required bookie names
 * @param oddsDecimal The odds value in decimal format
 * @returns True if at least one required bookie is available
 */
export function meetsRequiredBookiesCriterionWithFairOdds(
  availableFairOdds: Array<{fairBookie: string, fairOdds: number}>,
  requiredFairBookies: string[],
  oddsDecimal: number
): boolean {
  if (requiredFairBookies.length === 0) return true;

  // At least ONE required bookie must have data for this outcome
  return requiredFairBookies.some(requiredBookie => {
    const requiredFairOdds = availableFairOdds.find(f => f.fairBookie === requiredBookie);
    return requiredFairOdds && (oddsDecimal / requiredFairOdds.fairOdds > 1.0);
  });
}

/**
 * Gets all available ratios for a specific outcome across all fair odds bookies
 * @param fixture The fixture object containing ratio data
 * @param oddsBookie The odds bookie to get ratios for
 * @param type The bet type ('x12', 'ah', 'ou')
 * @param oddsIndex The index within the bet type (0=home/draw/away/over/away, 1=draw/away/under/home)
 * @param lineIndex The line index for AH/OU bets
 * @param fairOddsBookies Array of selected fair odds bookies
 * @returns Array of ratios with fair bookie names
 */
export function getRatiosForOutcome(
  fixture: any,
  oddsBookie: string,
  type: string,
  oddsIndex: number,
  lineIndex: number,
  fairOddsBookies: BookieConfig[]
): Array<{fairBookie: string, ratio: number}> {
  const ratios: Array<{fairBookie: string, ratio: number}> = []

  // Look through all ratio entries in the fixture
  const fixtureRatios = (fixture as any).ratios || []
  fixtureRatios.forEach((ratioEntry: any) => {
    // Only consider ratios for the current odds bookie
    if (ratioEntry.odds_bookie !== oddsBookie) return

    // Only consider selected fair odds bookies
    const isSelectedFairBookie = fairOddsBookies.some(config => config.bookie === ratioEntry.fair_odds_bookie)
    if (!isSelectedFairBookie) return

    // Extract the ratio for this specific outcome
    let ratio = 0
    switch (type) {
      case 'x12':
        if (ratioEntry.ratios_x12 && ratioEntry.ratios_x12[oddsIndex] > 0) {
          ratio = ratioEntry.ratios_x12[oddsIndex]
        }
        break
      case 'ah':
        if (ratioEntry.ratios_ah) {
          const ahArray = oddsIndex === 0 ? ratioEntry.ratios_ah.ratios_ah_a : ratioEntry.ratios_ah.ratios_ah_h
          if (ahArray && ahArray[lineIndex] > 0) {
            ratio = ahArray[lineIndex]
          }
        }
        break
      case 'ou':
        if (ratioEntry.ratios_ou) {
          const ouArray = oddsIndex === 0 ? ratioEntry.ratios_ou.ratios_ou_o : ratioEntry.ratios_ou.ratios_ou_u
          if (ouArray && ouArray[lineIndex] > 0) {
            ratio = ouArray[lineIndex]
          }
        }
        break
    }

    if (ratio > 0) {
      ratios.push({
        fairBookie: ratioEntry.fair_odds_bookie,
        ratio: ratio
      })
    }
  })

  return ratios
}

/**
 * Gets all available fair odds for a specific outcome across all fair odds bookies
 * @param fixture The fixture object containing fair odds data
 * @param oddsBookie The odds bookie to get fair odds for
 * @param type The bet type ('x12', 'ah', 'ou')
 * @param oddsIndex The index within the bet type (0=home/draw/away/over/away, 1=draw/away/under/home)
 * @param lineIndex The line index for AH/OU bets
 * @param fairOddsBookies Array of selected fair odds bookies
 * @returns Array of fair odds with fair bookie names
 */
export function getFairOddsForOutcome(
  fixture: any,
  oddsBookie: string,
  type: string,
  oddsIndex: number,
  lineIndex: number,
  fairOddsBookies: BookieConfig[]
): Array<{fairBookie: string, fairOdds: number}> {
  const fairOdds: Array<{fairBookie: string, fairOdds: number}> = []

  // First, find the odds bookie's lines to know which line we're looking for
  const fixtureRatios = (fixture as any).ratios || []
  let targetLine: number | undefined

  // Find the target line from the odds bookie's data
  const oddsBookieRatio = fixtureRatios.find((ratioEntry: any) => ratioEntry.odds_bookie === oddsBookie)
  if (oddsBookieRatio) {
    const lines = oddsBookieRatio.ratios_lines
    if (lines) {
      if (type === 'ah' && lines.ah && lines.ah[lineIndex] !== undefined) {
        targetLine = lines.ah[lineIndex]
      } else if (type === 'ou' && lines.ou && lines.ou[lineIndex] !== undefined) {
        targetLine = lines.ou[lineIndex]
      }
    }
  }

  // Look through all fair odds entries in the fixture
  const fixtureFairOdds = (fixture as any).fair_odds || []
  fixtureFairOdds.forEach((fairOddsEntry: any) => {
    // Only consider selected fair odds bookies
    const isSelectedFairBookie = fairOddsBookies.some(config => config.bookie === fairOddsEntry.bookie)
    if (!isSelectedFairBookie) return

    // Extract the fair odds for this specific outcome
    let outcomeFairOdds = 0

    if (type === 'x12') {
      if (fairOddsEntry.fair_odds_x12 && fairOddsEntry.fair_odds_x12.x12 && fairOddsEntry.fair_odds_x12.x12[oddsIndex] > 0) {
        outcomeFairOdds = fairOddsEntry.fair_odds_x12.x12[oddsIndex] / Math.pow(10, fairOddsEntry.decimals)
      }
    } else {
      // For AH and OU, we need to find the matching line
      const fairLines = fairOddsEntry.fair_odds_lines?.[0]
      let fairLineIndex = -1

      if (targetLine !== undefined && fairLines) {
        if (type === 'ah' && fairLines.ah) {
          fairLineIndex = fairLines.ah.findIndex((l: number) => Math.abs(l - targetLine) < 0.0001)
        } else if (type === 'ou' && fairLines.ou) {
          fairLineIndex = fairLines.ou.findIndex((l: number) => Math.abs(l - targetLine) < 0.0001)
        }
      }

      outcomeFairOdds = getFairOddsValueForOutcome(fairOddsEntry, type, oddsIndex, targetLine, fairLines);
    }

    if (outcomeFairOdds > 1) {
      fairOdds.push({fairBookie: fairOddsEntry.bookie, fairOdds: outcomeFairOdds})
    }
  })

  return fairOdds
}

/**
 * Gets the fair odds value for a specific outcome, with validation for AH/OU
 * @param fairOddsData The fair odds data for a bookie
 * @param type The bet type ('x12', 'ah', 'ou')
 * @param oddsIndex The index within the bet type
 * @param targetLine The target line value (for AH/OU)
 * @param fairLines The fair lines array (for AH/OU)
 * @returns The fair odds value in decimal, or 0 if invalid
 */
export function getFairOddsValueForOutcome(
  fairOddsData: BookieOdds,
  type: string,
  oddsIndex: number,
  targetLine: number | undefined,
  fairLinesObj: { ah?: number[], ou?: number[] } | undefined
): number {
  if (type === 'x12') {
    if (fairOddsData.fair_odds_x12 && fairOddsData.fair_odds_x12.x12 && fairOddsData.fair_odds_x12.x12[oddsIndex] > 1) {
      return fairOddsData.fair_odds_x12.x12[oddsIndex] / Math.pow(10, fairOddsData.decimals);
    }
  } else {
    // AH or OU
    const fairLines = fairLinesObj?.[type === 'ah' ? 'ah' : 'ou'] || [];
    let fairLineIndex = -1;
    if (targetLine !== undefined && fairLines.length > 0) {
      fairLineIndex = fairLines.findIndex((l: number) => Math.abs(l - targetLine) < 0.0001);
    }

    if (fairLineIndex !== -1) {
      if (type === 'ah' && fairOddsData.fair_odds_ah) {
        const fairAhA = fairOddsData.fair_odds_ah.fair_ah_a;
        const fairAhH = fairOddsData.fair_odds_ah.fair_ah_h;
        if (Array.isArray(fairAhA) && Array.isArray(fairAhH) &&
            fairAhA[fairLineIndex] > 1 && fairAhH[fairLineIndex] > 1) {
          if (oddsIndex === 0 && fairAhA[fairLineIndex] > 1) {
            return fairAhA[fairLineIndex] / Math.pow(10, fairOddsData.decimals);
          } else if (oddsIndex === 1 && fairAhH[fairLineIndex] > 1) {
            return fairAhH[fairLineIndex] / Math.pow(10, fairOddsData.decimals);
          }
        }
      } else if (type === 'ou' && fairOddsData.fair_odds_ou) {
        const fairOuO = fairOddsData.fair_odds_ou.fair_ou_o;
        const fairOuU = fairOddsData.fair_odds_ou.fair_ou_u;
        if (Array.isArray(fairOuO) && Array.isArray(fairOuU) &&
            fairOuO[fairLineIndex] > 1 && fairOuU[fairLineIndex] > 1) {
          if (oddsIndex === 0 && fairOuO[fairLineIndex] > 1) {
            return fairOuO[fairLineIndex] / Math.pow(10, fairOddsData.decimals);
          } else if (oddsIndex === 1 && fairOuU[fairLineIndex] > 1) {
            return fairOuU[fairLineIndex] / Math.pow(10, fairOddsData.decimals);
          }
        }
      }
    }
  }

  return 0;
}

/**
 * Gets a human-readable label for a bet type
 * @param type The bet type ('x12', 'ah', 'ou')
 * @param oddsIndex The index within the bet type
 * @param line The line value for AH/OU bets
 * @returns Human-readable label
 */
export function getTypeLabel(type: string, oddsIndex?: number, line?: number): string {
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
