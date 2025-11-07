import { XGFetcher } from '@/lib/services/xg-fetcher';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, eventId, fixtureId } = body;

    if (!source) {
      return NextResponse.json(
        { success: false, message: 'Source is required' },
        { status: 400 }
      );
    }

    // For native source, we need fixtureId instead of eventId
    if (source === 'native' && !fixtureId) {
      return NextResponse.json(
        { success: false, message: 'fixtureId is required for native source' },
        { status: 400 }
      );
    }

    // For flashlive and sofascore sources, we need eventId
    if (['flashlive', 'sofascore'].includes(source) && !eventId) {
      return NextResponse.json(
        { success: false, message: 'eventId is required for flashlive and sofascore sources' },
        { status: 400 }
      );
    }

    if (!['flashlive', 'sofascore', 'native'].includes(source)) {
      return NextResponse.json(
        { success: false, message: 'Source must be either "flashlive", "sofascore", or "native"' },
        { status: 400 }
      );
    }

    const xgFetcher = new XGFetcher();
    let xgData = null;

    if (source === 'flashlive') {
      xgData = await xgFetcher.fetchFlashliveXGByEventId(eventId);
    } else if (source === 'sofascore') {
      const numericEventId = parseInt(eventId);
      if (isNaN(numericEventId)) {
        return NextResponse.json(
          { success: false, message: 'Sofascore eventId must be a number' },
          { status: 400 }
        );
      }
      xgData = await xgFetcher.fetchSofascoreXGByEventId(numericEventId);
    } else if (source === 'native') {
      const numericFixtureId = parseInt(fixtureId);
      if (isNaN(numericFixtureId)) {
        return NextResponse.json(
          { success: false, message: 'fixtureId must be a number' },
          { status: 400 }
        );
      }
      xgData = await xgFetcher.fetchNativeXGByFixtureId(numericFixtureId);
    }

    if (xgData) {
      return NextResponse.json({
        success: true,
        message: 'XG data fetched successfully',
        xgData
      });
    } else {
      return NextResponse.json(
        { success: false, message: 'No XG data found for the provided event ID' },
        { status: 404 }
      );
    }

  } catch (error) {
    console.error('Error fetching XG by event ID:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    );
  }
}
