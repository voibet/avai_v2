import pool from '../database/db';

/**
 * Calculate hours since last match for fixtures
 */
export async function calculateHours(fixtureIds: number[] | null = null): Promise<number> {
  console.log('Running hours calculation...');
  const result = await pool.query('SELECT populate_hours_batch($1) as count', [fixtureIds]);
  const count = result.rows[0].count;
  console.log(`✅ Hours calculation completed: ${count} fixtures processed`);
  return count;
}

