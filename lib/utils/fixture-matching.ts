import { executeQuery } from '../database/db-utils';

/**
 * Process team name by normalizing characters, removing punctuation, removing numbers,
 * removing words 2 letters or less and converting to lowercase
 */
function normalizeTeamName(teamName: string): string {
  if (!teamName) {
    return '';
  }

  // Normalize characters (remove accents/diacritics)
  let normalized = teamName.normalize('NFD');
  // Remove combining characters (accents)
  normalized = normalized.replace(/[\u0300-\u036f]/g, '');

  // Remove punctuation and special characters
  normalized = normalized.replace(/[.,/\\\-_()[\]{}+*=|<>?!@#$%^&*~`'":;]/g, '');

  // Remove digits
  normalized = normalized.replace(/\d+/g, '');

  // Convert to lowercase and split into words
  const words = normalized.toLowerCase().trim().split(/\s+/);

  // Filter out words with 2 or fewer letters, and common abbreviations like "AFC"
  const filteredWords = words.filter(word => word.length > 2 && word !== 'afc');

  // Join back into a string
  return filteredWords.join(' ');
}

/**
 * Get team mappings from football_teams table for the given team IDs
 */
async function getTeamMappings(teamIds: number[]): Promise<Map<number, string[]>> {
  if (teamIds.length === 0) {
    return new Map();
  }

  const result = await executeQuery(`
    SELECT id, name, mappings FROM football_teams
    WHERE id = ANY($1)
  `, [teamIds]);

  const mappings = new Map<number, string[]>();

  for (const team of result.rows) {
    // Start with the canonical team name
    const teamMappings = [team.name].filter((name: any) => name != null && typeof name === 'string');

    // Add all mappings from the JSONB array
    if (team.mappings && Array.isArray(team.mappings)) {
      const validMappings = team.mappings.filter((name: any) => name != null && typeof name === 'string');
      teamMappings.push(...validMappings);
    }

    mappings.set(team.id, teamMappings);
  }

  return mappings;
}

export interface FixtureMatchCriteria {
  startTime: Date;
  homeTeam: string;
  awayTeam: string;
  leagueId: number; // Internal league ID
}

export interface FixtureMatchResult {
  id: number;
  home_team_name: string;
  away_team_name: string;
  date: string;
}

/**
 * Global helper function to find fixtures that match given criteria
 * Looks for fixtures within +/- 12 hours with matching team names and league
 *
 * @param criteria - The matching criteria
 * @returns Promise<number | null> - The fixture ID if found, null otherwise
 */
export async function findMatchingFixture(criteria: FixtureMatchCriteria): Promise<number | null> {
  try {
    const { startTime, homeTeam, awayTeam, leagueId } = criteria;

    // Find fixtures within +/- 12 hours that match teams and league
    const fixtureQuery = `
      SELECT f.id, f.home_team_name, f.away_team_name, f.home_team_id, f.away_team_id, f.date
      FROM football_fixtures f
      WHERE f.league_id = $1
        AND f.date >= $2::timestamp - INTERVAL '12 hours'
        AND f.date <= $2::timestamp + INTERVAL '12 hours'
        AND LOWER(f.status_short) IN ('ns', 'tbd', 'pst')
    `;

    const fixtureResult = await executeQuery(fixtureQuery, [
      leagueId,
      startTime.toISOString()
    ]);

    if (fixtureResult.rows.length === 0) {
      return null;
    }

    // Get team IDs from fixtures to load mappings
    const teamIds = fixtureResult.rows.flatMap(fixture => [
      parseInt(fixture.home_team_id.toString()),
      parseInt(fixture.away_team_id.toString())
    ]);
    const uniqueTeamIds = Array.from(new Set(teamIds));

    // Load team mappings for better matching
    const teamMappings = await getTeamMappings(uniqueTeamIds);

    // Normalize input team names
    const normalizedHomeTeam = normalizeTeamName(homeTeam);
    const normalizedAwayTeam = normalizeTeamName(awayTeam);

    for (const fixture of fixtureResult.rows) {
      // Get all possible names for home team (fixture name + mappings)
      const homeTeamId = parseInt(fixture.home_team_id.toString());
      const homeTeamNames = [fixture.home_team_name];
      if (teamMappings.has(homeTeamId)) {
        homeTeamNames.push(...teamMappings.get(homeTeamId)!);
      }

      // Get all possible names for away team (fixture name + mappings)
      const awayTeamId = parseInt(fixture.away_team_id.toString());
      const awayTeamNames = [fixture.away_team_name];
      if (teamMappings.has(awayTeamId)) {
        awayTeamNames.push(...teamMappings.get(awayTeamId)!);
      }

      // Check if input home team matches any home team name/mapping
      const homeMatch = homeTeamNames.some(teamName => {
        const normalizedFixtureName = normalizeTeamName(teamName);
        return normalizedHomeTeam && normalizedFixtureName &&
          (normalizedFixtureName.includes(normalizedHomeTeam) || normalizedHomeTeam.includes(normalizedFixtureName));
      });

      // Check if input away team matches any away team name/mapping
      const awayMatch = awayTeamNames.some(teamName => {
        const normalizedFixtureName = normalizeTeamName(teamName);
        return normalizedAwayTeam && normalizedFixtureName &&
          (normalizedFixtureName.includes(normalizedAwayTeam) || normalizedAwayTeam.includes(normalizedFixtureName));
      });

      if (homeMatch && awayMatch) {
        return fixture.id;
      }
    }

    return null;
  } catch (error) {
    console.error('Error finding matching fixture:', error);
    return null;
  }
}


/**
 * Alternative function that finds all potential matches for a given league
 * Useful for debugging or when you need to see all candidates
 */
export async function findPotentialFixtureMatches(criteria: FixtureMatchCriteria): Promise<FixtureMatchResult[]> {
  try {
    const { startTime, leagueId } = criteria;

    const fixtureQuery = `
      SELECT f.id, f.home_team_name, f.away_team_name, f.home_team_id, f.away_team_id, f.date
      FROM football_fixtures f
      WHERE f.league_id = $1
        AND f.date >= $2::timestamp - INTERVAL '12 hours'
        AND f.date <= $2::timestamp + INTERVAL '12 hours'
        AND LOWER(f.status_short) IN ('ns', 'tbd', 'pst')
    `;

    const result = await executeQuery(fixtureQuery, [
      leagueId,
      startTime.toISOString()
    ]);

    return result.rows;
  } catch (error) {
    console.error('Error finding potential fixture matches:', error);
    return [];
  }
}
