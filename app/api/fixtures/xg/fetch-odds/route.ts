import { XGFetcher } from '@/lib/services/xg-fetcher';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId } = body;

    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'eventId is required' },
        { status: 400 }
      );
    }

    const numericEventId = parseInt(eventId);
    if (isNaN(numericEventId)) {
      return NextResponse.json(
        { success: false, message: 'eventId must be a number' },
        { status: 400 }
      );
    }

    const xgFetcher = new XGFetcher();
    const oddsData = await xgFetcher.fetchSofascoreOddsByEventId(numericEventId);

    console.log(`API: Fetched odds data for event ${numericEventId}:`, oddsData);

    if (oddsData) {
      return NextResponse.json({
        success: true,
        message: 'Odds data fetched successfully',
        oddsData
      });
    } else {
      return NextResponse.json(
        { success: false, message: 'No odds data found for the provided event ID' },
        { status: 404 }
      );
    }

  } catch (error) {
    console.error('Error fetching odds by event ID:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    );
  }
}
