export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeSchedulers } = await import('@/lib/scheduler/init-scheduler');

    // Initialize the scheduler on server startup
    console.log('Initializing schedulers on server startup...');
    initializeSchedulers();

    // Start Pinnacle odds fetching if enabled
    if (process.env.PINNACLE === 'true') {
      console.log('Starting Pinnacle odds continuous fetching...');
      try {
        const { pinnacleOddsService } = await import('@/lib/services/pinnacle-odds-service');
        await pinnacleOddsService.startContinuousFetching();
        console.log('Pinnacle odds continuous fetching started successfully');
      } catch (error) {
        console.error('Failed to start Pinnacle odds fetching:', error);
      }
    } else {
      console.log('Pinnacle odds fetching disabled');
    }
  }
}

