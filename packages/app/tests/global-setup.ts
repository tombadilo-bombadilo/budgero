import { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig) {
  console.log('🚀 Global setup: Starting test environment...');

  // Example: Set up test data, create test users, etc.
  // You can add any global setup logic here

  console.log('✅ Global setup completed');
}

export default globalSetup;
