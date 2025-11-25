/**
 * Helper for consistent logging with timestamp and service prefix
 */
function log(message: string): void {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS format
  console.log(`${time} ServerInit: ${message}`);
}

export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeSchedulers } = await import('@/lib/scheduler/init-scheduler');

    // Initialize the scheduler on server startup
    log('Initializing schedulers on server startup...');
    initializeSchedulers();
  }
}

