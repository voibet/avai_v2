// Global singleton cache for XG fetch attempts
// Prevents repeated XG fetch attempts for the same fixture within a time window

interface XGFetchAttempt {
  fixtureId: number;
  lastAttempt: number; // timestamp in milliseconds
  attempts: number; // number of attempts made
}

// Use global to ensure cache persists across Next.js hot reloads
declare global {
  var xgFetchCache: Map<number, XGFetchAttempt> | undefined;
}

// Default cache expiry time: 90 minutes
const DEFAULT_CACHE_EXPIRY_MS = 90 * 60 * 1000;
// Sofascore cache expiry: 600 minutes (10 hours)
const SOFASCORE_CACHE_EXPIRY_MS = 600 * 60 * 1000;

/**
 * Get the appropriate cache expiry time for an XG source
 * @param sourceUrl The XG source URL/identifier
 * @returns The expiry time in milliseconds
 */
export function getXGCacheExpiry(sourceUrl: string): number {
  if (sourceUrl.includes('-')) {
    // Sofascore format: "tournamentId-seasonId"
    return SOFASCORE_CACHE_EXPIRY_MS;
  } else {
    // Flashlive (any other format) or NATIVE
    return DEFAULT_CACHE_EXPIRY_MS;
  }
}

/**
 * Check if we should skip XG fetch for a fixture due to recent attempt
 * @param fixtureId The fixture ID to check
 * @param expiryMs The expiry time in milliseconds for this source type
 * @returns true if we should skip the fetch, false if we can proceed
 */
export function shouldSkipXGFetch(fixtureId: number, expiryMs: number = DEFAULT_CACHE_EXPIRY_MS): boolean {
  const now = Date.now();

  // Initialize cache if it doesn't exist
  if (!global.xgFetchCache) {
    global.xgFetchCache = new Map<number, XGFetchAttempt>();
  }

  const attempt = global.xgFetchCache.get(fixtureId);

  if (!attempt) {
    // No previous attempt, we can fetch
    return false;
  }

  // Check if the last attempt was within the cache expiry window
  if (now - attempt.lastAttempt < expiryMs) {
    const time = new Date().toTimeString().slice(0, 8); // HH:MM:SS format
    console.log(`${time} [XG Cache] Skipping XG fetch for fixture ${fixtureId} - last attempted ${Math.round((now - attempt.lastAttempt) / 1000 / 60)} minutes ago (${attempt.attempts} total attempts)`);
    return true;
  }

  // Cache entry is expired, we can fetch
  return false;
}

/**
 * Record that we attempted to fetch XG for a fixture
 * @param fixtureId The fixture ID that was attempted
 * @param success Whether the fetch was successful
 */
export function recordXGFetchAttempt(fixtureId: number, _success: boolean = false): void {
  const now = Date.now();

  // Initialize cache if it doesn't exist
  if (!global.xgFetchCache) {
    global.xgFetchCache = new Map<number, XGFetchAttempt>();
  }

  const existing = global.xgFetchCache.get(fixtureId);

  if (existing) {
    // Update existing attempt
    existing.lastAttempt = now;
    existing.attempts += 1;
  } else {
    // Create new attempt record
    global.xgFetchCache.set(fixtureId, {
      fixtureId,
      lastAttempt: now,
      attempts: 1
    });
  }

}

