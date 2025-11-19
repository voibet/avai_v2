import { startAutoRefreshScheduler } from './auto-refresh-scheduler';

// ====== SCHEDULER CONTROL ======
// Set to false to disable automatic scheduler
const ENABLE_SCHEDULER = true;
// ===============================

// Global singleton flag to prevent multiple initializations
const SCHEDULER_KEY = '__SCHEDULER_INITIALIZED__';

export function initializeSchedulers() {
  if (typeof window !== 'undefined') return;

  // Check if scheduler is disabled
  if (!ENABLE_SCHEDULER) {
    return;
  }

  // Check global flag
  if ((global as any)[SCHEDULER_KEY]) {
    return;
  }

  // Set global flag
  (global as any)[SCHEDULER_KEY] = true;

  // Start scheduler after delay
  setTimeout(() => {
    startAutoRefreshScheduler();
  }, 1 * 60 * 1000); // 1 minutes in milliseconds
}
