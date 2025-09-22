import pool from './db';
import { NextResponse } from 'next/server';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * Execute a database query with automatic connection handling
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0
    };
  } finally {
    client.release();
  }
}

/**
 * Execute multiple queries in a transaction
 */
export async function executeTransaction<T>(
  queries: Array<{ query: string; params: any[] }>
): Promise<QueryResult<T>[]> {
  const client = await pool.connect();
  const results: QueryResult<T>[] = [];

  try {
    await client.query('BEGIN');

    for (const { query, params } of queries) {
      const result = await client.query(query, params);
      results.push({
        rows: result.rows,
        rowCount: result.rowCount || 0
      });
    }

    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Standard error response for API routes
 */
export function createErrorResponse(
  message: string,
  status: number = 500,
  details?: any
) {
  console.error('API Error:', message, details);
  return NextResponse.json(
    { error: message, ...(details && { details }) },
    { status }
  );
}


/**
 * Wrap API route handlers with consistent error handling
 */
export function withErrorHandler<T extends any[]>(
  handler: (...args: T) => Promise<NextResponse>
) {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      return createErrorResponse(message);
    }
  };
}
