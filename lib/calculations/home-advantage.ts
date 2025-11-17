import pool from '../database/db';

/**
 * Calculate home advantage for leagues
 */
export async function calculateHomeAdvantage(fixtureIds: number[] | null = null): Promise<number> {
  console.log('Running home advantage calculation...');
  const result = await pool.query('SELECT populate_home_advantage_batch($1) as count', [fixtureIds]);
  const count = result.rows[0].count;
  console.log(`✅ Home advantage calculation completed: ${count} fixtures processed`);
  return count;
}

