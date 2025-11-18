/**
 * Shared utility functions for odds processing
 */

// BookieOdds interface moved here since value-analysis.ts was removed
export interface BookieOdds {
  bookie: string;
  decimals: number;
  updated_at?: number;
  odds_x12?: Array<{ t: number; x12: number[] }>;
  odds_ah?: Array<{ t: number; ah_a: number[]; ah_h: number[] }>;
  odds_ou?: Array<{ t: number; ou_o: number[]; ou_u: number[] }>;
  lines?: Array<{ t: number; ah: number[]; ou: number[] }>;
  fair_odds_x12?: { t: number; x12: number[] };
  fair_odds_ah?: { t: number; fair_ah_a: number[]; fair_ah_h: number[] };
  fair_odds_ou?: { t: number; fair_ou_o: number[]; fair_ou_u: number[] };
  fair_odds_lines?: Array<{ t: number; ah: number[]; ou: number[] }>;
}

export interface BookieConfig {
  bookie: string;
  required: boolean;
  multiplier: number;
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
 * Gets the divisor for odds conversion (10^decimals)
 * @param decimals Number of decimal places
 * @returns Divisor value
 */
export function getOddsDivisor(decimals: number): number {
  return Math.pow(10, decimals);
}

/**
 * Calculates weighted average fair odds
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

