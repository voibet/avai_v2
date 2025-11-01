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

// Default cache expiry time: 60 minutes
const DEFAULT_CACHE_EXPIRY_MS = 60 * 60 * 1000;
// Sofascore cache expiry: 4 hours
const SOFASCORE_CACHE_EXPIRY_MS = 4 * 60 * 60 * 1000;

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
    console.log(`[XG Cache] Skipping XG fetch for fixture ${fixtureId} - last attempted ${Math.round((now - attempt.lastAttempt) / 1000 / 60)} minutes ago (${attempt.attempts} total attempts)`);
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
export function recordXGFetchAttempt(fixtureId: number, success: boolean = false): void {
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

  // Clean up old entries periodically (every 100 operations)
  if (global.xgFetchCache.size % 100 === 0) {
    cleanupExpiredEntries();
  }
}

/**
 * Get cache statistics for debugging
 */
export function getXGCacheStats(): { totalEntries: number; expiredEntries: number; activeEntries: number } {
  if (!global.xgFetchCache) {
    return { totalEntries: 0, expiredEntries: 0, activeEntries: 0 };
  }

  const now = Date.now();
  let expiredEntries = 0;
  let activeEntries = 0;

  // Use the maximum expiry time to determine expired vs active entries
  const maxExpiryMs = Math.max(DEFAULT_CACHE_EXPIRY_MS, SOFASCORE_CACHE_EXPIRY_MS);
  for (const attempt of Array.from(global.xgFetchCache.values())) {
    if (now - attempt.lastAttempt >= maxExpiryMs) {
      expiredEntries++;
    } else {
      activeEntries++;
    }
  }

  return {
    totalEntries: global.xgFetchCache.size,
    expiredEntries,
    activeEntries
  };
}

/**
 * Clean up expired cache entries
 */
export function cleanupExpiredEntries(): void {
  if (!global.xgFetchCache) {
    return;
  }

  const now = Date.now();
  const toDelete: number[] = [];

  // Use the maximum expiry time to ensure all expired entries are cleaned up
  const maxExpiryMs = Math.max(DEFAULT_CACHE_EXPIRY_MS, SOFASCORE_CACHE_EXPIRY_MS);
  for (const [fixtureId, attempt] of Array.from(global.xgFetchCache.entries())) {
    if (now - attempt.lastAttempt >= maxExpiryMs) {
      toDelete.push(fixtureId);
    }
  }

  toDelete.forEach(fixtureId => global.xgFetchCache!.delete(fixtureId));

  if (toDelete.length > 0) {
    console.log(`[XG Cache] Cleaned up ${toDelete.length} expired entries`);
  }
}

/**
 * Clear the entire cache (for testing/admin purposes)
 */
export function clearXGCache(): void {
  if (global.xgFetchCache) {
    const size = global.xgFetchCache.size;
    global.xgFetchCache.clear();
    console.log(`[XG Cache] Cleared ${size} entries`);
  }
}
