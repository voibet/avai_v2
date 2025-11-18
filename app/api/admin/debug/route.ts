import { NextResponse } from 'next/server';
import pool from '@/lib/database/db';

export async function GET() {
  const client = await pool.connect();

  try {
    // Get total fixtures count
    const totalFixturesResult = await client.query(`
      SELECT COUNT(*) as total_fixtures
      FROM football_fixtures
    `);

    // Get past fixtures count (finished matches before current time)
    const pastFixturesResult = await client.query(`
      SELECT COUNT(*) as past_fixtures
      FROM football_fixtures
      WHERE date < NOW()
        AND LOWER(status_short) IN ('ft', 'aet', 'pen')
    `);

    // Get past fixtures where market xG is null
    const pastFixturesNullMarketXgResult = await client.query(`
      SELECT COUNT(*) as past_fixtures_null_market_xg
      FROM football_fixtures
      WHERE date < NOW()
        AND LOWER(status_short) IN ('ft', 'aet', 'pen')
        AND (market_xg_home IS NULL OR market_xg_away IS NULL)
    `);

    // Get past fixtures where regular xG is null
    const pastFixturesNullXgResult = await client.query(`
      SELECT COUNT(*) as past_fixtures_null_xg
      FROM football_fixtures
      WHERE date < NOW()
        AND LOWER(status_short) IN ('ft', 'aet', 'pen')
        AND (xg_home IS NULL OR xg_away IS NULL)
    `);

    const data = {
      total_fixtures: parseInt(totalFixturesResult.rows[0].total_fixtures),
      past_fixtures: parseInt(pastFixturesResult.rows[0].past_fixtures),
      past_fixtures_null_market_xg: parseInt(pastFixturesNullMarketXgResult.rows[0].past_fixtures_null_market_xg),
      past_fixtures_null_xg: parseInt(pastFixturesNullXgResult.rows[0].past_fixtures_null_xg)
    };

    return NextResponse.json(data);

  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json(
      { error: 'Failed to get debug statistics' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
