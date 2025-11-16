import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../../lib/database/db-utils';
import { MonacoOddsService } from '../../../../lib/services/monaco-odds-service';

const monacoOddsService = new MonacoOddsService();

async function startContinuousOdds() {
  try {
    console.log('Starting continuous Monaco odds fetching...');

    // Check if already running (simplified check)
    if (monacoOddsService['isRunning']) {
      return NextResponse.json({
        success: false,
        error: 'Continuous fetching is already running'
      });
    }

    // Start continuous fetching (this will run indefinitely)
    await monacoOddsService.startContinuousFetching();

    return NextResponse.json({
      success: true,
      message: 'Continuous Monaco odds fetching started'
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
    console.log('Stopping continuous Monaco odds fetching...');

    // Check if running
    if (!monacoOddsService['isRunning']) {
      return NextResponse.json({
        success: false,
        error: 'Continuous fetching is not running'
      });
    }

    // Stop continuous fetching
    monacoOddsService.stopContinuousFetching();

    return NextResponse.json({
      success: true,
      message: 'Continuous Monaco odds fetching stopped'
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
