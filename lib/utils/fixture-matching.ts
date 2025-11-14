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
      SELECT f.id, f.home_team_name, f.away_team_name, f.date
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

    // Find best match based on normalized team names
    const normalizedHomeTeam = normalizeTeamName(homeTeam);
    const normalizedAwayTeam = normalizeTeamName(awayTeam);

    for (const fixture of fixtureResult.rows) {
      const normalizedFixtureHome = normalizeTeamName(fixture.home_team_name);
      const normalizedFixtureAway = normalizeTeamName(fixture.away_team_name);

      const homeMatch = normalizedHomeTeam && normalizedFixtureHome &&
        (normalizedFixtureHome.includes(normalizedHomeTeam) || normalizedHomeTeam.includes(normalizedFixtureHome));
      const awayMatch = normalizedAwayTeam && normalizedFixtureAway &&
        (normalizedFixtureAway.includes(normalizedAwayTeam) || normalizedAwayTeam.includes(normalizedFixtureAway));

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
      SELECT f.id, f.home_team_name, f.away_team_name, f.date
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
