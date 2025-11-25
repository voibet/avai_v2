import pool from '../database/db';

interface OddsEntry {
  t: number;
  [key: string]: any;
}

interface OddsData {
  fixture_id: number;
  bookie: string;
  odds_x12: OddsEntry[];
  odds_ou: OddsEntry[];
  odds_ah: OddsEntry[];
  lines: OddsEntry[];
  max_stakes: OddsEntry[];
}

/**
 * Cleanup odds for past fixtures
 * Keeps first and last odds, plus one per 60-minute window, removes duplicates
 * @param fixtureIds - Optional array of fixture IDs to process. If null, processes all past fixtures.
 */
export async function cleanupPastFixturesOdds(fixtureIds: number[] | null = null): Promise<{ processedFixtures: number; cleanedRecords: number }> {
  console.log('Running odds cleanup for past fixtures...');

  try {
    // Get past fixtures with odds (filtered by fixtureIds if provided)
    let fixturesQuery = `
      SELECT DISTINCT f.id, f.date
      FROM football_fixtures f
      WHERE LOWER(f.status_short) IN ('ft', 'aet', 'pen')
        AND EXISTS (
          SELECT 1 FROM football_odds fo
          WHERE fo.fixture_id = f.id
        )
    `;
    let queryParams: any[] = [];

    if (fixtureIds && fixtureIds.length > 0) {
      fixturesQuery += ` AND f.id = ANY($1)`;
      queryParams.push(fixtureIds);
    }

    const fixturesResult = await pool.query(fixturesQuery, queryParams);
    const fixtures = fixturesResult.rows;
    const totalFixtures = fixtures.length;

    let totalRecordsCleaned = 0;

    // Process each fixture
    for (const fixture of fixtures) {
      const fixtureId = fixture.id;

      // Get all odds data for this fixture
      const oddsQuery = `
        SELECT fixture_id, bookie, odds_x12, odds_ou, odds_ah, lines, max_stakes
        FROM football_odds
        WHERE fixture_id = $1
      `;

      const oddsResult = await pool.query(oddsQuery, [fixtureId]);
      const oddsRecords = oddsResult.rows as OddsData[];

      let fixtureRecordsCleaned = 0;

      // Process each bookie's odds
      for (const oddsRecord of oddsRecords) {
        const originalX12Count = oddsRecord.odds_x12?.length || 0;
        const originalOuCount = oddsRecord.odds_ou?.length || 0;
        const originalAhCount = oddsRecord.odds_ah?.length || 0;
        const originalLinesCount = oddsRecord.lines?.length || 0;
        const originalMaxStakesCount = oddsRecord.max_stakes?.length || 0;

        // Filter odds keeping first, last, and one per 60-minute window
        const filteredData = filterOddsData(oddsRecord);

        const newX12Count = filteredData.odds_x12?.length || 0;
        const newOuCount = filteredData.odds_ou?.length || 0;
        const newAhCount = filteredData.odds_ah?.length || 0;
        const newLinesCount = filteredData.lines?.length || 0;
        const newMaxStakesCount = filteredData.max_stakes?.length || 0;

        const recordsCleaned = (originalX12Count - newX12Count) +
          (originalOuCount - newOuCount) +
          (originalAhCount - newAhCount) +
          (originalLinesCount - newLinesCount) +
          (originalMaxStakesCount - newMaxStakesCount);

        if (recordsCleaned > 0) {
          // Update the database with filtered odds
          await pool.query(`
            UPDATE football_odds
            SET odds_x12 = $1, odds_ou = $2, odds_ah = $3, lines = $4, max_stakes = $5
            WHERE fixture_id = $6 AND bookie = $7
          `, [
            JSON.stringify(filteredData.odds_x12),
            JSON.stringify(filteredData.odds_ou),
            JSON.stringify(filteredData.odds_ah),
            JSON.stringify(filteredData.lines),
            JSON.stringify(filteredData.max_stakes),
            fixtureId,
            oddsRecord.bookie
          ]);

          fixtureRecordsCleaned += recordsCleaned;
        }
      }

      if (fixtureRecordsCleaned > 0) {
        totalRecordsCleaned += fixtureRecordsCleaned;
      }
    }

    console.log(`✅ Odds cleanup completed: ${totalFixtures} fixtures processed, ${totalRecordsCleaned} records cleaned`);

    return {
      processedFixtures: totalFixtures,
      cleanedRecords: totalRecordsCleaned
    };

  } catch (error: any) {
    console.error('❌ Error during odds cleanup:', error);
    throw error;
  }
}

/**
 * Filter odds data to keep first, last, and one per 60-minute window
 * Also removes consecutive duplicates within each odds type
 */
function filterOddsData(oddsData: OddsData): OddsData {
  // Collect all timestamps from all odds types
  const allTimestamps = new Set<number>();

  if (oddsData.odds_x12) oddsData.odds_x12.forEach(odd => allTimestamps.add(odd.t));
  if (oddsData.odds_ou) oddsData.odds_ou.forEach(odd => allTimestamps.add(odd.t));
  if (oddsData.odds_ah) oddsData.odds_ah.forEach(odd => allTimestamps.add(odd.t));
  if (oddsData.lines) oddsData.lines.forEach(line => allTimestamps.add(line.t));
  if (oddsData.max_stakes) oddsData.max_stakes.forEach(stake => allTimestamps.add(stake.t));

  if (allTimestamps.size === 0) {
    return { ...oddsData };
  }

  // Sort timestamps chronologically
  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  // Determine which timestamps to keep based on time windows
  const timestampsToKeep = selectTimestampsToKeep(sortedTimestamps);

  // Filter each odds array to only include kept timestamps, then deduplicate consecutive identical odds
  const filteredData: OddsData = {
    fixture_id: oddsData.fixture_id,
    bookie: oddsData.bookie,
    odds_x12: [],
    odds_ou: [],
    odds_ah: [],
    lines: [],
    max_stakes: []
  };

  if (oddsData.odds_x12) {
    const filtered = oddsData.odds_x12.filter(odd => timestampsToKeep.has(odd.t));
    filteredData.odds_x12 = removeConsecutiveDuplicates(filtered);
  }
  if (oddsData.odds_ou) {
    const filtered = oddsData.odds_ou.filter(odd => timestampsToKeep.has(odd.t));
    filteredData.odds_ou = removeConsecutiveDuplicates(filtered);
  }
  if (oddsData.odds_ah) {
    const filtered = oddsData.odds_ah.filter(odd => timestampsToKeep.has(odd.t));
    filteredData.odds_ah = removeConsecutiveDuplicates(filtered);
  }
  if (oddsData.lines) {
    const filtered = oddsData.lines.filter(line => timestampsToKeep.has(line.t));
    filteredData.lines = removeConsecutiveDuplicates(filtered);
  }
  if (oddsData.max_stakes) {
    const filtered = oddsData.max_stakes.filter(stake => timestampsToKeep.has(stake.t));
    filteredData.max_stakes = removeConsecutiveDuplicates(filtered);
  }

  return filteredData;
}

/**
 * Select timestamps to keep: first, last, and one per 60-minute window
 */
function selectTimestampsToKeep(timestamps: number[]): Set<number> {
  if (timestamps.length <= 2) {
    return new Set(timestamps);
  }

  const keepTimestamps = new Set<number>();

  // Always keep first and last
  keepTimestamps.add(timestamps[0]);
  keepTimestamps.add(timestamps[timestamps.length - 1]);

  // Keep one per 60-minute window between first and last
  const firstTime = timestamps[0];
  const windowSize = 60 * 60; // 60 minutes in seconds

  let currentWindowEnd = firstTime + windowSize;

  for (let i = 1; i < timestamps.length - 1; i++) {
    const timestamp = timestamps[i];

    if (timestamp >= currentWindowEnd) {
      keepTimestamps.add(timestamp);
      currentWindowEnd = timestamp + windowSize;
    }
  }

  return keepTimestamps;
}

/**
 * Remove consecutive entries with identical odds values
 */
function removeConsecutiveDuplicates<T extends OddsEntry>(oddsArray: T[]): T[] {
  if (oddsArray.length <= 1) {
    return oddsArray;
  }

  const result: T[] = [oddsArray[0]];

  for (let i = 1; i < oddsArray.length; i++) {
    const current = oddsArray[i];
    const previous = result[result.length - 1];

    // Compare odds values (excluding timestamp)
    const { t: _, ...currentOdds } = current;
    const { t: __, ...previousOdds } = previous;

    // Check if odds values are identical
    if (!areOddsEqual(currentOdds, previousOdds)) {
      result.push(current);
    }
  }

  return result;
}

/**
 * Check if two odds objects have identical values
 */
function areOddsEqual(odds1: any, odds2: any): boolean {
  // Handle arrays
  if (Array.isArray(odds1) && Array.isArray(odds2)) {
    if (odds1.length !== odds2.length) return false;
    return odds1.every((val, idx) => val === odds2[idx]);
  }

  // Handle objects
  if (typeof odds1 === 'object' && typeof odds2 === 'object' && odds1 !== null && odds2 !== null) {
    const keys1 = Object.keys(odds1);
    const keys2 = Object.keys(odds2);

    if (keys1.length !== keys2.length) return false;

    return keys1.every(key => {
      if (!(key in odds2)) return false;
      return areOddsEqual(odds1[key], odds2[key]);
    });
  }

  // Handle primitives
  return odds1 === odds2;
}

