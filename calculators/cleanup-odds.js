/**
 * Cleanup odds data for past fixtures - keeps only one entry per hour
 * Usage: node calculators/cleanup-odds.js
 */

import pool from '../lib/database/db.ts';
import { IN_PAST } from '../lib/constants.ts';

/**
 * Clean up historical odds data for fixtures that are IN_PAST.
 * Keeps only one entry per hour for each odds array.
 */
export async function cleanupPastFixturesOdds() {
  const client = await pool.connect();

  try {
    // Get all fixtures with IN_PAST status
    const fixturesQuery = `
      SELECT id
      FROM football_fixtures
      WHERE LOWER(status_short) = ANY($1)
    `;
    const fixturesResult = await client.query(fixturesQuery, [IN_PAST]);
    const fixtureIds = fixturesResult.rows.map(row => row.id);

    if (fixtureIds.length === 0) {
      console.log('No past fixtures found to clean up');
      return { processedFixtures: 0, cleanedRecords: 0 };
    }

    console.log(`Cleaning up odds data for ${fixtureIds.length} past fixtures`);

    let totalCleanedRecords = 0;

    // Process fixtures in batches to avoid memory issues
    const batchSize = 50;
    for (let i = 0; i < fixtureIds.length; i += batchSize) {
      const batchIds = fixtureIds.slice(i, i + batchSize);

      // Get all odds records for this batch of fixtures
      const oddsQuery = `
        SELECT fixture_id, bookie, odds_x12, odds_ah, odds_ou, lines, ids, max_stakes
        FROM football_odds
        WHERE fixture_id = ANY($1)
      `;
      const oddsResult = await client.query(oddsQuery, [batchIds]);

      const updateQueries = [];

      // Process each odds record
      for (const row of oddsResult.rows) {
        const { fixture_id, bookie, odds_x12, odds_ah, odds_ou, lines, ids, max_stakes } = row;


        // Helper function to compare if two odds entries are identical
        const areOddsEqual = (entry1, entry2) => {
          if (!entry1 || !entry2) return false;

          // Compare all numeric odds properties (home, draw, away for x12, etc.)
          const keys = Object.keys(entry1).filter(key => key !== 't' && typeof entry1[key] === 'number');

          for (const key of keys) {
            if (entry1[key] !== entry2[key]) {
              return false;
            }
          }

          return true;
        };

        // Helper function to filter odds array to one per hour and remove consecutive duplicates
        const filterOddsArray = (oddsArray) => {
          if (!oddsArray || oddsArray.length <= 2) return oddsArray;

          if (!Array.isArray(oddsArray) || oddsArray.length <= 2) return oddsArray;

          // Sort by timestamp
          const sorted = [...oddsArray].sort((a, b) => a.t - b.t);

          // Always keep first and last
          const first = sorted[0];
          const last = sorted[sorted.length - 1];

          // Group middle entries by hour and keep one per hour
          const middleEntries = sorted.slice(1, -1);
          const hourlyMap = new Map();

          middleEntries.forEach(entry => {
            const hourKey = Math.floor(entry.t / 3600) * 3600; // Round down to nearest hour
            if (!hourlyMap.has(hourKey)) {
              hourlyMap.set(hourKey, entry);
            }
          });

          // Combine first, hourly entries, and last
          let filtered = [first, ...Array.from(hourlyMap.values()), last];

          // Sort back by timestamp
          filtered = filtered.sort((a, b) => a.t - b.t);

          // Remove consecutive entries with identical odds
          const deduplicated = [filtered[0]]; // Always keep first entry

          for (let i = 1; i < filtered.length; i++) {
            if (!areOddsEqual(filtered[i], filtered[i - 1])) {
              deduplicated.push(filtered[i]);
            }
          }

          return deduplicated;
        };

        // Apply filtering to all odds arrays
        const filteredOddsX12 = filterOddsArray(odds_x12);
        const filteredOddsAh = filterOddsArray(odds_ah);
        const filteredOddsOu = filterOddsArray(odds_ou);
        const filteredLines = filterOddsArray(lines);
        const filteredIds = filterOddsArray(ids);
        const filteredMaxStakes = filterOddsArray(max_stakes);

        // Check if any arrays were actually filtered
        const hasChanges =
          (filteredOddsX12 !== odds_x12) ||
          (filteredOddsAh !== odds_ah) ||
          (filteredOddsOu !== odds_ou) ||
          (filteredLines !== lines) ||
          (filteredIds !== ids) ||
          (filteredMaxStakes !== max_stakes);

        if (hasChanges) {
          updateQueries.push({
            query: `
              UPDATE football_odds
              SET
                odds_x12 = $1::jsonb,
                odds_ah = $2::jsonb,
                odds_ou = $3::jsonb,
                lines = $4::jsonb,
                ids = $5::jsonb,
                max_stakes = $6::jsonb,
                updated_at = NOW()
              WHERE fixture_id = $7 AND bookie = $8
            `,
            params: [
              filteredOddsX12 ? JSON.stringify(filteredOddsX12) : null,
              filteredOddsAh ? JSON.stringify(filteredOddsAh) : null,
              filteredOddsOu ? JSON.stringify(filteredOddsOu) : null,
              filteredLines ? JSON.stringify(filteredLines) : null,
              filteredIds ? JSON.stringify(filteredIds) : null,
              filteredMaxStakes ? JSON.stringify(filteredMaxStakes) : null,
              fixture_id,
              bookie
            ]
          });
        }
      }

      // Execute updates for this batch
      if (updateQueries.length > 0) {
        for (const { query, params } of updateQueries) {
          try {
            await client.query(query, params);
          } catch (error) {
            console.error('Failed to update record:', error);
            console.error('Query:', query);
            console.error('Params:', params.map(p => typeof p === 'object' ? JSON.stringify(p).substring(0, 100) : p));
            throw error;
          }
        }
        totalCleanedRecords += updateQueries.length;
        console.log(`Updated ${updateQueries.length} odds records in batch ${Math.floor(i / batchSize) + 1}`);
      }
    }

    console.log(`Odds cleanup completed: processed ${fixtureIds.length} fixtures, cleaned ${totalCleanedRecords} records`);
    return { processedFixtures: fixtureIds.length, cleanedRecords: totalCleanedRecords };

  } finally {
    client.release();
  }
}

// Run directly if this file is executed
if (process.argv[1].endsWith('cleanup-odds.js')) {
  cleanupPastFixturesOdds()
    .then(result => {
      console.log('✅ Cleanup completed successfully:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Cleanup failed:', error);
      process.exit(1);
    });
}
