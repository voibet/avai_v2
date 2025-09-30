import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../../lib/db-utils';


async function getFixtureOdds(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  const result = await executeQuery(
    'SELECT * FROM football_odds WHERE fixture_id = $1 ORDER BY bookie',
    [fixtureId]
  );

  let odds = result.rows;

  // Add payout data to each bookmaker's odds
  for (let i = 0; i < odds.length; i++) {
    const bookmaker = odds[i];
    const payoutResult = await executeQuery(
      'SELECT payout_x12, payout_ah, payout_ou FROM payout_view WHERE fixture_id = $1 AND bookie = $2',
      [fixtureId, bookmaker.bookie]
    );

    if (payoutResult.rows.length > 0) {
      odds[i].payout_x12 = payoutResult.rows[0].payout_x12;
      odds[i].payout_ah = payoutResult.rows[0].payout_ah;
      odds[i].payout_ou = payoutResult.rows[0].payout_ou;
    }
  }

  // Add fair odds from Pinnacle as a special bookmaker entry
  const fairOddsResult = await executeQuery(
    'SELECT * FROM fair_odds_view WHERE fixture_id = $1 AND LOWER(bookie) = $2',
    [fixtureId, 'pinnacle']
  );

  if (fairOddsResult.rows.length > 0) {
    const fairOdds = fairOddsResult.rows[0];

    // Convert fair odds to the same format as regular odds
    const fairOddsEntry = {
      fixture_id: fixtureId,
      bookie_id: -1, // Special ID for fair odds
      bookie: 'PINNACLE_FAIR_ODDS',
      odds_x12: null,
      odds_ah: null,
      odds_ou: null,
      lines: null,
      ids: null,
      max_stakes: null,
      latest_t: { x12_ts: 0, ah_ts: 0, ou_ts: 0, ids_ts: 0, stakes_ts: 0, lines_ts: 0 },
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
