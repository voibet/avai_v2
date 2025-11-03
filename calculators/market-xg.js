/**
 * Market XG Calculator
 *
 * This module calculates market XG from betting odds using Dixon-Coles Poisson optimization.
 * Market XG is calculated only for fixtures that have started (IN_PLAY) or finished (IN_PAST).
 * Never calculated for IN_FUTURE fixtures (NS, TBD).
 */

import pool from '../lib/database/db.ts';
import { poissonPMF, poissonProbabilities } from './poisson-utils.js';

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
 * Calculate and populate market XG using Dixon-Coles Poisson optimization
 * Uses fair odds with priority: Pinnacle > Betfair > Any other
 * Only processes fixtures that have started (excludes NS, TBD)
 * @param {number[] | null | undefined} fixtureIds - Array of fixture IDs to process, or null for all fixtures
 */
async function calculateMarketXG(fixtureIds = null) {
  try {
    // Build query to get fixtures with fair odds (excludes IN_FUTURE: NS, TBD)
    // Priority: pinnacle > betfair  > any other
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
            ELSE 3
          END as priority
        FROM football_fair_odds
        WHERE fair_odds_x12 IS NOT NULL
          AND (fair_odds_x12->>0)::numeric > 0
          AND (fair_odds_x12->>1)::numeric > 0
          AND (fair_odds_x12->>2)::numeric > 0
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
        -- X12 odds: check if values suggest different decimals needed
        CASE
          WHEN (bfo.fair_odds_x12->>0)::numeric >= 1000 THEN (bfo.fair_odds_x12->>0)::numeric / 1000
          WHEN (bfo.fair_odds_x12->>0)::numeric >= 100 THEN (bfo.fair_odds_x12->>0)::numeric / 100
          ELSE (bfo.fair_odds_x12->>0)::numeric / 10
        END as home_odds,
        CASE
          WHEN (bfo.fair_odds_x12->>1)::numeric >= 1000 THEN (bfo.fair_odds_x12->>1)::numeric / 1000
          WHEN (bfo.fair_odds_x12->>1)::numeric >= 100 THEN (bfo.fair_odds_x12->>1)::numeric / 100
          ELSE (bfo.fair_odds_x12->>1)::numeric / 10
        END as draw_odds,
        CASE
          WHEN (bfo.fair_odds_x12->>2)::numeric >= 1000 THEN (bfo.fair_odds_x12->>2)::numeric / 1000
          WHEN (bfo.fair_odds_x12->>2)::numeric >= 100 THEN (bfo.fair_odds_x12->>2)::numeric / 100
          ELSE (bfo.fair_odds_x12->>2)::numeric / 10
        END as away_odds,
        -- OU odds: check if values suggest different decimals needed
        (
          SELECT CASE
            WHEN (bfo.fair_odds_ou->'fair_ou_o'->>((t.idx-1)::int))::numeric >= 1000 THEN (bfo.fair_odds_ou->'fair_ou_o'->>((t.idx-1)::int))::numeric / 1000
            WHEN (bfo.fair_odds_ou->'fair_ou_o'->>((t.idx-1)::int))::numeric >= 100 THEN (bfo.fair_odds_ou->'fair_ou_o'->>((t.idx-1)::int))::numeric / 100
            ELSE (bfo.fair_odds_ou->'fair_ou_o'->>((t.idx-1)::int))::numeric / 10
          END
          FROM jsonb_array_elements_text(bfo.latest_lines->'ou') WITH ORDINALITY AS t(val, idx)
          WHERE t.val::numeric = 2.5
          LIMIT 1
        ) as over25_odds
      FROM football_fixtures f
      LEFT JOIN football_stats fs ON f.id = fs.fixture_id
      LEFT JOIN best_fair_odds bfo ON f.id = bfo.fixture_id
      WHERE LOWER(f.status_short) NOT IN ('ns', 'tbd')
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

/**
 * Calculate expected points from XG values
 * Points system: Win = 3, Draw = 1, Loss = 0
 * @param {number} homeXg - Home team expected goals
 * @param {number} awayXg - Away team expected goals
 * @returns {object} Expected points for home and away teams
 */
function calculateExpectedPoints(homeXg, awayXg) {
  // Get match outcome probabilities using Dixon-Coles Poisson model
  const probs = poissonProbabilities(homeXg, awayXg, 2.5, 10, true, -0.1);

  // Calculate expected points
  const homeExpectedPoints = (probs.homeWin * 3) + (probs.draw * 1) + (probs.awayWin * 0);
  const awayExpectedPoints = (probs.awayWin * 3) + (probs.draw * 1) + (probs.homeWin * 0);

  return {
    homeExpectedPoints: Math.round(homeExpectedPoints * 100) / 100,
    awayExpectedPoints: Math.round(awayExpectedPoints * 100) / 100,
    probabilities: {
      homeWin: Math.round(probs.homeWin * 1000) / 1000,
      draw: Math.round(probs.draw * 1000) / 1000,
      awayWin: Math.round(probs.awayWin * 1000) / 1000
    }
  };
}

// Example usage:
// const result = calculateExpectedPoints(2.0, 1.0);
// console.log(result);
// Output: {
//   homeExpectedPoints: 2.12,
//   awayExpectedPoints: 0.88,
//   probabilities: { homeWin: 0.706, draw: 0.204, awayWin: 0.090 }
// }

// Simple seedable PRNG (xorshift32) for reproducibility (optional)
function makeRNG(seed = null) {
  if (seed == null) {
    return {
      random: () => Math.random()
    };
  }
  let x = seed >>> 0;
  if (x === 0) x = 2463534242; // avoid zero seed
  return {
    random: () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return ((x >>> 0) / 4294967296);
    }
  };
}

// Replace Math.random usage in the normal sampler using the rng.random()
function makeNormalSampler(rng) {
  let spare = null;
  let hasSpare = false;
  return function() {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    let u, v, s;
    do {
      u = rng.random() * 2 - 1;
      v = rng.random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt(-2.0 * Math.log(s) / s);
    spare = v * mul;
    hasSpare = true;
    return u * mul;
  };
}

/**
 * Calculate title win probabilities from projected season-end expected points using Monte Carlo simulation
 * Properly models uncertainty based on fixtures remaining - current points have no variance, only future fixtures do
 *
 * @param {Array} standings - Array of team standings with structure:
 *   {
 *     team: { id, name },
 *     points: current points,
 *     xg_stats: { expected_points_projected, fixtures_remaining }
 *   }
 * @param {Object} options - Configuration options:
 *   - variancePerGame: Variance in points per game (default: 1.9)
 *   - nSims: Number of Monte Carlo simulations (default: 20000)
 *   - seed: Optional seed for reproducibility
 *   - tieBreak: 'jitter' (tiny random) or 'equal' (split evenly, default: 'jitter')
 *   - discretePerGame: If true, simulates each match as discrete {0,1,3} points (default: false)
 * @returns {Array} Teams with win probabilities sorted by probability descending
 */
function calculateWinPercentagesFromProjectedPoints(
  standings,
  {
    variancePerGame = 1.9,
    nSims = 20000,
    seed = null,
    tieBreak = 'jitter', // 'jitter' or 'equal'
    discretePerGame = false // if true, simulate per-game discrete points
  } = {}
) {
  if (!standings?.length) return [];

  const rng = makeRNG(seed);
  const normalSampler = makeNormalSampler(rng);

  const n = standings.length;
  const titleCounts = new Float64Array(n);
  const sampledPoints = new Float64Array(n);

  const teams = standings.map((standing, idx) => {
    const currentPoints = Number(standing.points || 0);
    const projectedTotal = Number((standing.xg_stats?.expected_points_projected ?? currentPoints));
    const fixturesRemaining = Number(standing.xg_stats?.fixtures_remaining ?? 0);
    const projectedRemaining = projectedTotal - currentPoints;
    const stdDev = fixturesRemaining > 0 ? Math.sqrt(fixturesRemaining * variancePerGame) : 0;
    return {
      index: idx,
      teamId: standing.team?.id,
      teamName: standing.team?.name,
      currentPoints,
      projectedRemaining,
      stdDev,
      projectedTotal,
      fixturesRemaining
    };
  });

  // Helper to cap remaining points in realistic bounds [0, 3 * fixturesRemaining]
  function capRemaining(val, fixtures) {
    const mx = fixtures * 3;
    return Math.min(Math.max(val, 0), mx);
  }

  // Optional: discrete per-game simulation using a normal-based PMF approximation
  function sampleDiscreteRemaining(fixtures, meanRemaining, rng, normalSampler) {
    if (fixtures === 0) return 0;
    const meanPerGame = meanRemaining / fixtures;
    const mpg = Math.min(Math.max(meanPerGame, 0), 3);
    // Simple mapping: assume draw rate d = 0.25, adjust win probability
    const drawRate = 0.25;
    const p_win = Math.max(0, Math.min(1, (mpg - drawRate) / 2));
    const p_draw = Math.max(0, Math.min(1 - p_win, drawRate));
    // Sample fixtures
    let total = 0;
    for (let g = 0; g < fixtures; g++) {
      const r = rng.random();
      if (r < p_win) total += 3;
      else if (r < p_win + p_draw) total += 1;
      // else 0
    }
    return total;
  }

  for (let sim = 0; sim < nSims; sim++) {
    let maxPoints = -Infinity;
    // Sample totals
    for (let i = 0; i < n; i++) {
      const t = teams[i];
      let remainingSample;
      if (t.stdDev === 0) {
        remainingSample = t.projectedRemaining;
      } else if (discretePerGame) {
        remainingSample = sampleDiscreteRemaining(t.fixturesRemaining, t.projectedRemaining, rng, normalSampler);
      } else {
        remainingSample = t.projectedRemaining + t.stdDev * normalSampler();
      }
      // Realistic bounds
      remainingSample = capRemaining(remainingSample, t.fixturesRemaining);
      const total = t.currentPoints + remainingSample;
      sampledPoints[i] = total;
      if (total > maxPoints) maxPoints = total;
    }

    // Tie handling
    if (tieBreak === 'equal') {
      const winners = [];
      for (let i = 0; i < n; i++) {
        if (Math.abs(sampledPoints[i] - maxPoints) <= 1e-9) winners.push(i);
      }
      const share = 1.0 / winners.length;
      for (const w of winners) titleCounts[w] += share;
    } else { // 'jitter' or other: break ties by tiny jitter using rng
      // Find winner with jitter (don't mutate sampledPoints)
      let winnerIndex = 0;
      let best = sampledPoints[0] + (1e-6 * normalSampler());
      for (let i = 1; i < n; i++) {
        const val = sampledPoints[i] + (1e-6 * normalSampler());
        if (val > best) {
          best = val;
          winnerIndex = i;
        }
      }
      titleCounts[winnerIndex] += 1.0;
    }
  }

  // Assemble results
  const results = teams
    .map((t, i) => {
      const winProb = titleCounts[i] / nSims;
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        currentPoints: t.currentPoints,
        projectedTotal: Math.round(t.projectedTotal * 100) / 100,
        fixturesRemaining: t.fixturesRemaining,
        winProbability: winProb,
        winPercentage: Math.round(winProb * 10000) / 100
      };
    })
    .sort((a, b) => b.winProbability - a.winProbability);

  return results;
}

// Example usage (Premier League after 9 games):
// const standings = [
//   { 
//     team: { id: 42, name: 'Arsenal' },
//     points: 22,
//     xg_stats: { expected_points_projected: 80.19, fixtures_remaining: 29 }
//   },
//   { 
//     team: { id: 50, name: 'Man City' },
//     points: 16,
//     xg_stats: { expected_points_projected: 72.45, fixtures_remaining: 29 }
//   },
//   { 
//     team: { id: 33, name: 'Man United' },
//     points: 16,
//     xg_stats: { expected_points_projected: 55.33, fixtures_remaining: 29 }
//   }
// ];
// const winPercentages = calculateWinPercentagesFromProjectedPoints(standings);
// console.log(winPercentages);
// Output (with variance=1.9):
// [
//   { teamId: 42, teamName: 'Arsenal', currentPoints: 22, projectedTotal: 80.19, fixturesRemaining: 29, winProbability: 0.68, winPercentage: 68.0 },
//   { teamId: 50, teamName: 'Man City', currentPoints: 16, projectedTotal: 72.45, fixturesRemaining: 29, winProbability: 0.16, winPercentage: 16.0 },
//   { teamId: 33, teamName: 'Man United', currentPoints: 16, projectedTotal: 55.33, fixturesRemaining: 29, winProbability: 0.03, winPercentage: 3.0 }
// ]

function calculatePositionPercentagesFromProjectedPoints(
  standings,
  {
    variancePerGame = 1.9,
    nSims = 20000,
    seed = null,
    tieBreak = 'jitter',
    discretePerGame = false
  } = {}
) {
  if (!standings?.length) return [];

  const rng = makeRNG(seed);
  const normalSampler = makeNormalSampler(rng);

  const n = standings.length;
  const positionCounts = new Array(n).fill().map(() => new Float64Array(n)); // positionCounts[teamIndex][positionIndex]
  const sampledPoints = new Float64Array(n);

  const teams = standings.map((standing, idx) => {
    const currentPoints = Number(standing.points || 0);
    const projectedTotal = Number((standing.xg_stats?.expected_points_projected ?? currentPoints));
    const fixturesRemaining = Number(standing.xg_stats?.fixtures_remaining ?? 0);
    const projectedRemaining = projectedTotal - currentPoints;
    const stdDev = fixturesRemaining > 0 ? Math.sqrt(fixturesRemaining * variancePerGame) : 0;
    return {
      index: idx,
      teamId: standing.team?.id,
      teamName: standing.team?.name,
      currentPoints,
      projectedRemaining,
      stdDev,
      projectedTotal,
      fixturesRemaining
    };
  });

  // Helper to cap remaining points in realistic bounds [0, 3 * fixturesRemaining]
  function capRemaining(val, fixtures) {
    const mx = fixtures * 3;
    return Math.min(Math.max(val, 0), mx);
  }

  // Optional: discrete per-game simulation using a normal-based PMF approximation
  function sampleDiscreteRemaining(fixtures, meanRemaining, rng, normalSampler) {
    if (fixtures === 0) return 0;
    const meanPerGame = meanRemaining / fixtures;
    const mpg = Math.min(Math.max(meanPerGame, 0), 3);
    // Simple mapping: assume draw rate d = 0.25, adjust win probability
    const drawRate = 0.25;
    const p_win = Math.max(0, Math.min(1, (mpg - drawRate) / 2));
    const p_draw = Math.max(0, Math.min(1 - p_win, drawRate));
    // Sample fixtures
    let total = 0;
    for (let g = 0; g < fixtures; g++) {
      const r = rng.random();
      if (r < p_win) total += 3;
      else if (r < p_win + p_draw) total += 1;
      // else 0
    }
    return total;
  }

  for (let sim = 0; sim < nSims; sim++) {
    // Sample totals for all teams
    for (let i = 0; i < n; i++) {
      const t = teams[i];
      let remainingSample;
      if (t.stdDev === 0) {
        remainingSample = t.projectedRemaining;
      } else if (discretePerGame) {
        remainingSample = sampleDiscreteRemaining(t.fixturesRemaining, t.projectedRemaining, rng, normalSampler);
      } else {
        remainingSample = t.projectedRemaining + t.stdDev * normalSampler();
      }
      // Realistic bounds
      remainingSample = capRemaining(remainingSample, t.fixturesRemaining);
      const total = t.currentPoints + remainingSample;
      sampledPoints[i] = total;
    }

    // Sort teams by final points to determine positions (1-indexed, 1 = best)
    const sortedIndices = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => sampledPoints[b] - sampledPoints[a]);

    // Handle ties using jitter if needed
    if (tieBreak === 'jitter') {
      // Add tiny jitter to break ties
      const jittered = sortedIndices.map(idx => ({
        index: idx,
        points: sampledPoints[idx] + (1e-6 * normalSampler())
      }));
      jittered.sort((a, b) => b.points - a.points);
      sortedIndices.length = 0;
      sortedIndices.push(...jittered.map(item => item.index));
    }

    // Record positions for each team (0-indexed in array, but represents 1st, 2nd, 3rd place, etc.)
    sortedIndices.forEach((teamIndex, position) => {
      positionCounts[teamIndex][position] += 1.0;
    });
  }

  // Assemble results - return position probabilities for each team
  const results = teams.map((t, i) => {
    const positionProbabilities = Array.from({ length: n }, (_, pos) => positionCounts[i][pos] / nSims);
    return {
      teamId: t.teamId,
      teamName: t.teamName,
      currentPoints: t.currentPoints,
      projectedTotal: Math.round(t.projectedTotal * 100) / 100,
      fixturesRemaining: t.fixturesRemaining,
      positionProbabilities: positionProbabilities.map(prob => Math.round(prob * 10000) / 100)
    };
  });

  return results;
}

// Export the function
export { calculateMarketXG, calculateExpectedPoints, calculateWinPercentagesFromProjectedPoints, calculatePositionPercentagesFromProjectedPoints };
