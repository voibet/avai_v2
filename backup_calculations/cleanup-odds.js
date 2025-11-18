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

        // Helper function to get a signature for odds comparison (excluding timestamp)
        const getOddsSignature = (entry) => {
          if (!entry) return null;

          // Create a signature based on the odds data (excluding 't' timestamp)
          const oddsData = { ...entry };
          delete oddsData.t;

          // Convert arrays to strings for comparison
          const signature = {};
          for (const [key, value] of Object.entries(oddsData)) {
            if (Array.isArray(value)) {
              signature[key] = JSON.stringify(value);
            } else {
              signature[key] = value;
            }
          }

          return JSON.stringify(signature);
        };

        // Helper function to filter odds array to one per hour and remove exact duplicates
        const filterOddsArray = (oddsArray) => {
          if (!oddsArray || oddsArray.length <= 2) return oddsArray;

          if (!Array.isArray(oddsArray) || oddsArray.length <= 2) return oddsArray;

          // Sort by timestamp
          const sorted = [...oddsArray].sort((a, b) => a.t - b.t);

          // First, remove exact duplicates - keep only the most recent entry for each unique odds signature
          const uniqueOdds = new Map();

          sorted.forEach(entry => {
            const signature = getOddsSignature(entry);
            if (!uniqueOdds.has(signature)) {
              uniqueOdds.set(signature, entry);
            } else {
              // Keep the more recent entry (higher timestamp)
              const existing = uniqueOdds.get(signature);
              if (entry.t > existing.t) {
                uniqueOdds.set(signature, entry);
              }
            }
          });

          const deduplicated = Array.from(uniqueOdds.values());

          // If we have 2 or fewer unique entries, return them
          if (deduplicated.length <= 2) {
            return deduplicated.sort((a, b) => a.t - b.t);
          }

          // Always keep first and last from the deduplicated set
          const first = deduplicated[0];
          const last = deduplicated[deduplicated.length - 1];

          // Group middle entries by hour and keep one per hour
          const middleEntries = deduplicated.slice(1, -1);
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

          return filtered;
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

// Test function for the deduplication logic
function testDeduplication() {
  // Test data similar to the user's example
  const testOddsX12 = [
    { t: 1762013154, x12: [3477, 3800, 2226] },
    { t: 1763222884, x12: [3477, 3800, 2226] },
    { t: 1763223801, x12: [3477, 3800, 2226] },
    { t: 1763224877, x12: [3477, 3800, 2226] },
    { t: 1763225008, x12: [3477, 3800, 2226] },
    { t: 1763225083, x12: [3477, 3800, 2226] }
  ];

  // Helper function to get a signature for odds comparison (excluding timestamp)
  const getOddsSignature = (entry) => {
    if (!entry) return null;

    // Create a signature based on the odds data (excluding 't' timestamp)
    const oddsData = { ...entry };
    delete oddsData.t;

    // Convert arrays to strings for comparison
    const signature = {};
    for (const [key, value] of Object.entries(oddsData)) {
      if (Array.isArray(value)) {
        signature[key] = JSON.stringify(value);
      } else {
        signature[key] = value;
      }
    }

    return JSON.stringify(signature);
  };

  // Helper function to filter odds array to one per hour and remove exact duplicates
  const filterOddsArray = (oddsArray) => {
    if (!oddsArray || oddsArray.length <= 2) return oddsArray;

    if (!Array.isArray(oddsArray) || oddsArray.length <= 2) return oddsArray;

    // Sort by timestamp
    const sorted = [...oddsArray].sort((a, b) => a.t - b.t);

    // First, remove exact duplicates - keep only the most recent entry for each unique odds signature
    const uniqueOdds = new Map();

    sorted.forEach(entry => {
      const signature = getOddsSignature(entry);
      if (!uniqueOdds.has(signature)) {
        uniqueOdds.set(signature, entry);
      } else {
        // Keep the more recent entry (higher timestamp)
        const existing = uniqueOdds.get(signature);
        if (entry.t > existing.t) {
          uniqueOdds.set(signature, entry);
        }
      }
    });

    const deduplicated = Array.from(uniqueOdds.values());

    // If we have 2 or fewer unique entries, return them
    if (deduplicated.length <= 2) {
      return deduplicated.sort((a, b) => a.t - b.t);
    }

    // Always keep first and last from the deduplicated set
    const first = deduplicated[0];
    const last = deduplicated[deduplicated.length - 1];

    // Group middle entries by hour and keep one per hour
    const middleEntries = deduplicated.slice(1, -1);
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

    return filtered;
  };

  const result = filterOddsArray(testOddsX12);
  console.log('Original entries:', testOddsX12.length);
  console.log('Filtered entries:', result.length);
  console.log('Result:', result);

  return result;
}

// Run directly if this file is executed
if (process.argv[1].endsWith('cleanup-odds.js')) {
  // Check if --test flag is provided
  if (process.argv.includes('--test')) {
    console.log('Running deduplication test...');
    testDeduplication();
    process.exit(0);
  }

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
