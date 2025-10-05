import { NextResponse } from 'next/server';
import { calculateMarketXG } from '../../../../../calculators/market-xg.js';


export const dynamic = 'force-dynamic';

/**
 * POST - Calculate market XG for specific fixture IDs
 * URL format: /api/admin/market-xg/123,456,789
 * Supports comma-separated fixture IDs
 */
export async function POST(
  request: Request,
  { params }: { params: { ids: string[] } }
) {
  try {
    // Parse fixture IDs from URL path
    const idsParam = params.ids.join('/');
    const fixtureIds: number[] = idsParam.split(',').map(id => {
      const parsed = parseInt(id.trim());
      return isNaN(parsed) ? null : parsed;
    }).filter((id): id is number => id !== null);

    if (fixtureIds.length === 0) {
      return NextResponse.json({
        error: 'Invalid fixture IDs provided. Use comma-separated numbers.',
      }, { status: 400 })
    }

    console.log(`🧮 Starting market XG calculation for ${fixtureIds.length} fixture(s): ${fixtureIds.join(', ')}`);

    // Calculate market XG for the specified fixtures
    const calculated = await calculateMarketXG(fixtureIds);

    console.log(`✅ Market XG calculation completed: ${calculated} fixtures processed`);

    return NextResponse.json({
      success: true,
      message: `Market XG calculated successfully for ${fixtureIds.length} fixture(s)`,
      fixtureIds,
      fixturesProcessed: calculated
    })

  } catch (error) {
    console.error('❌ Error in market XG calculation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Market XG calculation failed' },
      { status: 500 }
    );
  }
}
