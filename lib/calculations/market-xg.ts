import pool from '../database/db';
import { poissonPMF, poissonProbabilities } from './poisson-utils';

/**
 * Market XG Calculator
 *
 * This module calculates market XG from betting odds using Dixon-Coles Poisson optimization.
 * Market XG is calculated only for fixtures that have started (IN_PLAY) or finished (IN_PAST).
 * Never calculated for IN_FUTURE fixtures (NS, TBD).
 */

interface MarketXGResult {
  homeXg: number;
  awayXg: number;
  error: number;
}

/**
 * Reverse engineer market XG from fair odds using Dixon-Coles optimization
 * Uses simple grid search + gradient descent for optimization
 * When over25Odds is null, uses league average goals or 2.76 as fallback
 */
function calculateMarketXgFromOdds(
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
  over25Odds: number | null = null,
  leagueAvgGoals: number | null = null
): MarketXGResult {
  // Convert fair odds to probabilities (keep over-round - don't normalize!)
  // Odds are already in decimal format (e.g., 2.48) from SQL conversion using decimals column
  const homeProb = 1.0 / homeOdds;
  const drawProb = 1.0 / drawOdds;
  const awayProb = 1.0 / awayOdds;

  // Calculate over25 probability - use odds if available, otherwise use league average goals
  let over25Prob: number;
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
  function objective(homeXg: number, awayXg: number): number {
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
 * @param fixtureIds - Array of fixture IDs to process, or null for all fixtures
 */
export async function calculateMarketXG(fixtureIds: number[] | null = null): Promise<number> {
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
          lines,
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
          lines
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
          FROM jsonb_array_elements_text(bfo.lines->'ou') WITH ORDINALITY AS t(val, idx)
          WHERE t.val::numeric = 2.5
          LIMIT 1
        ) as over25_odds
      FROM football_fixtures f
      LEFT JOIN football_stats fs ON f.id = fs.fixture_id
      LEFT JOIN best_fair_odds bfo ON f.id = bfo.fixture_id
      WHERE LOWER(f.status_short) NOT IN ('ns', 'tbd')
        AND bfo.fair_odds_x12 IS NOT NULL
    `;

    const params: any[] = [];
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
        } catch (error: any) {
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

  } catch (error: any) {
    console.error('❌ Error in calculateMarketXG:', error.message);
    throw error;
  }
}

