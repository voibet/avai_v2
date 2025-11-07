/**
 * Shared utility functions for value calculations and odds processing
 */

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
 * Checks if an outcome satisfies the required bookies criterion
 * @param availableRatios Array of available ratios
 * @param requiredFairBookies Array of required bookie names
 * @returns True if at least one required bookie is available
 */
export function meetsRequiredBookiesCriterion(
  availableRatios: Array<{fairBookie: string, ratio: number}>,
  requiredFairBookies: string[]
): boolean {
  if (requiredFairBookies.length === 0) return true;

  // At least ONE required bookie must have data for this outcome
  return requiredFairBookies.some(requiredBookie =>
    availableRatios.some(ratio => ratio.fairBookie === requiredBookie)
  );
}
