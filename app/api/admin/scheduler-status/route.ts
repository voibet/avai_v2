import { getSchedulerStatus } from '@/lib/scheduler/auto-refresh-scheduler';


export async function GET() {
  try {
    const status = getSchedulerStatus();

    return new Response(JSON.stringify({
      success: true,
      scheduler: status,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : 'An error occurred'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}