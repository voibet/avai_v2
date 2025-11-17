import { NextResponse } from 'next/server';
import { getPoolStats, checkDatabaseHealth } from '@/lib/database/db-utils';

export async function GET() {
  try {
    const poolStats = getPoolStats();

    // Check database health
    const healthCheck = await checkDatabaseHealth();

    const client = await import('@/lib/database/db').then(m => m.default.connect());
    try {
      // Get connection stats
      const connectionsResult = await client.query(`
        SELECT
          count(*) as total,
          count(*) filter (WHERE state = 'active') as active,
          count(*) filter (WHERE state = 'idle') as idle,
          count(*) filter (WHERE state = 'idle in transaction') as idle_in_transaction,
          count(*) filter (WHERE wait_event_type IS NOT NULL) as waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      const connections = connectionsResult.rows[0];

      // Get cache hit ratio
      const cacheResult = await client.query(`
        SELECT
          round(
            sum(blks_hit) * 100.0 / (sum(blks_hit) + sum(blks_read)), 2
          ) as cache_hit_ratio
        FROM pg_stat_database
        WHERE datname = current_database()
      `);

      const cacheHitRatio = parseFloat(cacheResult.rows[0].cache_hit_ratio) || 0;

      // Get active queries
      const activeQueriesResult = await client.query(`
        SELECT count(*) as active_queries
        FROM pg_stat_activity
        WHERE datname = current_database()
        AND state = 'active'
        AND query NOT LIKE '%pg_stat_activity%'
      `);

      const activeQueries = parseInt(activeQueriesResult.rows[0].active_queries) || 0;

      // Get recent queries (last 10 active queries)
      const recentQueriesResult = await client.query(`
        SELECT
          pid,
          query,
          extract(epoch from (now() - query_start)) * 1000 as duration_ms,
          state
        FROM pg_stat_activity
        WHERE datname = current_database()
        AND state = 'active'
        AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY query_start DESC
        LIMIT 10
      `);

      // Get database stats
      const databaseStatsResult = await client.query(`
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
      `);

      // Get active locks
      const locksResult = await client.query(`
        SELECT
          l.locktype,
          l.relation::regclass as relation_name,
          l.mode,
          l.granted,
          l.pid
        FROM pg_locks l
        LEFT JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE a.datname = current_database()
        ORDER BY l.locktype, relation_name
      `);

      return NextResponse.json({
        timestamp: new Date().toISOString(),
        connections: {
          total: parseInt(connections.total),
          active: parseInt(connections.active),
          idle: parseInt(connections.idle),
          idle_in_transaction: parseInt(connections.idle_in_transaction),
          waiting: parseInt(connections.waiting)
        },
        performance: {
          cache_hit_ratio: cacheHitRatio,
          active_queries: activeQueries,
          recent_queries: recentQueriesResult.rows.map(row => ({
            pid: row.pid,
            query: row.query.substring(0, 100) + (row.query.length > 100 ? '...' : ''),
            duration_ms: Math.round(parseFloat(row.duration_ms) || 0),
            state: row.state
          })),
          database_stats: databaseStatsResult.rows
        },
        locks: locksResult.rows.map(row => ({
          locktype: row.locktype,
          relation_name: row.relation_name,
          mode: row.mode,
          granted: row.granted,
          pid: row.pid
        })),
        health: healthCheck
      });
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Database monitor error:', error);
    return NextResponse.json(
      { error: 'Failed to get database stats' },
      { status: 500 }
    );
  }
}