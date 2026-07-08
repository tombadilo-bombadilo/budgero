import { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig) {
  console.log('🧹 Global teardown: Cleaning up test environment...');

  // Example cleanup tasks:
  // - Clean up test data
  // - Reset database state
  // - Delete temporary files
  // - Close any open connections

  console.log('✅ Global teardown completed');
}

export default globalTeardown;
