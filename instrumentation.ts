export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeSchedulers } = await import('@/lib/scheduler/init-scheduler');
    
    // Initialize the scheduler on server startup
    console.log('Initializing schedulers on server startup...');
    initializeSchedulers();
  }
}

