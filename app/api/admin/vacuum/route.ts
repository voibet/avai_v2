import { NextResponse } from 'next/server';
import { Client } from 'pg';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { action, table, tables } = await request.json();

    if (action !== 'vacuum_analyze') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Support both single table and multiple tables
    const tablesToProcess = tables || (table ? [table] : []);

    if (tablesToProcess.length === 0) {
      return NextResponse.json({ error: 'No tables specified' }, { status: 400 });
    }

    // Validate all table names
    const invalidTables = tablesToProcess.filter(t => !t || !t.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
    if (invalidTables.length > 0) {
      return NextResponse.json({ error: `Invalid table names: ${invalidTables.join(', ')}` }, { status: 400 });
    }

    // Create a new client connection specifically for VACUUM
    // VACUUM cannot run inside a transaction, so we need a direct connection
    const client = new Client({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? true : false,
    });

    try {
      console.log(`Connecting to database for VACUUM ANALYZE on ${tablesToProcess.length} table(s)...`);
      await client.connect();

      const results = [];
      let reindexAttempted = false;

      for (const tableName of tablesToProcess) {
        console.log(`Starting VACUUM ANALYZE on ${tableName}...`);
        await client.query(`VACUUM ANALYZE ${tableName}`);
        console.log(`✅ VACUUM ANALYZE completed on ${tableName}`);
        results.push(`VACUUM ANALYZE ${tableName}: ✅`);
      }

      // Special reindex for football_odds if it was processed
      if (tablesToProcess.includes('football_odds')) {
        console.log(`Attempting REINDEX on idx_football_odds_fixture_bookie...`);
        try {
          await client.query('REINDEX INDEX CONCURRENTLY idx_football_odds_fixture_bookie');
          console.log(`✅ REINDEX CONCURRENTLY completed`);
          results.push('REINDEX idx_football_odds_fixture_bookie: ✅');
          reindexAttempted = true;
        } catch (error: any) {
          console.log(`⚠️ REINDEX failed:`, error.message);
          results.push('REINDEX idx_football_odds_fixture_bookie: ⚠️ Failed');
          reindexAttempted = true;
        }
      }

      return NextResponse.json({
        success: true,
        message: `Database maintenance completed`,
        details: results,
        reindex_attempted: reindexAttempted,
        timestamp: new Date().toISOString()
      });

    } catch (error: any) {
      console.error('VACUUM/REINDEX error:', error);
      return NextResponse.json(
        { error: `Database maintenance failed: ${error.message}` },
        { status: 500 }
      );
    } finally {
      await client.end();
    }

  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
