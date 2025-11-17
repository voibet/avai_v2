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

    // Start Pinnacle odds fetching if enabled
    if (process.env.PINNACLE === 'true') {
      log('Starting Pinnacle odds continuous fetching...');
      try {
        const { pinnacleOddsService } = await import('@/lib/services/odds/pinnacle-odds-service');
        await pinnacleOddsService.startContinuousFetching();
        log('Pinnacle odds continuous fetching started successfully');
      } catch (error) {
        console.error('Failed to start Pinnacle odds fetching:', error);
      }
    } else {
      log('Pinnacle odds fetching disabled');
    }

    // Start Monaco odds fetching if enabled
    if (process.env.MONACO === 'true') {
      log('Starting Monaco odds continuous fetching...');
      try {
        const { MonacoOddsService } = await import('@/lib/services/odds/monaco-odds-service');
        const monacoOddsService = new MonacoOddsService();
        await monacoOddsService.startContinuousFetching();
        log('Monaco odds continuous fetching started successfully');
      } catch (error) {
        console.error('Failed to start Monaco odds fetching:', error);
      }
    } else {
      log('Monaco odds fetching disabled');
    }
  }
}

