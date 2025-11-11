import { NextRequest, NextResponse } from 'next/server';
import { cleanupPastFixturesOdds } from '@/calculators/cleanup-odds';
import { withErrorHandler } from '@/lib/database/db-utils';

export const POST = withErrorHandler(async (request: NextRequest) => {
  console.log('Starting odds cleanup for past fixtures...');

  const result = await cleanupPastFixturesOdds();

  return NextResponse.json({
    success: true,
    message: `Cleanup completed. Processed ${result.processedFixtures} fixtures, cleaned ${result.cleanedRecords} odds records.`,
    data: result
  });
});
