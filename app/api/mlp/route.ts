import { NextResponse } from 'next/server';
import { getCachedModel, clearCachedModel } from '../../../lib/ml-cache';


export const dynamic = 'force-dynamic';

// GET - Return cached model info
export async function GET() {
  try {
    const cachedModel = await getCachedModel()
    
    if (!cachedModel) {
      return NextResponse.json({
        modelCached: false,
        message: 'No model cached'
      })
    }

    return NextResponse.json({
      modelCached: true,
      features: cachedModel.features,
      stats: cachedModel.stats
    })
  } catch (error) {
    console.error('Error fetching model info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch model info' },
      { status: 500 }
    );
  }
}

// DELETE - Clear cached model
export async function DELETE() {
  try {
    clearCachedModel()
    return NextResponse.json({
      success: true,
      message: 'Model cache cleared'
    })
  } catch (error) {
    console.error('Error clearing model:', error);
    return NextResponse.json(
      { error: 'Failed to clear model' },
      { status: 500 }
    );
  }
}
