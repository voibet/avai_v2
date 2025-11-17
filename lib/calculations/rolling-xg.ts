import pool from '../database/db';

/**
 * Calculate rolling windows xG for teams
 */
export async function calculateRollingXG(fixtureIds: number[] | null = null): Promise<number> {
  console.log('Running rolling windows xG calculations...');
  const result = await pool.query('SELECT populate_adjusted_rolling_xg_batch($1) as count', [fixtureIds]);
  const count = result.rows[0].count;
  console.log(`✅ Rolling windows xG calculations completed: ${count} fixtures processed`);
  return count;
}

