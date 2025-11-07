import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../lib/database/db-utils';

export interface DatabaseMetrics {
  timestamp: string;
  connections: {
    total: number;
    active: number;
    idle: number;
    idle_in_transaction: number;
    waiting: number;
  };
  performance: {
    active_queries: number;
    cache_hit_ratio: number;
    recent_queries: Array<{
      pid: number;
      username: string;
      client_addr: string;
      query: string;
      duration_ms: number;
      state: string;
      application_name: string;
      query_start: string;
    }>;
    database_stats: Array<{
      datname: string;
      numbackends: number;
      xact_commit: number;
      xact_rollback: number;
      blks_read: number;
      blks_hit: number;
      tup_returned: number;
      tup_fetched: number;
      tup_inserted: number;
      tup_updated: number;
      tup_deleted: number;
    }>;
  };
  locks: Array<{
    locktype: string;
    relation: string;
    mode: string;
    granted: boolean;
    pid: number;
    query: string;
  }>;
}

async function getDatabaseMetrics(): Promise<DatabaseMetrics> {
  const timestamp = new Date().toISOString();

  // Get connection statistics
  const connectionQuery = `
    SELECT
      COUNT(*) as total_connections,
      COUNT(*) FILTER (WHERE state = 'active') as active_connections,
      COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
      COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction_connections,
      COUNT(*) FILTER (WHERE wait_event IS NOT NULL) as waiting_connections
    FROM pg_stat_activity
    WHERE datname = current_database()
  `;

  const connectionResult = await executeQuery(connectionQuery);

  // Get active and long-running queries (queries running longer than 30 seconds)
  const activeQueriesQuery = `
    SELECT
      pid,
      usename as username,
      client_addr::text,
      query,
      EXTRACT(EPOCH FROM (now() - query_start)) as duration_seconds,
      state,
      wait_event_type,
      wait_event
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND query NOT LIKE '%pg_stat_activity%'
      AND query NOT LIKE '%pg_stat_database%'
    ORDER BY query_start ASC
  `;

  const activeQueriesResult = await executeQuery(activeQueriesQuery);

  // Get recent queries (last 5 active queries with their performance)
  const recentQueriesQuery = `
    SELECT
      pid,
      usename as username,
      client_addr::text,
      query,
      COALESCE(EXTRACT(EPOCH FROM (now() - query_start)) * 1000, 0) as duration_ms,
      state,
      application_name,
      query_start::text
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND query NOT LIKE '%pg_stat_activity%'
      AND query NOT LIKE '%pg_stat_database%'
    ORDER BY query_start DESC
    LIMIT 5
  `;

  const recentQueriesResult = await executeQuery(recentQueriesQuery);

  // Get database statistics
  const databaseStatsQuery = `
    SELECT
      datname,
      numbackends,
      xact_commit,
      xact_rollback,
      blks_read,
      blks_hit,
      tup_returned,
      tup_fetched,
      tup_inserted,
      tup_updated,
      tup_deleted
    FROM pg_stat_database
    WHERE datname = current_database()
  `;

  const databaseStatsResult = await executeQuery(databaseStatsQuery);

  // Get lock information
  const locksQuery = `
    SELECT
      l.locktype,
      COALESCE(r.relname, 'N/A') as relation,
      l.mode,
      l.granted,
      l.pid,
      a.query
    FROM pg_locks l
    LEFT JOIN pg_class r ON l.relation = r.oid
    LEFT JOIN pg_stat_activity a ON l.pid = a.pid
    WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY l.locktype, l.relation
  `;

  const locksResult = await executeQuery(locksQuery);

  const connections = connectionResult.rows[0] || {
    total_connections: 0,
    active_connections: 0,
    idle_connections: 0,
    idle_in_transaction_connections: 0,
    waiting_connections: 0
  };

  // Calculate cache hit ratio
  const dbStats = databaseStatsResult.rows[0];
  const cacheHitRatio = dbStats && (parseInt(dbStats.blks_read) + parseInt(dbStats.blks_hit)) > 0
    ? (parseInt(dbStats.blks_hit) / (parseInt(dbStats.blks_read) + parseInt(dbStats.blks_hit))) * 100
    : 0;

  return {
    timestamp,
    connections: {
      total: parseInt(connections.total_connections) || 0,
      active: parseInt(connections.active_connections) || 0,
      idle: parseInt(connections.idle_connections) || 0,
      idle_in_transaction: parseInt(connections.idle_in_transaction_connections) || 0,
      waiting: parseInt(connections.waiting_connections) || 0,
    },
    performance: {
      active_queries: activeQueriesResult.rows.length,
      cache_hit_ratio: cacheHitRatio,
      recent_queries: recentQueriesResult.rows,
      database_stats: databaseStatsResult.rows,
    },
    locks: locksResult.rows,
  };
}

export const GET = withErrorHandler(async (_request: NextRequest) => {
  try {
    const metrics = await getDatabaseMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Database monitoring error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve database metrics' },
      { status: 500 }
    );
  }
});
