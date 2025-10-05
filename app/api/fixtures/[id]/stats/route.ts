import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../../lib/db-utils';


async function getFixtureStats(_request: Request, { params }: { params: { id: string } }) {
  const fixtureId = parseInt(params.id);

  if (isNaN(fixtureId)) {
    return NextResponse.json({ error: 'Invalid fixture ID' }, { status: 400 });
  }

  // Query to get all columns from football_stats table excluding fixture_id and created_at
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
      f.market_xg_home as home_market_xg,
      f.market_xg_away as away_market_xg,
      fp.home_pred as ai_home_pred,
      fp.away_pred as ai_away_pred
     FROM football_stats fs
     INNER JOIN football_fixtures f ON fs.fixture_id = f.id
     LEFT JOIN football_predictions fp ON fs.fixture_id = fp.fixture_id
     WHERE fs.fixture_id = $1`,
    [fixtureId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ stats: null });
  }

  return NextResponse.json({ stats: result.rows[0] });
}

export const GET = withErrorHandler(getFixtureStats);
