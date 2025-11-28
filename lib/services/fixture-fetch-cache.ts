// Global singleton cache for fixture fetch attempts
// Prevents repeated fixture fetch attempts for the same league within a time window

interface FixtureFetchAttempt {
  leagueId: number;
  season: number;
  lastAttempt: number; // timestamp in milliseconds
  attempts: number; // number of attempts made
}

// Use global to ensure cache persists across Next.js hot reloads
declare global {
  var fixtureFetchCache: Map<string, FixtureFetchAttempt> | undefined;
}

// Default cache expiry time: 60 minutes for fixture fetches
const FIXTURE_CACHE_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Get the cache expiry time for fixture fetches
 * @returns The expiry time in milliseconds (60 minutes)
 */
export function getFixtureCacheExpiry(): number {
  return FIXTURE_CACHE_EXPIRY_MS;
}

/**
 * Generate a cache key for league-season combination
 * @param leagueId The league ID
 * @param season The season year
 * @returns Cache key string
 */
function getCacheKey(leagueId: number, season: number): string {
  return `${leagueId}-${season}`;
}

/**
 * Check if we should skip fixture fetch for a league-season due to recent attempt
 * @param leagueId The league ID to check
 * @param season The season year
 * @returns true if we should skip the fetch, false if we can proceed
 */
export function shouldSkipFixtureFetch(leagueId: number, season: number): boolean {
  const now = Date.now();
  const cacheKey = getCacheKey(leagueId, season);

  // Initialize cache if it doesn't exist
  if (!global.fixtureFetchCache) {
    global.fixtureFetchCache = new Map<string, FixtureFetchAttempt>();
  }

  const attempt = global.fixtureFetchCache.get(cacheKey);

  if (!attempt) {
    // No previous attempt, we can fetch
    return false;
  }

  // Check if the last attempt was within the cache expiry window
  if (now - attempt.lastAttempt < FIXTURE_CACHE_EXPIRY_MS) {
    const time = new Date().toTimeString().slice(0, 8); // HH:MM:SS format
    const minutesAgo = Math.round((now - attempt.lastAttempt) / 1000 / 60);
    console.log(`${time} [Fixture Cache] Skipping fixture fetch for league ${leagueId} season ${season} - last attempted ${minutesAgo} minutes ago (${attempt.attempts} total attempts)`);
    return true;
  }

  // Cache entry is expired, we can fetch
  return false;
}

/**
 * Record that we attempted to fetch fixtures for a league-season
 * @param leagueId The league ID that was attempted
 * @param season The season year
 * @param success Whether the fetch was successful
 */
export function recordFixtureFetchAttempt(leagueId: number, season: number, _success: boolean = false): void {
  const now = Date.now();
  const cacheKey = getCacheKey(leagueId, season);

  // Initialize cache if it doesn't exist
  if (!global.fixtureFetchCache) {
    global.fixtureFetchCache = new Map<string, FixtureFetchAttempt>();
  }

  const existing = global.fixtureFetchCache.get(cacheKey);

  if (existing) {
    // Update existing attempt
    existing.lastAttempt = now;
    existing.attempts += 1;
  } else {
    // Create new attempt record
    global.fixtureFetchCache.set(cacheKey, {
      leagueId,
      season,
      lastAttempt: now,
      attempts: 1
    });
  }
}









