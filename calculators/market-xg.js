/**
 * Market XG Calculator
 *
 * This module calculates market XG from betting odds using Dixon-Coles Poisson optimization.
 * Market XG is calculated for finished fixtures only (status_short IN ('FT', 'AET', 'PEN')).
 */

import pool from '../lib/database/db.ts';

/**
 * Reverse engineer market XG from fair odds using Dixon-Coles optimization
 * Uses simple grid search + gradient descent for optimization
 * When over25Odds is null, uses league average goals or 2.76 as fallback
 */
function calculateMarketXgFromOdds(homeOdds, drawOdds, awayOdds, over25Odds = null, leagueAvgGoals = null) {
  // Convert fair odds to probabilities (keep over-round - don't normalize!)
  // Odds are already in decimal format (e.g., 2.48) from SQL conversion using decimals column
  const homeProb = 1.0 / homeOdds;
  const drawProb = 1.0 / drawOdds;
  const awayProb = 1.0 / awayOdds;

  // Calculate over25 probability - use odds if available, otherwise use league average goals
  let over25Prob = null;
  if (over25Odds) {
    over25Prob = 1.0 / over25Odds;
  } else {
    // Use league average goals, or 2.76 as fallback
    const totalGoals = leagueAvgGoals || 2.76;
    // Calculate over 2.5 probability using Poisson distribution
    const lambda = totalGoals;
    let overProb = 0;
    for (let goals = 3; goals <= 10; goals++) {
      overProb += poissonPMF(goals, lambda);
    }
    over25Prob = overProb;
  }

  // Objective function: minimize squared error
  function objective(homeXg, awayXg) {
    const probs = poissonProbabilities(homeXg, awayXg, 2.5, 10, true, -0.1);

    let error = Math.pow(probs.homeWin - homeProb, 2) +
                Math.pow(probs.draw - drawProb, 2) +
                Math.pow(probs.awayWin - awayProb, 2) +
                Math.pow(probs.over - over25Prob, 2);

    return error;
  }

  // Initial guess based on win probabilities
  const totalWinProb = homeProb + awayProb;
  const homeRatio = totalWinProb > 0 ? homeProb / totalWinProb : 0.5;
  let bestHomeXg = 2.76 * homeRatio;
  let bestAwayXg = 2.76 * (1 - homeRatio);
  let bestError = objective(bestHomeXg, bestAwayXg);

  // Simple gradient descent with adaptive step size
  let stepSize = 0.1;
  const maxIterations = 100;
  const tolerance = 1e-6;

  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;

    // Try adjusting home XG
    for (const direction of [-1, 1]) {
      const testHomeXg = Math.max(0.1, Math.min(5.0, bestHomeXg + direction * stepSize));
      const testError = objective(testHomeXg, bestAwayXg);

      if (testError < bestError) {
        bestHomeXg = testHomeXg;
        bestError = testError;
        improved = true;
        break;
      }
    }

    // Try adjusting away XG
    for (const direction of [-1, 1]) {
      const testAwayXg = Math.max(0.1, Math.min(5.0, bestAwayXg + direction * stepSize));
      const testError = objective(bestHomeXg, testAwayXg);

      if (testError < bestError) {
        bestAwayXg = testAwayXg;
        bestError = testError;
        improved = true;
        break;
      }
    }

    // If no improvement, reduce step size
    if (!improved) {
      stepSize *= 0.5;
      if (stepSize < tolerance) break;
    }
  }

  return {
    homeXg: Math.round(bestHomeXg * 100) / 100,
    awayXg: Math.round(bestAwayXg * 100) / 100,
    error: bestError
  };
}

/**
 * Dixon-Coles correlation adjustment for low-scoring games
 */
function dixonColesAdjustment(homeGoals, awayGoals, homeXg, awayXg, rho = -0.1) {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - homeXg * awayXg * rho;
  } else if (homeGoals === 0 && awayGoals === 1) {
    return 1 + homeXg * rho;
  } else if (homeGoals === 1 && awayGoals === 0) {
    return 1 + awayXg * rho;
  } else if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }
  return 1.0;
}

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
 * Calculate match probabilities using Dixon-Coles Poisson model
 */
function poissonProbabilities(homeXg, awayXg, overLine = 2.5, maxGoals = 10, useDixonColes = true, rho = -0.1) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over = 0;

  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      // Basic Poisson probability
      let prob = poissonPMF(i, homeXg) * poissonPMF(j, awayXg);

      // Apply Dixon-Coles adjustment
      if (useDixonColes && (i <= 1 && j <= 1)) {
        prob *= dixonColesAdjustment(i, j, homeXg, awayXg, rho);
      }

      // Match result
      if (i > j) {
        homeWin += prob;
      } else if (i === j) {
        draw += prob;
      } else {
        awayWin += prob;
      }

      // Total goals
      if (i + j > overLine) {
        over += prob;
      }
    }
  }

  return { homeWin, draw, awayWin, over };
}

/**
 * Calculate and populate market XG using Dixon-Coles Poisson optimization
 * Uses fair odds with priority: Pinnacle > Betfair > Bet365 > Any other
 * @param {number[] | null | undefined} fixtureIds - Array of fixture IDs to process, or null for all fixtures
 */
async function calculateMarketXG(fixtureIds = null) {
  try {
    // Build query to get FINISHED fixtures (FT, AET, PEN) with fair odds
    // Priority: pinnacle > betfair > bet365 > any other
    let query = `
      WITH prioritized_fair_odds AS (
        SELECT
          fixture_id,
          bookie,
          decimals,
          fair_odds_x12,
          fair_odds_ah,
          fair_odds_ou,
          latest_lines,
          CASE LOWER(bookie)
            WHEN 'pinnacle' THEN 1
            WHEN 'betfair' THEN 2
            WHEN 'bet365' THEN 3
            ELSE 4
          END as priority
        FROM football_fair_odds
        WHERE fair_odds_x12 IS NOT NULL
          AND (fair_odds_x12->'fair_x12'->>0)::numeric > 0
          AND (fair_odds_x12->'fair_x12'->>1)::numeric > 0
          AND (fair_odds_x12->'fair_x12'->>2)::numeric > 0
      ),
      best_fair_odds AS (
        SELECT DISTINCT ON (fixture_id)
          fixture_id,
          bookie,
          decimals,
          fair_odds_x12,
          fair_odds_ah,
          fair_odds_ou,
          latest_lines
        FROM prioritized_fair_odds
        ORDER BY fixture_id, priority
      )
      SELECT
        f.id as fixture_id,
        fs.avg_goals_league,
        bfo.decimals,
        (bfo.fair_odds_x12->'fair_x12'->>0)::numeric / (10^bfo.decimals) as home_odds,
        (bfo.fair_odds_x12->'fair_x12'->>1)::numeric / (10^bfo.decimals) as draw_odds,
        (bfo.fair_odds_x12->'fair_x12'->>2)::numeric / (10^bfo.decimals) as away_odds,
        (
          SELECT (bfo.fair_odds_ou->'fair_ou_o'->>((t.idx-1)::int))::numeric / (10^bfo.decimals)
          FROM jsonb_array_elements_text(bfo.latest_lines->'ou') WITH ORDINALITY AS t(val, idx)
          WHERE t.val::numeric = 2.5
          LIMIT 1
        ) as over25_odds
      FROM football_fixtures f
      LEFT JOIN football_stats fs ON f.id = fs.fixture_id
      LEFT JOIN best_fair_odds bfo ON f.id = bfo.fixture_id
      WHERE f.status_short IN ('FT', 'AET', 'PEN')
        AND bfo.fair_odds_x12 IS NOT NULL
    `;

    const params = [];
    if (fixtureIds && fixtureIds.length > 0) {
      query += ` AND f.id = ANY($1::bigint[])`;
      params.push(fixtureIds);
    }

    const result = await pool.query(query, params);
    const fixtures = result.rows;

    let calculated = 0;
    let errors = 0;

    // Process in batches for better performance
    const batchSize = 100;
    for (let i = 0; i < fixtures.length; i += batchSize) {
      const batch = fixtures.slice(i, i + batchSize);

      // Calculate market XG for each fixture in the batch
      const values = [];
      for (const fixture of batch) {
        try {
          const { homeXg, awayXg } = calculateMarketXgFromOdds(
            fixture.home_odds,
            fixture.draw_odds,
            fixture.away_odds,
            fixture.over25_odds,
            fixture.avg_goals_league
          );

          values.push({
            fixtureId: fixture.fixture_id,
            homeXg,
            awayXg,
            totalXg: homeXg + awayXg
          });

          calculated++;
        } catch (error) {
          console.error(`❌ Error calculating market XG for fixture ${fixture.fixture_id}:`, error.message);
          errors++;
        }
      }

      // Bulk update football_fixtures with market XG values
      if (values.length > 0) {
        // Update each fixture individually for reliability
        for (const value of values) {
          await pool.query(
            `UPDATE football_fixtures
             SET market_xg_home = $1, market_xg_away = $2
             WHERE id = $3`,
            [value.homeXg, value.awayXg, value.fixtureId]
          );
        }
      }

    }
    return calculated;

  } catch (error) {
    console.error('❌ Error in calculateMarketXG:', error.message);
    throw error;
  }
}

// Export the function
export { calculateMarketXG };
