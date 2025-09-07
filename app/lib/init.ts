import { PrismaClient } from '@prisma/client';
import { initializeCronJob } from '~/services/cron';

/**
 * Initialize application services
 */
let initialized = false;
const prisma = new PrismaClient();

export function initializeApp() {
  if (initialized) {
    return;
  }
  
  console.log('Initializing Priority Handling app...');
  
  // Initialize cron job for nightly billing
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') {
    initializeCronJob(prisma);
    console.log('Cron job initialized');
  } else {
    console.log('Cron job disabled in development mode');
  }
  
  initialized = true;
  console.log('Priority Handling app initialized');
}

// Auto-initialize when this module is imported
if (typeof window === 'undefined') {
  // Only run on server side
  initializeApp();
}

