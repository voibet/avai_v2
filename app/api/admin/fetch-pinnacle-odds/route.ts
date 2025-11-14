import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../../lib/database/db-utils';
import { pinnacleOddsService } from '../../../../lib/services/pinnacle-odds-service';

async function startContinuousOdds() {
  try {
    console.log('Starting continuous Pinnacle odds fetching...');

    // Check if already running
    if (pinnacleOddsService.isContinuousFetchingRunning()) {
      return NextResponse.json({
        success: false,
        error: 'Continuous fetching is already running'
      });
    }

    // Start continuous fetching (this will run indefinitely)
    await pinnacleOddsService.startContinuousFetching();

    return NextResponse.json({
      success: true,
      message: 'Continuous Pinnacle odds fetching started'
    });
  } catch (error) {
    console.error('❌ Error starting continuous odds fetching:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to start continuous odds fetching',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function stopContinuousOdds() {
  try {
    console.log('Stopping continuous Pinnacle odds fetching...');

    // Check if running
    if (!pinnacleOddsService.isContinuousFetchingRunning()) {
      return NextResponse.json({
        success: false,
        error: 'Continuous fetching is not running'
      });
    }

    // Stop continuous fetching
    pinnacleOddsService.stopContinuousFetching();

    return NextResponse.json({
      success: true,
      message: 'Continuous Pinnacle odds fetching stopped'
    });
  } catch (error) {
    console.error('❌ Error stopping continuous odds fetching:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to stop continuous odds fetching',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export const POST = withErrorHandler(startContinuousOdds);
export const DELETE = withErrorHandler(stopContinuousOdds);
