import { NextResponse } from 'next/server';

/**
 * Common API parameter parsing utilities
 */

/**
 * Parse fixture IDs from URL parameters
 * Supports single ID, comma-separated IDs, and validation
 */
export function parseFixtureIds(searchParams: URLSearchParams): {
  fixtureIds: number[];
  error?: NextResponse;
} {
  const fixtureIdParam = searchParams.get('fixtureId') || searchParams.get('fixture_id');

  if (!fixtureIdParam) {
    return { fixtureIds: [] };
  }

  let fixtureIds: number[];

  if (fixtureIdParam.includes(',')) {
    // Multiple IDs separated by comma
    fixtureIds = fixtureIdParam
      .split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
  } else {
    // Single ID
    const fixtureId = parseInt(fixtureIdParam);
    fixtureIds = !isNaN(fixtureId) ? [fixtureId] : [];
  }

  if (fixtureIds.length === 0) {
    return {
      fixtureIds: [],
      error: NextResponse.json(
        { error: 'Invalid fixture ID(s) provided' },
        { status: 400 }
      )
    };
  }

  return { fixtureIds };
}

/**
 * Parse pagination parameters from URL
 */
export function parsePagination(searchParams: URLSearchParams): {
  limit: number | null;
  page: number;
  offset: number;
} {
  const limitParam = searchParams.get('limit');
  const pageParam = searchParams.get('page');

  const limit = limitParam ? parseInt(limitParam) : null;
  const page = pageParam ? parseInt(pageParam) : 1;
  const offset = limit && page > 1 ? (page - 1) * limit : 0;

  return { limit, page, offset };
}

/**
 * Parse bookie filtering parameters
 */
export function parseBookieFilter(searchParams: URLSearchParams): {
  bookies: string[] | null;
  excludePrediction: boolean;
} {
  const bookiesParam = searchParams.get('bookies');

  if (!bookiesParam) {
    return { bookies: null, excludePrediction: true };
  }

  const bookies = bookiesParam.split(',').map(b => b.trim()).filter(b => b.length > 0);

  return {
    bookies: bookies.length > 0 ? bookies : null,
    excludePrediction: true
  };
}

/**
 * Parse boolean parameters from URL
 */
export function parseBooleanParam(searchParams: URLSearchParams, paramName: string, defaultValue = false): boolean {
  const param = searchParams.get(paramName);
  if (!param) return defaultValue;

  return param.toLowerCase() === 'true' || param === '1';
}

/**
 * Parse league ID parameter
 */
export function parseLeagueId(searchParams: URLSearchParams): {
  leagueId: number | null;
  error?: NextResponse;
} {
  const leagueIdParam = searchParams.get('league_id') || searchParams.get('leagueId');

  if (!leagueIdParam) {
    return { leagueId: null };
  }

  const leagueId = parseInt(leagueIdParam);
  if (isNaN(leagueId)) {
    return {
      leagueId: null,
      error: NextResponse.json(
        { error: 'Invalid league ID provided' },
        { status: 400 }
      )
    };
  }

  return { leagueId };
}

/**
 * Standard API error response
 */
export function createApiError(message: string, status = 500): NextResponse {
  return NextResponse.json(
    { error: message },
    { status }
  );
}

/**
 * Standard success response with data
 */
export function createSuccessResponse(data: any, additionalFields?: Record<string, any>): NextResponse {
  return NextResponse.json({
    success: true,
    ...additionalFields,
    ...data
  });
}

