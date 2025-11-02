import { executeAutoRefresh, isAutoRefreshRunning } from '@/lib/services/auto-refresh-service';

// Global singleton to prevent multiple schedulers
const SCHEDULER_INSTANCE_KEY = '__SCHEDULER_INSTANCE__';

let schedulerInterval: NodeJS.Timeout | null = null;

export function startAutoRefreshScheduler() {
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
