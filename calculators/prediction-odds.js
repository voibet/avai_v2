/**
 * Prediction Odds Calculator
 *
 * This module calculates betting odds from MLP predictions using Dixon-Coles Poisson conversion.
 * Converts home_pred and away_pred from football_predictions table to betting odds format.
 */

import pool from '../lib/database/db.ts';
import { poissonPMF, poissonProbabilities, dixonColesAdjustment, poissonAsianHandicapProbabilities } from './poisson-utils.js';

/**
 * Calculate Asian Handicap probabilities using Dixon-Coles Poisson
 * Handles quarter handicaps by splitting between adjacent half/whole lines
 */
function calculateAsianHandicap(homeXg, awayXg, handicap, maxGoals = 10, useDixonColes = true, rho = -0.1, homeAdjustment = 1, awayAdjustment = 1, userRho = 0) {
  // Check if this is a quarter handicap (e.g., 0.25, 0.75, 1.25, -0.25, etc.)
  // Use rounding to avoid floating point precision issues
  const handicapTimes4 = Math.round(handicap * 4);
  const isQuarterLine = Math.abs(handicapTimes4 % 2) === 1;

  if (isQuarterLine) {
    // Quarter handicap: split bet between two adjacent half/whole lines
    // Calculate the two lines explicitly to avoid rounding issues
    let lowerLine, upperLine;

    if (handicap > 0) {
      // Positive quarter: e.g., 0.25 = (0, 0.5), 0.75 = (0.5, 1.0), 1.25 = (1.0, 1.5)
      lowerLine = (handicapTimes4 - 1) / 4;
      upperLine = (handicapTimes4 + 1) / 4;
    } else {
      // Negative quarter: e.g., -0.25 = (-0.5, 0), -0.75 = (-1.0, -0.5), -1.25 = (-1.5, -1.0)
      lowerLine = (handicapTimes4 - 1) / 4;
      upperLine = (handicapTimes4 + 1) / 4;
    }

    const lower = calculateAsianHandicap(homeXg, awayXg, lowerLine, maxGoals, useDixonColes, rho, homeAdjustment, awayAdjustment, userRho);
    const upper = calculateAsianHandicap(homeXg, awayXg, upperLine, maxGoals, useDixonColes, rho, homeAdjustment, awayAdjustment, userRho);

    // Average the probabilities (each line gets 50% of the bet)
    return {
      homeWinProb: (lower.homeWinProb + upper.homeWinProb) / 2,
      awayWinProb: (lower.awayWinProb + upper.awayWinProb) / 2
    };
  }

  // Non-quarter handicap: delegate to utils function
  return poissonAsianHandicapProbabilities(homeXg, awayXg, handicap, maxGoals, useDixonColes, rho, homeAdjustment, awayAdjustment, userRho);
}

/**
 * Calculate Over/Under probabilities for a specific line
 * Handles quarter lines by splitting between adjacent half/whole lines
 */
function calculateOverUnder(homeXg, awayXg, line, maxGoals = 10, useDixonColes = true, rho = -0.1, homeAdjustment = 1, awayAdjustment = 1, userRho = 0) {
  // Check if this is a quarter line (e.g., 2.25, 2.75, 3.25, etc.)
  // Use rounding to avoid floating point precision issues
  const lineTimes4 = Math.round(line * 4);
  const isQuarterLine = Math.abs(lineTimes4 % 2) === 1;

  if (isQuarterLine) {
    // Quarter line: split bet between two adjacent half/whole lines
    // Calculate the two lines explicitly to avoid rounding issues
    // e.g., 2.25 (9/4) = (8/4, 10/4) = (2.0, 2.5)
    // e.g., 2.75 (11/4) = (10/4, 12/4) = (2.5, 3.0)
    const lowerLine = (lineTimes4 - 1) / 4;
    const upperLine = (lineTimes4 + 1) / 4;

    const lower = calculateOverUnder(homeXg, awayXg, lowerLine, maxGoals, useDixonColes, rho, homeAdjustment, awayAdjustment, userRho);
    const upper = calculateOverUnder(homeXg, awayXg, upperLine, maxGoals, useDixonColes, rho, homeAdjustment, awayAdjustment, userRho);

    // Average the probabilities (each line gets 50% of the bet)
    return {
      overProb: (lower.overProb + upper.overProb) / 2,
      underProb: (lower.underProb + upper.underProb) / 2
    };
  }

  // Non-quarter line: calculate normally
  let overProb = 0;
  let underProb = 0;

  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      // Basic Poisson probability
      let prob = poissonPMF(i, homeXg) * poissonPMF(j, awayXg);

      // Apply Dixon-Coles adjustment
      if (useDixonColes && (i <= 1 && j <= 1)) {
        prob *= dixonColesAdjustment(i, j, homeXg, awayXg, rho);
      }

      // Apply home/away adjustments based on who's leading
      if (i > j) {
        prob *= homeAdjustment;
      } else if (j > i) {
        prob *= awayAdjustment;
      }

      const totalGoals = i + j;

      if (totalGoals > line) {
        overProb += prob;
      } else if (totalGoals < line) {
        underProb += prob;
      }
      // If equal, it's a push (refunded) - not counted in either probability
    }
  }

  // Normalize probabilities (exclude push scenarios)
  const totalProb = overProb + underProb;
  if (totalProb > 0) {
    overProb /= totalProb;
    underProb /= totalProb;
  }

  return { overProb, underProb };
}

/**
 * Calculate odds from predictions using Dixon-Coles Poisson model
 * Converts home_pred and away_pred to betting odds and inserts into football_odds
 * Applies stored adjustments (home_adjustment, draw_adjustment, away_adjustment) if available
 * @param {number[] | null | undefined} fixtureIds - Array of fixture IDs to process, or null for all fixtures
 */
async function calculateOddsFromPredictions(fixtureIds = null) {
  try {
    // Build query to get fixtures with predictions AND adjustments
    let query = `
      SELECT
        fp.fixture_id,
        fp.home_pred,
        fp.away_pred,
        fp.home_adjustment,
        fp.draw_adjustment,
        fp.away_adjustment,
        f.date
      FROM football_predictions fp
      JOIN football_fixtures f ON fp.fixture_id = f.id
      WHERE fp.home_pred IS NOT NULL
        AND fp.away_pred IS NOT NULL
        AND fp.home_pred > 0
        AND fp.away_pred > 0
    `;

    const params = [];
    if (fixtureIds && fixtureIds.length > 0) {
      query += ` AND fp.fixture_id = ANY($1::bigint[])`;
      params.push(fixtureIds);
    }

    const result = await pool.query(query, params);
    const predictions = result.rows;

    if (predictions.length === 0) {
      console.log('   No predictions to process. ');
      return 0;
    }

    let calculated = 0;
    let errors = 0;

    // Process each prediction
    for (const prediction of predictions) {
      try {
        const homeXg = parseFloat(prediction.home_pred);
        const awayXg = parseFloat(prediction.away_pred);
        
        // Apply adjustments if they exist
        const homeAdjustment = prediction.home_adjustment ? parseFloat(prediction.home_adjustment) : 1;
        const awayAdjustment = prediction.away_adjustment ? parseFloat(prediction.away_adjustment) : 1;
        const userRho = prediction.draw_adjustment ? parseFloat(prediction.draw_adjustment) : 0;

        // Calculate X12 probabilities using Dixon-Coles Poisson with adjustments
        const probs = poissonProbabilities(homeXg, awayXg, 2.5, 10, true, -0.1, homeAdjustment, awayAdjustment, userRho);

        // Convert X12 probabilities to odds (odds = 1 / probability)
        // Store in basis points (multiply by 1000 for 3 decimals)
        const homeOdds = Math.round((1.0 / probs.homeWin) * 1000);
        const drawOdds = Math.round((1.0 / probs.draw) * 1000);
        const awayOdds = Math.round((1.0 / probs.awayWin) * 1000);

        // Generate Over/Under lines from 1.0 to 5.5 with 0.25 increments
        const ouLines = [];
        const ouOddsOver = [];
        const ouOddsUnder = [];

        // Generate lines carefully to avoid floating point issues
        for (let i = 4; i <= 22; i++) {
          const line = i * 0.25;
          const ouProbs = calculateOverUnder(homeXg, awayXg, line, 10, true, -0.1, homeAdjustment, awayAdjustment, userRho);

          // Calculate odds
          const totalProb = ouProbs.overProb + ouProbs.underProb;
          if (totalProb > 0) {
            const overOdds = (1.0 / ouProbs.overProb);
            const underOdds = (1.0 / ouProbs.underProb);

            // Only add line if both odds are within acceptable range (1.09 to 5.5)
            if (overOdds >= 1.09 && overOdds <= 5.5 && underOdds >= 1.09 && underOdds <= 5.5) {
              ouLines.push(line);
              ouOddsOver.push(Math.round(overOdds * 1000));
              ouOddsUnder.push(Math.round(underOdds * 1000));
            }
          }
        }

        // Generate Asian Handicap lines from -4.5 to +4.5 with 0.25 increments
        const ahLines = [];
        const ahOddsHome = [];
        const ahOddsAway = [];

        // Generate lines carefully to avoid floating point issues
        for (let i = -18; i <= 18; i++) {
          const line = i * 0.25;
          const ahProbs = calculateAsianHandicap(homeXg, awayXg, line, 10, true, -0.1, homeAdjustment, awayAdjustment, userRho);

          // Calculate odds
          const totalProb = ahProbs.homeWinProb + ahProbs.awayWinProb;
          if (totalProb > 0) {
            const homeOdds = (1.0 / ahProbs.homeWinProb);
            const awayOdds = (1.0 / ahProbs.awayWinProb);

            // Only add line if both odds are within acceptable range (1.09 to 5.5)
            if (homeOdds >= 1.09 && homeOdds <= 5.5 && awayOdds >= 1.09 && awayOdds <= 5.5) {
              ahLines.push(line);
              ahOddsHome.push(Math.round(homeOdds * 1000));
              ahOddsAway.push(Math.round(awayOdds * 1000));
            }
          }
        }

        // Get current timestamp
        const timestamp = Math.floor(Date.now() / 1000);

        const latestT = {
          x12_ts: timestamp,
          ou_ts: timestamp,
          ah_ts: timestamp,
          lines_ts: timestamp
        };

        // Prepare new odds entries
        const newX12Entry = { t: timestamp, x12: [homeOdds, drawOdds, awayOdds] };
        const newOuEntry = { t: timestamp, ou_o: ouOddsOver, ou_u: ouOddsUnder };
        const newAhEntry = { t: timestamp, ah_h: ahOddsHome, ah_a: ahOddsAway };
        const newLinesEntry = { t: timestamp, ou: ouLines, ah: ahLines };

        // Check if odds record exists and merge with historical data
        const existingQuery = `
          SELECT odds_x12, odds_ou, odds_ah, lines, latest_t 
          FROM football_odds
          WHERE fixture_id = $1 AND bookie = $2
        `;
        const existingResult = await pool.query(existingQuery, [prediction.fixture_id, 'Prediction']);

        let finalX12Odds = [newX12Entry];
        let finalOuOdds = [newOuEntry];
        let finalAhOdds = [newAhEntry];
        let finalLines = [newLinesEntry];
        let finalLatestT = latestT;

        if (existingResult.rows.length > 0) {
          const existing = existingResult.rows[0];

          // Merge X12 odds - add to existing array or replace if same timestamp
          if (existing.odds_x12) {
            const existingX12 = existing.odds_x12;
            const existingIndex = existingX12.findIndex(entry => entry.t === timestamp);
            if (existingIndex >= 0) {
              existingX12[existingIndex] = newX12Entry; // Replace if same timestamp
              finalX12Odds = existingX12;
            } else {
              finalX12Odds = [...existingX12, newX12Entry]; // Append new timestamp
            }
          }

          // Merge OU odds
          if (existing.odds_ou) {
            const existingOu = existing.odds_ou;
            const existingIndex = existingOu.findIndex(entry => entry.t === timestamp);
            if (existingIndex >= 0) {
              existingOu[existingIndex] = newOuEntry;
              finalOuOdds = existingOu;
            } else {
              finalOuOdds = [...existingOu, newOuEntry];
            }
          }

          // Merge AH odds
          if (existing.odds_ah) {
            const existingAh = existing.odds_ah;
            const existingIndex = existingAh.findIndex(entry => entry.t === timestamp);
            if (existingIndex >= 0) {
              existingAh[existingIndex] = newAhEntry;
              finalAhOdds = existingAh;
            } else {
              finalAhOdds = [...existingAh, newAhEntry];
            }
          }

          // Merge lines
          if (existing.lines) {
            const existingLines = existing.lines;
            const existingIndex = existingLines.findIndex(entry => entry.t === timestamp);
            if (existingIndex >= 0) {
              existingLines[existingIndex] = newLinesEntry;
              finalLines = existingLines;
            } else {
              finalLines = [...existingLines, newLinesEntry];
            }
          }

          // Merge latest_t
          if (existing.latest_t) {
            finalLatestT = { ...existing.latest_t, ...latestT };
          }
        }

        // Insert or update odds in football_odds table with merged data
        await pool.query(
          `INSERT INTO football_odds (
            fixture_id,
            bookie_id,
            bookie,
            odds_x12,
            odds_ou,
            odds_ah,
            lines,
            latest_t,
            decimals
          ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
          ON CONFLICT (fixture_id, bookie)
          DO UPDATE SET
            odds_x12 = $4::jsonb,
            odds_ou = $5::jsonb,
            odds_ah = $6::jsonb,
            lines = $7::jsonb,
            latest_t = $8::jsonb,
            decimals = $9,
            updated_at = NOW()`,
          [
            prediction.fixture_id,
            1, // Prediction model 1
            'Prediction',
            JSON.stringify(finalX12Odds),
            JSON.stringify(finalOuOdds),
            JSON.stringify(finalAhOdds),
            JSON.stringify(finalLines),
            JSON.stringify(finalLatestT),
            3 // decimals = 3 (basis points / 1000)
          ]
        );

        calculated++;

      } catch (error) {
        console.error(`   ❌ Error calculating odds for fixture ${prediction.fixture_id}:`, error.message);
        errors++;
      }
    }

    // Show sample results
    const sampleResult = await pool.query(`
      SELECT
        fo.fixture_id,
        f.home_team_name,
        f.away_team_name,
        fp.home_pred,
        fp.away_pred,
        (fo.odds_x12->-1->'x12'->>0)::numeric / 1000.0 as home_odds,
        (fo.odds_x12->-1->'x12'->>1)::numeric / 1000.0 as draw_odds,
        (fo.odds_x12->-1->'x12'->>2)::numeric / 1000.0 as away_odds,
        jsonb_array_length((fo.lines->-1->'ou')::jsonb) as ou_lines_count,
        jsonb_array_length((fo.lines->-1->'ah')::jsonb) as ah_lines_count
      FROM football_odds fo
      JOIN football_fixtures f ON fo.fixture_id = f.id
      JOIN football_predictions fp ON fo.fixture_id = fp.fixture_id
      WHERE fo.bookie = 'Prediction'
      ORDER BY f.date DESC
      LIMIT 3
    `);

    return calculated;

  } catch (error) {
    console.error('❌ Error in calculateOddsFromPredictions:', error.message);
    throw error;
  }
}

// Export the function
export { calculateOddsFromPredictions };
