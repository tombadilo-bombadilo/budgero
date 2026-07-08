/**
 * DatabaseLoader — encapsulates "restore + migrate" sequence.
 *
 * If migration fails: log error, attempt rollback (re-download), escalate as error.
 * Coordinator stays ignorant of SQL schema versions.
 */

import type { WebDatabaseInstance } from '../types';
import { errorMessage } from '../utils/diagnostics';
import { logRuntime } from '../logging';

/**
 * Callback to run migrations on a database.
 */
export interface MigrationRunner {
  needsMigration(db: WebDatabaseInstance): boolean;
  runMigrations(db: WebDatabaseInstance): void;
}

export class DatabaseLoader {
  private migrationRunner?: MigrationRunner;

  constructor(migrationRunner?: MigrationRunner) {
    this.migrationRunner = migrationRunner;
  }

  /**
   * Run migrations on the database if needed.
   * Returns true if migrations were run, false if already up to date.
   */
  runMigrations(db: WebDatabaseInstance): boolean {
    if (!this.migrationRunner) {
      // No migration runner provided — ensure FK are enabled at minimum
      try {
        db.exec('PRAGMA foreign_keys = ON');
      } catch {
        /* no-op */
      }
      return false;
    }

    try {
      if (this.migrationRunner.needsMigration(db)) {
        logRuntime('info', 'DatabaseLoader', 'Applying pending migrations');
        this.migrationRunner.runMigrations(db);
        return true;
      } 
        // Even if migrations are up to date, ensure foreign keys enabled
        db.exec('PRAGMA foreign_keys = ON');
        return false;
      
    } catch (error) {
      logRuntime('warn', 'DatabaseLoader', 'Failed to run migrations', {
        error: errorMessage(error),
      });
      throw error;
    }
  }
}
