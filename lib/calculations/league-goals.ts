import pool from '../database/db';

/**
 * Calculate league average goals for fixtures
 */
export async function calculateLeagueGoals(fixtureIds: number[] | null = null): Promise<number> {
  console.log('Running league goals calculation...');
  const result = await pool.query('SELECT populate_league_goals_batch($1) as count', [fixtureIds]);
  const count = result.rows[0].count;
  console.log(`✅ Goals calculation completed: ${count} fixtures processed`);
  return count;
}

