/**
 * Shared Poisson Distribution Utilities
 * Used by both market XG and prediction odds calculators
 */

/**
 * Poisson PMF: P(k; λ) = (λ^k * e^(-λ)) / k!
 */
function poissonPMF(k, lambda) {
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
function dixonColesAdjustment(homeGoals, awayGoals, homeXg, awayXg, rho = -0.1) {
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

/**
 * Calculate match probabilities using Dixon-Coles Poisson model with dynamic rho
 * Simple, accurate calculation with dynamic favorite boost and optional adjustments
 * 
 * @param {number} homeXg - Home team expected goals
 * @param {number} awayXg - Away team expected goals
 * @param {number} overLine - Over/under line (default 2.5)
 * @param {number} maxGoals - Max goals to calculate (default 10)
 * @param {boolean} useDixonColes - Apply Dixon-Coles correction (default true)
 * @param {number} rho - Base rho value (default -0.1)
 * @param {number} homeAdjustment - Additional multiplier for home team (default 1 = no additional adjustment)
 * @param {number} awayAdjustment - Additional multiplier for away team (default 1 = no additional adjustment)
 * @param {number} userRho - User adjustment to rho (subtracted from dynamic rho, default 0)
 */
function poissonProbabilities(homeXg, awayXg, overLine = 2.5, maxGoals = 10, useDixonColes = true, rho = -0.1, homeAdjustment = 1, awayAdjustment = 1, userRho = 0) {
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

export { poissonPMF, poissonProbabilities, dixonColesAdjustment };
