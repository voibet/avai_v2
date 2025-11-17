/**
 * Shared Poisson Distribution Utilities
 * Used by both market XG and prediction odds calculators
 */

/**
 * Poisson PMF: P(k; λ) = (λ^k * e^(-λ)) / k!
 */
export function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return 0;
  let logProb = k * Math.log(lambda) - lambda;
  // Subtract log(k!)
  for (let i = 2; i <= k; i++) {
    logProb -= Math.log(i);
  }
  return Math.exp(logProb);
}

/**
 * Dixon-Coles correlation adjustment for low-scoring games
 * Applies safety bounds to prevent invalid probabilities
 */
export function dixonColesAdjustment(homeGoals: number, awayGoals: number, homeXg: number, awayXg: number, rho: number = -0.1): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return Math.max(0.1, 1 - homeXg * awayXg * rho);
  } else if (homeGoals === 0 && awayGoals === 1) {
    return Math.max(0.1, 1 + homeXg * rho);
  } else if (homeGoals === 1 && awayGoals === 0) {
    return Math.max(0.1, 1 + awayXg * rho);
  } else if (homeGoals === 1 && awayGoals === 1) {
    return Math.max(0.1, 1 - rho);
  }
  return 1.0;
}

export interface PoissonProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  over: number;
}

/**
 * Calculate match probabilities using Dixon-Coles Poisson model with dynamic rho
 * Simple, accurate calculation with dynamic favorite boost and optional adjustments
 */
export function poissonProbabilities(
  homeXg: number,
  awayXg: number,
  overLine: number = 2.5,
  maxGoals: number = 10,
  useDixonColes: boolean = true,
  rho: number = -0.1,
  homeAdjustment: number = 1,
  awayAdjustment: number = 1,
  userRho: number = 0
): PoissonProbabilities {
  // Dynamic rho adjustment based on total goals, with user override
  const totalGoals = homeXg + awayXg;
  const dynamicRho = useDixonColes ? (-0.05 * totalGoals * 0.42 - userRho) : rho;

  // Calculate dynamic favorite boost based on goal difference
  const goalDiff = Math.abs(homeXg - awayXg);
  const favBoostMultiplier = 0.12;
  const favouriteBoost = goalDiff * favBoostMultiplier + 1;

  // Apply favorite boost with additional manual adjustments
  const finalHomeAdj = (homeXg > awayXg ? favouriteBoost : 2 - favouriteBoost) * homeAdjustment;
  const finalAwayAdj = (awayXg > homeXg ? favouriteBoost : 2 - favouriteBoost) * awayAdjustment;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over = 0;
  let totalProb = 0;

  // Calculate all score probabilities
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      // Basic Poisson probability
      let prob = poissonPMF(i, homeXg) * poissonPMF(j, awayXg);

      // Apply home/away adjustments based on who's leading
      if (i > j) {
        prob *= finalHomeAdj;
      } else if (j > i) {
        prob *= finalAwayAdj;
      }

      // Apply Dixon-Coles adjustment for low scores
      if (useDixonColes && (i <= 1 && j <= 1)) {
        if (i === 0 && j === 0) {
          prob *= dixonColesAdjustment(i, j, homeXg, awayXg, dynamicRho);
        } else if (i === 0 && j === 1) {
          prob *= dixonColesAdjustment(i, j, homeXg, awayXg, dynamicRho);
        } else if (i === 1 && j === 0) {
          prob *= dixonColesAdjustment(i, j, homeXg, awayXg, dynamicRho);
        } else if (i === 1 && j === 1) {
          prob *= dixonColesAdjustment(i, j, homeXg, awayXg, dynamicRho);
        }
      }

      // Ensure valid probability
      prob = Math.max(0, prob);
      if (!isFinite(prob)) prob = 0;

      totalProb += prob;

      // Accumulate results
      if (i > j) {
        homeWin += prob;
      } else if (i === j) {
        draw += prob;
      } else {
        awayWin += prob;
      }

      if (i + j > overLine) {
        over += prob;
      }
    }
  }

  // Normalize if needed
  if (totalProb > 0) {
    const factor = 1 / totalProb;
    homeWin *= factor;
    draw *= factor;
    awayWin *= factor;
    over *= factor;
  }

  return { homeWin, draw, awayWin, over };
}

export interface AsianHandicapProbabilities {
  homeWinProb: number;
  awayWinProb: number;
}

/**
 * Calculate Asian Handicap probabilities using Dixon-Coles Poisson model with dynamic rho
 * Mirrors poissonProbabilities but applies handicap and excludes pushes
 */
export function poissonAsianHandicapProbabilities(
  homeXg: number,
  awayXg: number,
  handicap: number,
  maxGoals: number = 10,
  useDixonColes: boolean = true,
  rho: number = -0.1,
  homeAdjustment: number = 1,
  awayAdjustment: number = 1,
  userRho: number = 0
): AsianHandicapProbabilities {
  // Dynamic rho adjustment based on total goals, with user override
  const totalGoals = homeXg + awayXg;
  const dynamicRho = useDixonColes ? (-0.05 * totalGoals * 0.42 - userRho) : rho;

  // Calculate dynamic favorite boost based on goal difference
  const goalDiff = Math.abs(homeXg - awayXg);
  const favBoostMultiplier = 0.12;
  const favouriteBoost = goalDiff * favBoostMultiplier + 1;

  // Apply favorite boost with additional manual adjustments
  const finalHomeAdj = (homeXg > awayXg ? favouriteBoost : 2 - favouriteBoost) * homeAdjustment;
  const finalAwayAdj = (awayXg > homeXg ? favouriteBoost : 2 - favouriteBoost) * awayAdjustment;

  let homeWinProb = 0;
  let awayWinProb = 0;
  let totalProb = 0;

  // Calculate all score probabilities
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      // Basic Poisson probability
      let prob = poissonPMF(i, homeXg) * poissonPMF(j, awayXg);

      // Apply Dixon-Coles adjustment for low scores
      if (useDixonColes && (i <= 1 && j <= 1)) {
        prob *= dixonColesAdjustment(i, j, homeXg, awayXg, dynamicRho);
      }

      // Apply home/away adjustments based on raw score (pre-handicap)
      if (i > j) {
        prob *= finalHomeAdj;
      } else if (j > i) {
        prob *= finalAwayAdj;
      }
      // Draws get no adjustment (prob remains as is)

      // Apply handicap to home team score
      const adjustedHomeScore = i + handicap;

      // Classify outcome
      if (adjustedHomeScore > j) {
        homeWinProb += prob;
      } else if (adjustedHomeScore < j) {
        awayWinProb += prob;
      }
      // If equal, it's a push - exclude from totalProb
    }
  }

  // Normalize probabilities (exclude push scenarios)
  totalProb = homeWinProb + awayWinProb;
  if (totalProb > 0) {
    homeWinProb /= totalProb;
    awayWinProb /= totalProb;
  }

  return { homeWinProb, awayWinProb };
}

