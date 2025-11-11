import { executeAutoRefresh } from '@/lib/services/auto-refresh-service';

// Global singleton to prevent multiple schedulers
const SCHEDULER_INSTANCE_KEY = '__SCHEDULER_INSTANCE__';

let schedulerInterval: NodeJS.Timeout | null = null;

export function startAutoRefreshScheduler() {
  // Check if CHAIN environment variable is set to true
  if (process.env.CHAIN !== 'true') {
    console.log('CHAIN environment variable not set to true, skipping auto-refresh scheduler');
    return;
  }

  // Check if scheduler already exists globally
  if ((global as any)[SCHEDULER_INSTANCE_KEY]) {
    console.log('Scheduler already running globally');
    return;
  }

  console.log('Starting auto-refresh scheduler');
  
  // Mark as started globally
  (global as any)[SCHEDULER_INSTANCE_KEY] = true;
  
  runAutoRefresh();
  schedulerInterval = setInterval(runAutoRefresh, 5 * 60 * 1000); // 5 minutes in milliseconds
}


async function runAutoRefresh() {
  try {
    await executeAutoRefresh();
  } catch (error) {
    console.error('Auto-refresh error:', error);
  }
}
