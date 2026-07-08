import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration007: Migration = {
  version: 7,
  description: 'Cleanup old chart_configurations table if exists',
  up: `
      -- This migration cleans up the old chart_configurations table if it exists
      -- The actual data has already been moved to the charts column in saved_reports
      DROP TABLE IF EXISTS chart_configurations;
      DROP TABLE IF EXISTS chart_configurations_backup;
    `,
  verify: (_db: MigrationDatabase) => {
    // Always return true - this migration is just cleanup
    return true;
  },
};
