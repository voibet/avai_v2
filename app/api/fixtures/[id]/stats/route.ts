import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../../lib/db-utils';


async function getFixtureStats(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  // Query to get all columns from football_stats table excluding fixture_id and created_at
  // and join with market_xg_view, predicted_xg_view, and predicted_market_xg_view for XG data
  const result = await executeQuery(
    `SELECT
      fs.updated_at,
      fs.hours_since_last_match_home,
      fs.hours_since_last_match_away,
      fs.avg_goals_league,
      fs.elo_home,
      fs.elo_away,
      fs.league_elo,
      fs.home_advantage,
      fs.adjusted_rolling_xg_home,
      fs.adjusted_rolling_xga_home,
      fs.adjusted_rolling_xg_away,
      fs.adjusted_rolling_xga_away,
      fs.adjusted_rolling_market_xg_home,
      fs.adjusted_rolling_market_xga_home,
      fs.adjusted_rolling_market_xg_away,
      fs.adjusted_rolling_market_xga_away,
      meg.home_market_xg,
      meg.away_market_xg,
      pxg.home_predicted_xg,
      pxg.away_predicted_xg,
      pxg.total_predicted_xg,
      pmxg.home_predicted_market_xg,
      pmxg.away_predicted_market_xg,
      pmxg.total_predicted_market_xg
     FROM football_stats fs
     LEFT JOIN market_xg_view meg ON fs.fixture_id = meg.fixture_id
     LEFT JOIN predicted_xg_view pxg ON fs.fixture_id = pxg.fixture_id
     LEFT JOIN predicted_market_xg_view pmxg ON fs.fixture_id = pmxg.fixture_id
     WHERE fs.fixture_id = $1`,
    [fixtureId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ stats: null });
  }

  return NextResponse.json({ stats: result.rows[0] });
}

export const GET = withErrorHandler(getFixtureStats);
