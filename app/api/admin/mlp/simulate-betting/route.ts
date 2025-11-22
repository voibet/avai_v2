import { NextResponse } from 'next/server';
import pool from '../../../../../lib/database/db';
import { IN_PAST } from '../../../../../lib/constants';


export const dynamic = 'force-dynamic';

interface Bet {
  type: 'X12' | 'OU';
  outcome: string;
  pinnacleOdds: number;
  predictionOdds: number;
  ratio: number;
  market: string;
  line?: number;
  side?: string;
  outcome_index?: number;
}

interface BetDetail {
  fixture_id: number;
  home_team: string;
  away_team: string;
  fixture_date: string;
  bet: Bet;
  won: boolean;
  return: number;
}

// POST - Simulate betting using Pinnacle vs Prediction odds
// Compares X12 and OU 2.5 odds, places bets where Pinnacle odds / Prediction odds > 1.08 and Pinnacle odds < 4.00
export async function POST() {
  try {
    // Query fixtures that have both Pinnacle and Prediction odds
    const query = `
      SELECT
        f.id as fixture_id,
        f.home_team_name,
        f.away_team_name,
        f.date as fixture_date,
        f.timestamp as fixture_timestamp,
        f.score_fulltime_home,
        f.score_fulltime_away,

        -- Pinnacle odds (find closest to 5 days before fixture)
        po.odds_x12 as pinnacle_x12,
        po.odds_ou as pinnacle_ou,
        po.lines as pinnacle_lines,
        po.decimals as pinnacle_decimals,

        -- Prediction odds (use latest)
        pred_o.odds_x12 as prediction_x12,
        pred_o.odds_ou as prediction_ou,
        pred_o.lines as prediction_lines,
        pred_o.decimals as prediction_decimals

      FROM football_fixtures f

      -- Join Pinnacle odds
      INNER JOIN football_odds po ON f.id = po.fixture_id AND po.bookie = 'Pinnacle'

      -- Join Prediction odds
      INNER JOIN football_odds pred_o ON f.id = pred_o.fixture_id AND pred_o.bookie = 'Prediction'

      WHERE LOWER(f.status_short) = ANY($1)  -- Only completed matches
        AND f.score_fulltime_home IS NOT NULL
        AND f.score_fulltime_away IS NOT NULL

      ORDER BY f.date DESC
    `;

    const result = await pool.query(query, [IN_PAST]);
    const fixtures = result.rows;

    if (fixtures.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No fixtures found with both Pinnacle and Prediction odds'
      });
    }

    let totalBetsPlaced = 0;
    let totalReturn = 0;
    let totalStake = 0;
    let totalOddsSum = 0;
    const betDetails: BetDetail[] = [];

    for (const fixture of fixtures) {
      const betsForFixture: Bet[] = [];

      // Process X12 odds
      const x12Bets = analyzeX12Odds(fixture);
      betsForFixture.push(...x12Bets);

      // Process OU 2.5 odds
      const ouBets = analyzeOUOdds(fixture);
      betsForFixture.push(...ouBets);

      // Sort by ratio descending and take only the best bet per fixture
      if (betsForFixture.length > 0) {
        betsForFixture.sort((a, b) => b.ratio - a.ratio);
        const bestBet = betsForFixture[0];

        totalBetsPlaced++;
        totalStake += 1; // 1 unit per bet
        totalOddsSum += bestBet.pinnacleOdds; // Sum of odds for all bets placed

        // Check if bet won
        const won = checkIfBetWon(bestBet, fixture);
        if (won) {
          totalReturn += bestBet.pinnacleOdds;
        }

        betDetails.push({
          fixture_id: fixture.fixture_id,
          home_team: fixture.home_team_name,
          away_team: fixture.away_team_name,
          fixture_date: fixture.fixture_date,
          bet: bestBet,
          won: won,
          return: won ? bestBet.pinnacleOdds : 0
        });
      }
    }

    const profitLoss = totalReturn - totalStake;
    const profitPercentage = totalStake > 0 ? (profitLoss / totalStake) * 100 : 0;
    const averageOdds = totalBetsPlaced > 0 ? totalOddsSum / totalBetsPlaced : 0;

    return NextResponse.json({
      success: true,
      message: `Betting simulation completed: ${totalBetsPlaced} bets placed`,
      summary: {
        totalBetsPlaced,
        totalStake,
        totalReturn,
        profitLoss,
        profitPercentage,
        averageOdds
      },
      bets: betDetails.slice(0, 50) // Limit to first 50 bets for display
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Betting simulation failed' },
      { status: 500 }
    );
  }
}

function analyzeX12Odds(fixture: any): Bet[] {
  const bets: Bet[] = [];

  try {
    // Get Pinnacle odds closest to 5 days before fixture
    const pinnacleX12 = getOddsAtTimestamp(fixture.pinnacle_x12, fixture.fixture_timestamp - (5 * 24 * 60 * 60));
    const predictionX12 = getLatestOdds(fixture.prediction_x12);

    if (!pinnacleX12 || !predictionX12) return bets;

    const pinnacleMultiplier = Math.pow(10, fixture.pinnacle_decimals || 3); // Default to 3 if null
    const predictionMultiplier = Math.pow(10, fixture.prediction_decimals || 3); // Default to 3 if null

    // Analyze each X12 outcome (Home, Draw, Away)
    const outcomes = ['Home', 'Draw', 'Away'];
    for (let i = 0; i < 3; i++) {
      const pinnacleOdds = pinnacleX12[i] / pinnacleMultiplier; // Convert from basis points using decimals
      const predictionOdds = predictionX12[i] / predictionMultiplier;

      if (pinnacleOdds > 1 && predictionOdds > 1) {
        const ratio = pinnacleOdds / predictionOdds;


        // Check criteria: ratio > 1.08 and pinnacle odds < 5.00
        if (ratio > 1.08 && pinnacleOdds < 5.00) {
          bets.push({
            type: 'X12',
            outcome: outcomes[i],
            pinnacleOdds,
            predictionOdds,
            ratio,
            market: 'x12',
            outcome_index: i
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error analyzing X12 odds for fixture ${fixture.fixture_id}:`, error);
  }

  return bets;
}

function analyzeOUOdds(fixture: any): Bet[] {
  const bets: Bet[] = [];

  try {
    // Get Pinnacle odds closest to 5 days before fixture
    const pinnacleOU = getOUOddsAtTimestamp(fixture.pinnacle_ou, fixture.pinnacle_lines, fixture.fixture_timestamp - (5 * 24 * 60 * 60));
    const predictionOU = getOULatestOdds(fixture.prediction_ou, fixture.prediction_lines);

    if (!pinnacleOU || !predictionOU) return bets;

    const pinnacleMultiplier = Math.pow(10, fixture.pinnacle_decimals || 3); // Default to 3 if null
    const predictionMultiplier = Math.pow(10, fixture.prediction_decimals || 3); // Default to 3 if null

    // Focus on Over 2.5 and Under 2.5
    const overOdds = pinnacleOU.over / pinnacleMultiplier;
    const underOdds = pinnacleOU.under / pinnacleMultiplier;
    const predOverOdds = predictionOU.over / predictionMultiplier;
    const predUnderOdds = predictionOU.under / predictionMultiplier;

    // Check Over 2.5
    if (overOdds > 1 && predOverOdds > 1) {
      const ratio = overOdds / predOverOdds;
      if (ratio > 1.08 && overOdds < 5.00) {
        bets.push({
          type: 'OU',
          outcome: 'Over 2.5',
          pinnacleOdds: overOdds,
          predictionOdds: predOverOdds,
          ratio,
          market: 'ou',
          line: 2.5,
          side: 'over'
        });
      }
    }

    // Check Under 2.5
    if (underOdds > 1 && predUnderOdds > 1) {
      const ratio = underOdds / predUnderOdds;
      if (ratio > 1.08 && underOdds < 5.00) {
        bets.push({
          type: 'OU',
          outcome: 'Under 2.5',
          pinnacleOdds: underOdds,
          predictionOdds: predUnderOdds,
          ratio,
          market: 'ou',
          line: 2.5,
          side: 'under'
        });
      }
    }
  } catch (error) {
    console.error(`Error analyzing OU odds for fixture ${fixture.fixture_id}:`, error);
  }

  return bets;
}

function getOddsAtTimestamp(oddsArray: any[], targetTimestamp: number) {
  if (!oddsArray || oddsArray.length === 0) return null;

  // Find odds closest to target timestamp
  let closest = oddsArray[0];
  let minDiff = Math.abs(oddsArray[0].t - targetTimestamp);

  for (const odds of oddsArray) {
    const diff = Math.abs(odds.t - targetTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = odds;
    }
  }

  return closest.x12;
}

function getLatestOdds(oddsArray: any[]) {
  if (!oddsArray || oddsArray.length === 0) return null;
  return oddsArray[oddsArray.length - 1].x12;
}

function getOUOddsAtTimestamp(oddsArray: any[], linesArray: any[], targetTimestamp: number) {
  if (!oddsArray || !linesArray || oddsArray.length === 0 || linesArray.length === 0) return null;

  // Find the index for 2.5 line
  let lineIndex = -1;
  for (let i = 0; i < linesArray.length; i++) {
    const ouLines = linesArray[i].ou;
    if (ouLines && ouLines.includes(2.5)) {
      lineIndex = ouLines.indexOf(2.5);
      break;
    }
  }

  if (lineIndex === -1) return null;

  // Find odds closest to target timestamp
  let closest = null;
  let minDiff = Infinity;

  for (const odds of oddsArray) {
    const diff = Math.abs(odds.t - targetTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = odds;
    }
  }

  if (!closest) return null;

  return {
    over: closest.ou_o[lineIndex],
    under: closest.ou_u[lineIndex]
  };
}

function getOULatestOdds(oddsArray: any[], linesArray: any[]) {
  if (!oddsArray || !linesArray || oddsArray.length === 0 || linesArray.length === 0) return null;

  // Find the index for 2.5 line
  let lineIndex = -1;
  const latestLines = linesArray[linesArray.length - 1];
  if (latestLines && latestLines.ou) {
    lineIndex = latestLines.ou.indexOf(2.5);
  }

  if (lineIndex === -1) return null;

  const latestOdds = oddsArray[oddsArray.length - 1];
  return {
    over: latestOdds.ou_o[lineIndex],
    under: latestOdds.ou_u[lineIndex]
  };
}

function checkIfBetWon(bet: any, fixture: any) {
  const actualHome = fixture.score_fulltime_home;
  const actualAway = fixture.score_fulltime_away;
  const totalGoals = actualHome + actualAway;

  if (bet.type === 'X12') {
    switch (bet.outcome) {
      case 'Home': return actualHome > actualAway;
      case 'Draw': return actualHome === actualAway;
      case 'Away': return actualAway > actualHome;
    }
  } else if (bet.type === 'OU') {
    if (bet.outcome === 'Over 2.5') {
      return totalGoals > 2.5;
    } else if (bet.outcome === 'Under 2.5') {
      return totalGoals < 2.5;
    }
  }

  return false;
}
