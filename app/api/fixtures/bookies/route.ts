import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../lib/database/db-utils';


async function getAvailableBookies() {
  const query = `
    SELECT DISTINCT bookie
    FROM football_odds
    WHERE bookie != 'predictions'
    ORDER BY bookie
  `;

  const result = await executeQuery(query, []);

  return NextResponse.json({
    bookies: result.rows.map(row => row.bookie)
  });
}

export const GET = withErrorHandler(getAvailableBookies);
