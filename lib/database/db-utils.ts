import pool from './db';
import { NextResponse } from 'next/server';


export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * Execute a database query with automatic connection handling and retry logic
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = [],
  retries: number = 2
): Promise<QueryResult<T>> {
  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0
      };
    } catch (error: any) {
      lastError = error;
      console.error(`Database query error (attempt ${attempt + 1}/${retries + 1}):`, error.message);

      // If it's a "too many clients" error, wait before retrying
      if (error.code === '53300' && attempt < retries) {
        console.log(`Retrying in ${Math.pow(2, attempt) * 1000}ms due to connection limit...`);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  throw lastError;
}

/**
 * Get current pool statistics for monitoring
 */
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

/**
 * Health check for database connectivity
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  poolStats: any;
  message: string;
}> {
  try {
    // Simple query to test connectivity
    await executeQuery('SELECT 1 as health_check', [], 0);
    return {
      healthy: true,
      poolStats: getPoolStats(),
      message: 'Database connection is healthy'
    };
  } catch (error: any) {
    return {
      healthy: false,
      poolStats: getPoolStats(),
      message: `Database health check failed: ${error.message}`
    };
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
      console.error('API Error:', message);
      return NextResponse.json(
        { error: message },
        { status: 500 }
      );
    }
  };
}

/**
 * Save or update predictions in the football_predictions table
 * Does NOT overwrite adjustment fields on update
 */
export interface PredictionData {
  id: number;
  predicted_home: number;
  predicted_away: number;
}

export async function savePredictions(predictions: PredictionData[]): Promise<number> {
  if (predictions.length === 0) return 0;

  const client = await pool.connect();
  try {
    // Build bulk upsert query - MUCH faster than individual inserts
    const values: any[] = [];
    const valueStrings: string[] = [];
    
    predictions.forEach((pred, idx) => {
      const offset = idx * 3;
      valueStrings.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, NOW(), NOW())`);
      values.push(pred.id, pred.predicted_home, pred.predicted_away);
    });

    const query = `
      INSERT INTO football_predictions (
        fixture_id, 
        home_pred, 
        away_pred, 
        created_at, 
        updated_at
      )
      VALUES ${valueStrings.join(', ')}
      ON CONFLICT (fixture_id) 
      DO UPDATE SET
        home_pred = EXCLUDED.home_pred,
        away_pred = EXCLUDED.away_pred,
        updated_at = NOW()
    `;

    await client.query(query, values);
    return predictions.length;
  } finally {
    client.release();
  }
}
