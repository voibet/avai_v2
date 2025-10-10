import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../../lib/database/db-utils';


async function getFixtureOdds(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  // Optimized single query with LEFT JOINs for better performance
  const result = await executeQuery(`
    SELECT
      fo.*,
      fp.payout_x12,
      fp.payout_ah,
      fp.payout_ou
    FROM football_odds fo
    LEFT JOIN football_payouts fp ON fo.fixture_id = fp.fixture_id AND fo.bookie = fp.bookie
    WHERE fo.fixture_id = $1
    ORDER BY fo.bookie
  `, [fixtureId]);

  let odds = result.rows;

  // Add fair odds from Pinnacle as a special bookmaker entry
  const fairOddsResult = await executeQuery(
    'SELECT * FROM football_fair_odds WHERE fixture_id = $1 AND LOWER(bookie) = $2',
    [fixtureId, 'pinnacle']
  );

  if (fairOddsResult.rows.length > 0) {
    const fairOdds = fairOddsResult.rows[0];

    // Convert fair odds to the same format as regular odds
    const fairOddsEntry = {
      fixture_id: fixtureId,
      bookie: 'PINNACLE_FAIR_ODDS',
      decimals: fairOdds.decimals,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Add fair odds data
      fair_odds_x12: fairOdds.fair_odds_x12,
      fair_odds_ah: fairOdds.fair_odds_ah,
      fair_odds_ou: fairOdds.fair_odds_ou,
      latest_lines: fairOdds.latest_lines
    };

    odds.push(fairOddsEntry);
  }

  return NextResponse.json({ odds: odds });
}

export const GET = withErrorHandler(getFixtureOdds);
