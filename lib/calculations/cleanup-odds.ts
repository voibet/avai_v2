import pool from '../database/db';

/**
 * Cleanup odds for past fixtures
 * Removes odds data for fixtures that have finished to save space
 */
export async function cleanupPastFixturesOdds(): Promise<{ processedFixtures: number; cleanedRecords: number }> {
  console.log('Starting odds cleanup for past fixtures...');

  try {
    // Get count of past fixtures with odds
    const countQuery = `
      SELECT COUNT(*) as total_fixtures
      FROM football_fixtures f
      WHERE LOWER(f.status_short) IN ('ft', 'aet', 'pen')
        AND EXISTS (
          SELECT 1 FROM football_odds fo
          WHERE fo.fixture_id = f.id
        )
    `;

    const countResult = await pool.query(countQuery);
    const totalFixtures = parseInt(countResult.rows[0].total_fixtures.toString());

    console.log(`Found ${totalFixtures} past fixtures with odds data`);

    // Delete odds records for past fixtures
    const deleteQuery = `
      DELETE FROM football_odds
      WHERE fixture_id IN (
        SELECT id FROM football_fixtures
        WHERE LOWER(status_short) IN ('ft', 'aet', 'pen')
      )
    `;

    const deleteResult = await pool.query(deleteQuery);
    const cleanedRecords = parseInt(deleteResult.rowCount?.toString() || '0');

    console.log(`✅ Cleanup completed: ${totalFixtures} fixtures processed, ${cleanedRecords} odds records cleaned`);

    return {
      processedFixtures: totalFixtures,
      cleanedRecords: cleanedRecords
    };

  } catch (error: any) {
    console.error('❌ Error during odds cleanup:', error);
    throw error;
  }
}

