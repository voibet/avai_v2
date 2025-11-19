/**
 * Fair Odds Calculator
 *
 * This module calculates fair odds from bookmaker odds data using the Margin Proportional to Odds method.
 * Converts bookmaker margins to fair odds for X12, Asian Handicap, and Over/Under markets.
 */

import pool from '../database/db';

/**
 * Calculate fair odds from bookmaker odds data
 * Uses Margin Proportional to Odds method to remove bookmaker margins
 * Processes fixtures in batches of 50 for performance
 *
 * @param fixtureIds - Optional array of fixture IDs to process. If null, processes all fixtures with odds data
 * @returns Promise<number> - Number of fixtures processed
 */
export async function calculateFairOdds(fixtureIds: number[] | null = null): Promise<number> {
  let fixturesToProcess = fixtureIds;

  // If no fixture IDs provided, get all fixtures that have odds data
  if (!fixturesToProcess) {
    const fixturesResult = await pool.query(`
      SELECT DISTINCT f.id as fixture_id
      FROM football_fixtures f
      JOIN football_odds fo ON f.id = fo.fixture_id
      WHERE fo.bookie != 'Prediction'
            AND (fo.odds_x12 IS NOT NULL OR fo.odds_ah IS NOT NULL OR fo.odds_ou IS NOT NULL)
    `);

    fixturesToProcess = fixturesResult.rows.map(row => parseInt(row.fixture_id));
  }

  console.log(`📊 Found ${fixturesToProcess.length} fixtures with odds data`);

  if (fixturesToProcess.length === 0) {
    console.log('⚠️  No fixtures with odds data found');
    return 0;
  }

  // Populate fair_odds table
  console.log('Populating fair_odds table...');

  let processedCount = 0;

  for (let i = 0; i < fixturesToProcess.length; i += 50) {
    const batch = fixturesToProcess.slice(i, i + 50);
    const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');

    try {
      await pool.query(`
        INSERT INTO football_fair_odds (fixture_id, bookie, decimals, fair_odds_x12, fair_odds_ah, fair_odds_ou, lines, latest_t)
        SELECT DISTINCT ON (fo.fixture_id, fo.bookie)
            fo.fixture_id,
            fo.bookie,
            fo.decimals,

            -- Fair X12 odds (Margin Proportional to Odds method) - uses most recent valid odds (looks past 3 odds)
            CASE
                WHEN fo.odds_x12 IS NOT NULL THEN
                    -- Find most recent valid X12 odds (checking last 3 entries)
                    (
                        SELECT
                            CASE
                                WHEN valid_odds.x12_array IS NOT NULL THEN
                                    CASE
                                        WHEN 1.0 / (
                                            SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                            FROM jsonb_array_elements_text(valid_odds.x12_array) elem
                                            WHERE elem::numeric > 0
                                        ) >= 0.92 THEN
                                            (
                                                SELECT jsonb_agg(
                                                    ROUND(
                                                        (
                                                            3.0 * (x12_odds::numeric / POWER(10, fo.decimals)) /
                                                            (
                                                                3.0 - (
                                                                    (
                                                                        SELECT SUM(1.0 / (elem::numeric / POWER(10, fo.decimals)))
                                                                        FROM jsonb_array_elements_text(valid_odds.x12_array) elem
                                                                        WHERE elem::numeric > 0
                                                                    ) - 1.0
                                                                ) * (x12_odds::numeric / POWER(10, fo.decimals))
                                                            )
                                                        ) * POWER(10, fo.decimals)
                                                    )::integer
                                                    ORDER BY x12_idx
                                                )
                                                FROM jsonb_array_elements_text(valid_odds.x12_array) WITH ORDINALITY x12(x12_odds, x12_idx)
                                                WHERE x12_idx <= 3 AND x12_odds::numeric > 0
                                            )
                                        ELSE NULL
                                    END
                                ELSE NULL
                            END
                        FROM (
                            SELECT
                                CASE
                                    WHEN jsonb_array_length((fo.odds_x12->-1)->'x12') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-1->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                    THEN (fo.odds_x12->-1->>'x12')::jsonb
                                    WHEN jsonb_array_length((fo.odds_x12->-2)->'x12') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-2->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                    THEN (fo.odds_x12->-2->>'x12')::jsonb
                                    WHEN jsonb_array_length((fo.odds_x12->-3)->'x12') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_x12->-3->>'x12')::jsonb) elem WHERE elem::numeric > 0)
                                    THEN (fo.odds_x12->-3->>'x12')::jsonb
                                    ELSE NULL
                                END as x12_array
                        ) valid_odds
                    )
                ELSE NULL
            END as fair_odds_x12,

            -- Fair AH odds - uses most recent valid historical odds (looks past 3 odds)
            CASE
                WHEN fo.odds_ah IS NOT NULL THEN
                    -- Find most recent valid AH odds (checking last 3 entries)
                    (
                        SELECT
                            CASE
                                WHEN valid_odds.ah_h_array IS NOT NULL AND valid_odds.ah_a_array IS NOT NULL THEN
                                    jsonb_build_object(
                                        'fair_ah_h', (
                                            SELECT jsonb_agg(
                                                CASE
                                                    WHEN h_odds::numeric > 100 AND a_odds::numeric > 100 AND
                                                         1.0 / ((1.0 / (h_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                        ROUND(
                                                            (
                                                                2.0 * (h_odds::numeric / POWER(10, fo.decimals)) /
                                                                (
                                                                    2.0 - (
                                                                        (
                                                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                                                        ) - 1.0
                                                                    ) * (h_odds::numeric / POWER(10, fo.decimals))
                                                                )
                                                            ) * POWER(10, fo.decimals)
                                                        )::integer
                                                    ELSE NULL
                                                END ORDER BY h_idx
                                            )
                                            FROM jsonb_array_elements_text(valid_odds.ah_h_array) WITH ORDINALITY h(h_odds, h_idx)
                                            JOIN jsonb_array_elements_text(valid_odds.ah_a_array) WITH ORDINALITY a(a_odds, a_idx)
                                            ON h_idx = a_idx
                                        ),
                                        'fair_ah_a', (
                                            SELECT jsonb_agg(
                                                CASE
                                                    WHEN h_odds::numeric > 100 AND a_odds::numeric > 100 AND
                                                         1.0 / ((1.0 / (h_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                        ROUND(
                                                            (
                                                                2.0 * (a_odds::numeric / POWER(10, fo.decimals)) /
                                                                (
                                                                    2.0 - (
                                                                        (
                                                                            (1.0 / (h_odds::numeric / POWER(10, fo.decimals))) +
                                                                            (1.0 / (a_odds::numeric / POWER(10, fo.decimals)))
                                                                        ) - 1.0
                                                                    ) * (a_odds::numeric / POWER(10, fo.decimals))
                                                                )
                                                            ) * POWER(10, fo.decimals)
                                                        )::integer
                                                    ELSE NULL
                                                END ORDER BY h_idx
                                            )
                                            FROM jsonb_array_elements_text(valid_odds.ah_h_array) WITH ORDINALITY h(h_odds, h_idx)
                                            JOIN jsonb_array_elements_text(valid_odds.ah_a_array) WITH ORDINALITY a(a_odds, a_idx)
                                            ON h_idx = a_idx
                                        )
                                    )
                                ELSE NULL
                            END
                        FROM (
                            SELECT
                                CASE
                                    WHEN jsonb_array_length((fo.odds_ah->-1)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-1)->'ah_a') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                    THEN (fo.odds_ah->-1->>'ah_h')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ah->-2)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-2)->'ah_a') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                    THEN (fo.odds_ah->-2->>'ah_h')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ah->-3)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-3)->'ah_a') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                    THEN (fo.odds_ah->-3->>'ah_h')::jsonb
                                    ELSE NULL
                                END as ah_h_array,
                                CASE
                                    WHEN jsonb_array_length((fo.odds_ah->-1)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-1)->'ah_a') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-1->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                    THEN (fo.odds_ah->-1->>'ah_a')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ah->-2)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-2)->'ah_a') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-2->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                    THEN (fo.odds_ah->-2->>'ah_a')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ah->-3)->'ah_h') > 0 AND jsonb_array_length((fo.odds_ah->-3)->'ah_a') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_h')::jsonb) h_elem WHERE h_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ah->-3->>'ah_a')::jsonb) a_elem WHERE a_elem::numeric > 100)
                                    THEN (fo.odds_ah->-3->>'ah_a')::jsonb
                                    ELSE NULL
                                END as ah_a_array
                        ) valid_odds
                    )
                ELSE NULL
            END as fair_odds_ah,

            -- Fair OU odds - uses most recent valid historical odds (looks past 3 odds)
            CASE
                WHEN fo.odds_ou IS NOT NULL THEN
                    -- Find most recent valid OU odds (checking last 3 entries)
                    (
                        SELECT
                            CASE
                                WHEN valid_odds.ou_o_array IS NOT NULL AND valid_odds.ou_u_array IS NOT NULL THEN
                                    jsonb_build_object(
                                        'fair_ou_o', (
                                            SELECT jsonb_agg(
                                                CASE
                                                    WHEN o_odds::numeric > 100 AND u_odds::numeric > 100 AND
                                                         1.0 / ((1.0 / (o_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                        ROUND(
                                                            (
                                                                2.0 * (o_odds::numeric / POWER(10, fo.decimals)) /
                                                                (
                                                                    2.0 - (
                                                                        (
                                                                            (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                                            (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                                                        ) - 1.0
                                                                    ) * (o_odds::numeric / POWER(10, fo.decimals))
                                                                )
                                                            ) * POWER(10, fo.decimals)
                                                        )::integer
                                                    ELSE NULL
                                                END ORDER BY o_idx
                                            )
                                            FROM jsonb_array_elements_text(valid_odds.ou_o_array) WITH ORDINALITY o(o_odds, o_idx)
                                            JOIN jsonb_array_elements_text(valid_odds.ou_u_array) WITH ORDINALITY u(u_odds, u_idx)
                                            ON o_idx = u_idx
                                        ),
                                        'fair_ou_u', (
                                            SELECT jsonb_agg(
                                                CASE
                                                    WHEN o_odds::numeric > 100 AND u_odds::numeric > 100 AND
                                                         1.0 / ((1.0 / (o_odds::numeric / POWER(10, fo.decimals))) + (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))) >= 0.92 THEN
                                                        ROUND(
                                                            (
                                                                2.0 * (u_odds::numeric / POWER(10, fo.decimals)) /
                                                                (
                                                                    2.0 - (
                                                                        (
                                                                            (1.0 / (o_odds::numeric / POWER(10, fo.decimals))) +
                                                                            (1.0 / (u_odds::numeric / POWER(10, fo.decimals)))
                                                                        ) - 1.0
                                                                    ) * (u_odds::numeric / POWER(10, fo.decimals))
                                                                )
                                                            ) * POWER(10, fo.decimals)
                                                        )::integer
                                                    ELSE NULL
                                                END ORDER BY o_idx
                                            )
                                            FROM jsonb_array_elements_text(valid_odds.ou_o_array) WITH ORDINALITY o(o_odds, o_idx)
                                            JOIN jsonb_array_elements_text(valid_odds.ou_u_array) WITH ORDINALITY u(u_odds, u_idx)
                                            ON o_idx = u_idx
                                        )
                                    )
                                ELSE NULL
                            END
                        FROM (
                            SELECT
                                CASE
                                    WHEN jsonb_array_length((fo.odds_ou->-1)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-1)->'ou_u') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                    THEN (fo.odds_ou->-1->>'ou_o')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ou->-2)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-2)->'ou_u') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                    THEN (fo.odds_ou->-2->>'ou_o')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ou->-3)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-3)->'ou_u') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                    THEN (fo.odds_ou->-3->>'ou_o')::jsonb
                                    ELSE NULL
                                END as ou_o_array,
                                CASE
                                    WHEN jsonb_array_length((fo.odds_ou->-1)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-1)->'ou_u') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-1->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                    THEN (fo.odds_ou->-1->>'ou_u')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ou->-2)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-2)->'ou_u') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-2->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                    THEN (fo.odds_ou->-2->>'ou_u')::jsonb
                                    WHEN jsonb_array_length((fo.odds_ou->-3)->'ou_o') > 0 AND jsonb_array_length((fo.odds_ou->-3)->'ou_u') > 0 AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_o')::jsonb) o_elem WHERE o_elem::numeric > 100) AND
                                         EXISTS (SELECT 1 FROM jsonb_array_elements_text((fo.odds_ou->-3->>'ou_u')::jsonb) u_elem WHERE u_elem::numeric > 100)
                                    THEN (fo.odds_ou->-3->>'ou_u')::jsonb
                                    ELSE NULL
                                END as ou_u_array
                        ) valid_odds
                    )
                ELSE NULL
            END as fair_odds_ou,

            -- Latest lines from bookmaker data
            (fo.lines->-1) as lines,

            -- Latest timestamps from the odds data used for fair odds calculation
            fo.latest_t as latest_t

        FROM football_odds fo
        WHERE fo.fixture_id = ANY(ARRAY[${placeholders}]::BIGINT[])
          AND fo.bookie != 'Prediction'
          AND (fo.odds_x12 IS NOT NULL OR fo.odds_ah IS NOT NULL OR fo.odds_ou IS NOT NULL)
        ORDER BY fo.fixture_id, fo.bookie, fo.latest_t DESC
        ON CONFLICT (fixture_id, bookie) DO UPDATE SET
            fair_odds_x12 = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL THEN EXCLUDED.fair_odds_x12 ELSE football_fair_odds.fair_odds_x12 END,
            fair_odds_ah = CASE WHEN EXCLUDED.fair_odds_ah IS NOT NULL THEN EXCLUDED.fair_odds_ah ELSE football_fair_odds.fair_odds_ah END,
            fair_odds_ou = CASE WHEN EXCLUDED.fair_odds_ou IS NOT NULL THEN EXCLUDED.fair_odds_ou ELSE football_fair_odds.fair_odds_ou END,
            lines = EXCLUDED.lines,
            latest_t = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL THEN EXCLUDED.latest_t ELSE football_fair_odds.latest_t END,
            updated_at = CASE WHEN EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL THEN NOW() ELSE football_fair_odds.updated_at END
        WHERE (EXCLUDED.fair_odds_x12 IS NOT NULL AND football_fair_odds.fair_odds_x12 IS DISTINCT FROM EXCLUDED.fair_odds_x12)
           OR (EXCLUDED.fair_odds_ah IS NOT NULL AND football_fair_odds.fair_odds_ah IS DISTINCT FROM EXCLUDED.fair_odds_ah)
           OR (EXCLUDED.fair_odds_ou IS NOT NULL AND football_fair_odds.fair_odds_ou IS DISTINCT FROM EXCLUDED.fair_odds_ou)
           OR football_fair_odds.lines IS DISTINCT FROM EXCLUDED.lines
           OR ((EXCLUDED.fair_odds_x12 IS NOT NULL OR EXCLUDED.fair_odds_ah IS NOT NULL OR EXCLUDED.fair_odds_ou IS NOT NULL) AND football_fair_odds.latest_t IS DISTINCT FROM EXCLUDED.latest_t)
      `, batch);

      processedCount += batch.length;

    } catch (error: any) {
      console.error(`❌ Error populating fair_odds batch ${Math.floor(i/50) + 1}:`, error.message);
      throw error;
    }
  }

  console.log('✅ Fair odds table populated successfully');
  return processedCount;
}

