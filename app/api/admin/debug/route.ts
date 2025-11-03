import { NextResponse } from 'next/server';
import { executeQuery, withErrorHandler } from '../../../../lib/database/db-utils';
import { IN_PAST } from '../../../../lib/constants';

interface DebugStats {
  total: number;
  inPast: number;
  inPastMissingXG: number;
  inPastMissingMarketXG: number;
}

interface SeasonDebugStats extends DebugStats {
  season: number;
}

async function getDebugStats(_request: Request) {
  try {
    // Overall stats
    const totalQuery = `SELECT COUNT(*) as count FROM football_fixtures`;
    const inPastQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE LOWER(status_short) IN (${IN_PAST.map(s => `'${s}'`).join(', ')})`;
    const missingXGQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE LOWER(status_short) IN (${IN_PAST.map(s => `'${s}'`).join(', ')}) AND (xg_home IS NULL OR xg_away IS NULL)`;
    const missingMarketXGQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE LOWER(status_short) IN (${IN_PAST.map(s => `'${s}'`).join(', ')}) AND (market_xg_home IS NULL OR market_xg_away IS NULL)`;

    const [totalResult, inPastResult, missingXGResult, missingMarketXGResult] = await Promise.all([
      executeQuery<{ count: number }>(totalQuery),
      executeQuery<{ count: number }>(inPastQuery),
      executeQuery<{ count: number }>(missingXGQuery),
      executeQuery<{ count: number }>(missingMarketXGQuery)
    ]);

    // Season-specific stats
    const seasonsQuery = `SELECT DISTINCT season FROM football_fixtures ORDER BY season DESC`;
    const seasonsResult = await executeQuery<{ season: number }>(seasonsQuery);

    const seasonStats: SeasonDebugStats[] = [];

    for (const { season } of seasonsResult.rows) {
      const seasonTotalQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE season = $1`;
      const seasonInPastQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE season = $1 AND LOWER(status_short) IN (${IN_PAST.map(s => `'${s}'`).join(', ')})`;
      const seasonMissingXGQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE season = $1 AND LOWER(status_short) IN (${IN_PAST.map(s => `'${s}'`).join(', ')}) AND (xg_home IS NULL OR xg_away IS NULL)`;
      const seasonMissingMarketXGQuery = `SELECT COUNT(*) as count FROM football_fixtures WHERE season = $1 AND LOWER(status_short) IN (${IN_PAST.map(s => `'${s}'`).join(', ')}) AND (market_xg_home IS NULL OR market_xg_away IS NULL)`;

      const [seasonTotalResult, seasonInPastResult, seasonMissingXGResult, seasonMissingMarketXGResult] = await Promise.all([
        executeQuery<{ count: number }>(seasonTotalQuery, [season]),
        executeQuery<{ count: number }>(seasonInPastQuery, [season]),
        executeQuery<{ count: number }>(seasonMissingXGQuery, [season]),
        executeQuery<{ count: number }>(seasonMissingMarketXGQuery, [season])
      ]);

      seasonStats.push({
        season,
        total: parseInt(seasonTotalResult.rows[0].count.toString()),
        inPast: parseInt(seasonInPastResult.rows[0].count.toString()),
        inPastMissingXG: parseInt(seasonMissingXGResult.rows[0].count.toString()),
        inPastMissingMarketXG: parseInt(seasonMissingMarketXGResult.rows[0].count.toString())
      });
    }

    const overallStats: DebugStats = {
      total: parseInt(totalResult.rows[0].count.toString()),
      inPast: parseInt(inPastResult.rows[0].count.toString()),
      inPastMissingXG: parseInt(missingXGResult.rows[0].count.toString()),
      inPastMissingMarketXG: parseInt(missingMarketXGResult.rows[0].count.toString())
    };

    return NextResponse.json({
      success: true,
      overall: overallStats,
      bySeason: seasonStats
    });

  } catch (error) {
    console.error('Failed to fetch debug stats:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to fetch debug stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export const GET = withErrorHandler(getDebugStats);
