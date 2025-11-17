import pool from '../database/db';

/**
 * Calculate ELO ratings for teams and leagues
 */
export async function calculateElo(fixtureIds: number[] | null = null): Promise<number> {
  console.log('Running ELO calculations (team + league)...');
  const result = await pool.query('SELECT calculate_elos_incremental($1) as count', [fixtureIds]);
  const count = result.rows[0].count;
  console.log(`✅ ELO calculations completed: ${count} fixtures processed`);
  return count;
}

