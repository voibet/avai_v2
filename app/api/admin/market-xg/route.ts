import { NextResponse } from 'next/server';
import { calculateMarketXG } from '../../../../calculators/market-xg.js';


export const dynamic = 'force-dynamic';

/**
 * POST - Calculate market XG for all finished fixtures
 * URL format: /api/admin/market-xg
 */
export async function POST() {
  try {
    console.log('🧮 Starting market XG calculation for all finished fixtures');

    // Calculate market XG for all fixtures (null parameter)
    const calculated = await calculateMarketXG(null);

    console.log(`✅ Market XG calculation completed: ${calculated} fixtures processed`);

    return NextResponse.json({
      success: true,
      message: `Market XG calculated successfully for all finished fixtures`,
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
