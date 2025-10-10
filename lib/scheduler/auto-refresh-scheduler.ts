import { executeAutoRefresh, isAutoRefreshRunning } from '@/app/api/admin/auto-refresh/route';

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
  schedulerInterval = setInterval(runAutoRefresh,  6 * 60 * 60 * 1000);
}

export function stopAutoRefreshScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

async function runAutoRefresh() {
  try {
    await executeAutoRefresh();
  } catch (error) {
    console.error('Auto-refresh error:', error);
  }
}

export function getSchedulerStatus() {
  return {
    isActive: schedulerInterval !== null,
    isRunning: isAutoRefreshRunning(),
    nextRun: schedulerInterval ? new Date(Date.now() + 6 * 60 * 60 * 1000) : null
  };
}