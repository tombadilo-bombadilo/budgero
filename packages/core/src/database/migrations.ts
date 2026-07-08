import { createLogger } from '../logger.js';
import { DatabaseNewerThanAppError } from '../types/index.js';

/**
 * All database migrations
 * Each migration should be idempotent (safe to run multiple times)
 */
import { migrations } from './migrations/index.js';

/** Highest schema version this build of the app understands. */
export function getMaxSupportedSchemaVersion(): number {
  return Math.max(...migrations.map((m) => m.version));
}

const debugLog = createLogger('database:migrations');
/**
 * Database migration system for Budgero
 * Similar to goose - tracks migrations in a schema_migrations table
 */

export interface MigrationDatabase {
  exec(sql: string): MigrationExecResult[];
  prepare(sql: string): MigrationStatement;
  transaction?: <T>(fn: () => T) => () => T;
  /**
   * Optional: suspend/restore foreign-key enforcement AND any adapter-side
   * auto-re-enable logic. Table-rebuild migrations require FKs off for the
   * whole run (the documented SQLite rebuild procedure) — a plain PRAGMA is
   * not enough on adapters that periodically force FKs back on.
   */
  setForeignKeysSuspended?(suspended: boolean): void;
}

interface MigrationExecResult {
  columns: string[];
  values: unknown[][];
}

interface MigrationStatement {
  get(): { version?: number; foreign_keys?: number } | undefined;
  finalize(): void;
}

export interface Migration {
  version: number;
  description: string;
  up: string | ((db: MigrationDatabase) => void);
  verify?: (db: MigrationDatabase) => boolean;
}
export { migrations };

/**
 * Orphan-cleanup steps, in dependency order (children before parents so FK
 * chains unwind cleanly). Each step deletes rows whose `fkColumn` points at a
 * missing `parent` row. `guardTable` skips the step when that table doesn't
 * exist yet. The label-normalization UPDATEs stay bespoke (see
 * cleanupOrphanedLabelReferences).
 */
const ORPHAN_CLEANUP_STEPS: {
  table: string;
  fkColumn: string;
  parent: string;
  label: string;
  guardTable?: string;
}[] = [
  // 1. Orphaned transaction_splits (transactions don't exist)
  {
    table: 'transaction_splits',
    fkColumn: 'TransactionID',
    parent: 'transactions',
    label: 'orphaned transaction splits',
    guardTable: 'transaction_splits',
  },
  // 2. Orphaned transactions (budget or account doesn't exist)
  {
    table: 'transactions',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'transactions with missing budget',
  },
  {
    table: 'transactions',
    fkColumn: 'AccountID',
    parent: 'accounts',
    label: 'transactions with missing account',
  },
  // 3. Orphaned accounts (budget doesn't exist)
  { table: 'accounts', fkColumn: 'BudgetID', parent: 'budgets', label: 'orphaned accounts' },
  // 4. Orphaned goals (category doesn't exist)
  {
    table: 'goals',
    fkColumn: 'CategoryID',
    parent: 'categories',
    label: 'orphaned goals',
    guardTable: 'goals',
  },
  // 5. Orphaned categories (budget or category group doesn't exist)
  {
    table: 'categories',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'categories with missing budget',
  },
  {
    table: 'categories',
    fkColumn: 'CategoryGroupID',
    parent: 'category_groups',
    label: 'categories with missing category group',
    guardTable: 'category_groups',
  },
  // 6. Orphaned category_groups (budget doesn't exist)
  {
    table: 'category_groups',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned category groups',
    guardTable: 'category_groups',
  },
  // 7. Orphaned assignments
  {
    table: 'assignments',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'assignments with missing budget',
    guardTable: 'assignments',
  },
  {
    table: 'assignments',
    fkColumn: 'CategoryID',
    parent: 'categories',
    label: 'assignments with missing category',
    guardTable: 'assignments',
  },
  // 8. Orphaned payees
  {
    table: 'payees',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned payees',
    guardTable: 'payees',
  },
  // 8b. Orphaned labels (after the bespoke label-reference cleanup)
  {
    table: 'labels',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned labels',
    guardTable: 'labels',
  },
  // 9-10b. Orphaned currency rates
  {
    table: 'currency_rates',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned currency rates',
    guardTable: 'currency_rates',
  },
  {
    table: 'manual_currency_rates',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned manual currency rates',
    guardTable: 'manual_currency_rates',
  },
  {
    table: 'custom_currency_rates',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned custom currency rates',
    guardTable: 'custom_currency_rates',
  },
  // 11. Orphaned transaction_rules
  {
    table: 'transaction_rules',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned transaction rules',
    guardTable: 'transaction_rules',
  },
  // 12. Orphaned recurring_transactions
  {
    table: 'recurring_transactions',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned recurring transactions',
    guardTable: 'recurring_transactions',
  },
  {
    table: 'recurring_transactions',
    fkColumn: 'AccountID',
    parent: 'accounts',
    label: 'recurring transactions with missing account',
    guardTable: 'recurring_transactions',
  },
  // 13-17. Orphaned per-budget auxiliary tables
  {
    table: 'chat_conversations',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned chat conversations',
    guardTable: 'chat_conversations',
  },
  {
    table: 'llm_settings',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned LLM settings',
    guardTable: 'llm_settings',
  },
  {
    table: 'chat_settings',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned chat settings',
    guardTable: 'chat_settings',
  },
  {
    table: 'import_runs',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned import runs',
    guardTable: 'import_runs',
  },
  {
    table: 'mutation_history',
    fkColumn: 'BudgetID',
    parent: 'budgets',
    label: 'orphaned mutation history entries',
    guardTable: 'mutation_history',
  },
  // 18. Orphaned budget_spaces (owner budget doesn't exist)
  {
    table: 'budget_spaces',
    fkColumn: 'OwnerBudgetID',
    parent: 'budgets',
    label: 'orphaned budget spaces',
    guardTable: 'budget_spaces',
  },
];

export class MigrationRunner {
  constructor(private db: MigrationDatabase) {}

  private supportsTransactions(): boolean {
    return typeof this.db.transaction === 'function';
  }

  /**
   * Suspend/restore FK enforcement via the adapter when it cooperates (which
   * also pauses adapter-side auto-re-enable), else via a plain PRAGMA.
   */
  private setForeignKeysSuspended(suspended: boolean): void {
    try {
      if (this.db.setForeignKeysSuspended) {
        this.db.setForeignKeysSuspended(suspended);
      } else {
        this.db.exec(`PRAGMA foreign_keys = ${suspended ? 'OFF' : 'ON'}`);
      }
    } catch (error) {
      debugLog('Failed to toggle foreign-key suspension', { suspended, error });
    }
  }

  private ensureMigrationsTable(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      debugLog('Error creating schema_migrations table', { error });
      throw new Error('Failed to create migrations table');
    }
  }

  /**
   * Get current database schema version from schema_migrations table
   */
  getCurrentVersion(): number {
    this.ensureMigrationsTable();

    try {
      let result;
      if (this.supportsTransactions()) {
        const stmt = this.db.prepare(`SELECT MAX(version) as version FROM schema_migrations`);
        result = stmt.get();
        stmt.finalize();
      } else {
        const results = this.db.exec(`SELECT MAX(version) as version FROM schema_migrations`);
        result =
          results && results.length > 0 && results[0].values.length > 0
            ? { version: results[0].values[0][0] }
            : null;
      }

      const version = (result?.version as number | undefined) || 0;
      debugLog(`Current database version: ${version}`);
      return version;
    } catch (error) {
      debugLog('Error reading schema version, assuming 0', { error });
      return 0;
    }
  }

  private columnExists(table: string, column: string): boolean {
    try {
      const result = this.db.exec(`PRAGMA table_info(${table})`);
      if (!result || result.length === 0) return false;
      const columns = result[0].values.map((row: unknown[]) => row[1]);
      return columns.includes(column);
    } catch {
      return false;
    }
  }

  private tableExists(table: string): boolean {
    try {
      const result = this.db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
      );
      return result && result.length > 0;
    } catch {
      return false;
    }
  }

  private applyMigration(migration: Migration): void {
    debugLog(`Applying migration ${migration.version}: ${migration.description}`);

    try {
      // Just run the migration - the schema_migrations table tracks what's been applied
      if (typeof migration.up === 'function') {
        migration.up(this.db);
      } else {
        this.db.exec(migration.up);
      }

      this.db.exec(
        `INSERT OR REPLACE INTO schema_migrations (version) VALUES (${migration.version})`
      );

      if (migration.verify) {
        if (!migration.verify(this.db)) {
          throw new Error(`Migration ${migration.version} verification failed`);
        }
        debugLog(`Migration ${migration.version} verified successfully`);
      } else {
        debugLog(`Migration ${migration.version} applied successfully`);
      }
      this.logExistingTables(`after migration ${migration.version}`);
    } catch (error: unknown) {
      // If it's a duplicate column error, the migration was already applied somehow
      // This shouldn't happen if schema_migrations is working correctly
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.includes('duplicate column')) {
        debugLog(
          `Migration ${migration.version} encountered duplicate column - marking as complete`
        );
        this.db.exec(
          `INSERT OR REPLACE INTO schema_migrations (version) VALUES (${migration.version})`
        );
      } else {
        debugLog(`Migration ${migration.version} failed`, { error });
        throw error;
      }
    }
  }

  private logExistingTables(context: string): void {
    try {
      const rows = this.db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
      const tables =
        rows && rows[0] && rows[0].values ? rows[0].values.map((row: unknown[]) => row[0]) : [];
      debugLog(`[MigrationRunner] Tables ${context}:`, tables);
    } catch (error) {
      console.warn(`[MigrationRunner] Failed to list tables ${context}`, error);
    }
  }

  private enableForeignKeys(): void {
    try {
      this.db.exec('PRAGMA foreign_keys = ON');

      let fkEnabled = false;
      if (this.supportsTransactions()) {
        const stmt = this.db.prepare('PRAGMA foreign_keys');
        const result = stmt.get();
        stmt.finalize();
        fkEnabled = result?.foreign_keys === 1;
      } else {
        const results = this.db.exec('PRAGMA foreign_keys');
        fkEnabled = results && results.length > 0 && results[0].values[0][0] === 1;
      }

      if (fkEnabled) {
        debugLog('✅ Foreign keys are enabled - CASCADE deletes will work properly');
      } else {
        debugLog('❌ CRITICAL: Could not enable foreign keys - CASCADE deletes will NOT work!');
        debugLog('This will lead to orphaned data that should be automatically deleted.');
        debugLog('Database may have constraint violations preventing foreign key enforcement.');
      }
    } catch (error) {
      debugLog('Error enabling foreign keys', { error });
    }
  }

  /**
   * Clean up orphaned records that should have been deleted by CASCADE.
   * This is called on startup before enabling foreign keys to fix any
   * constraint violations that might prevent FK enforcement.
   * Returns the total number of orphaned records cleaned.
   */
  cleanupOrphanedRecords(): number {
    debugLog('🧹 Starting orphaned records cleanup...');
    let totalCleaned = 0;

    try {
      const tablesExist =
        this.tableExists('budgets') &&
        this.tableExists('accounts') &&
        this.tableExists('categories');

      if (!tablesExist) {
        debugLog('Core tables do not exist yet, skipping orphan cleanup');
        return 0;
      }

      this.db.exec('BEGIN TRANSACTION');

      for (const step of ORPHAN_CLEANUP_STEPS) {
        // The bespoke label-reference UPDATEs must run before orphaned labels
        // are deleted, so dangling transaction references get cleared first.
        if (step.table === 'labels') {
          totalCleaned += this.cleanupOrphanedLabelReferences();
        }

        if (step.guardTable && !this.tableExists(step.guardTable)) continue;

        const cleaned = this.execWithChanges(`
          DELETE FROM ${step.table}
          WHERE ${step.fkColumn} NOT IN (SELECT ID FROM ${step.parent})
        `);
        if (cleaned > 0) {
          debugLog(`  Deleted ${cleaned} ${step.label}`);
          totalCleaned += cleaned;
        }
      }

      this.db.exec('COMMIT');

      if (totalCleaned > 0) {
        debugLog(`🧹 Orphan cleanup complete: ${totalCleaned} records removed`);
      } else {
        debugLog('✅ No orphaned records found');
      }

      return totalCleaned;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      debugLog('❌ Orphan cleanup failed', { error });
      return 0;
    }
  }

  /**
   * Bespoke label cleanup (step 8b): clear transaction label references that
   * point at missing labels or labels belonging to another budget. Runs just
   * before the orphaned-labels delete step.
   */
  private cleanupOrphanedLabelReferences(): number {
    if (
      !this.tableExists('labels') ||
      !this.tableExists('transactions') ||
      !this.columnExists('transactions', 'LabelID')
    ) {
      return 0;
    }

    let cleaned = 0;

    const invalidTransactionLabels = this.execWithChanges(`
      UPDATE transactions
      SET LabelID = NULL
      WHERE LabelID IS NOT NULL
        AND LabelID NOT IN (SELECT ID FROM labels)
    `);
    if (invalidTransactionLabels > 0) {
      debugLog(
        `  Cleared ${invalidTransactionLabels} transaction labels referencing missing labels`
      );
      cleaned += invalidTransactionLabels;
    }

    const crossBudgetLabels = this.execWithChanges(`
      UPDATE transactions
      SET LabelID = NULL
      WHERE LabelID IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM labels l
          WHERE l.ID = transactions.LabelID
            AND l.BudgetID = transactions.BudgetID
        )
    `);
    if (crossBudgetLabels > 0) {
      debugLog(`  Cleared ${crossBudgetLabels} transaction labels assigned from another budget`);
      cleaned += crossBudgetLabels;
    }

    return cleaned;
  }

  private execWithChanges(sql: string): number {
    try {
      this.db.exec(sql);
      // For sql.js, we need to get changes differently
      const changesResult = this.db.exec('SELECT changes()');
      if (changesResult && changesResult.length > 0 && changesResult[0].values.length > 0) {
        return changesResult[0].values[0][0] as number;
      }
      return 0;
    } catch (error) {
      debugLog('Error executing cleanup query', { sql, error });
      return 0;
    }
  }

  /**
   * Optimize the database for size and performance.
   * This includes:
   * - Pruning old chat messages (older than 90 days)
   * - Pruning old import runs (keep last 50 per budget)
   * - Running VACUUM to reclaim disk space
   * - Running ANALYZE to update query optimizer statistics
   *
   * Returns stats about what was optimized.
   */
  optimizeDatabase(): { pruned: number; vacuumed: boolean; analyzed: boolean } {
    debugLog('🔧 Starting database optimization...');
    let totalPruned = 0;
    let vacuumed = false;
    let analyzed = false;

    try {
      // 1. Prune old chat messages (keep last 90 days)
      if (this.tableExists('chat_messages')) {
        const oldMessages = this.execWithChanges(`
          DELETE FROM chat_messages
          WHERE CreatedAt < datetime('now', '-90 days')
        `);
        if (oldMessages > 0) {
          debugLog(`  Pruned ${oldMessages} chat messages older than 90 days`);
          totalPruned += oldMessages;
        }
      }

      // 2. Prune old/archived chat conversations with no recent messages
      if (this.tableExists('chat_conversations')) {
        const oldConversations = this.execWithChanges(`
          DELETE FROM chat_conversations
          WHERE ArchivedAt IS NOT NULL
            AND ArchivedAt < datetime('now', '-30 days')
        `);
        if (oldConversations > 0) {
          debugLog(`  Pruned ${oldConversations} archived conversations older than 30 days`);
          totalPruned += oldConversations;
        }
      }

      // 3. Prune old import runs (keep last 50 per budget)
      if (this.tableExists('import_runs')) {
        const oldImports = this.execWithChanges(`
          DELETE FROM import_runs
          WHERE ID NOT IN (
            SELECT ID FROM (
              SELECT ID, BudgetID,
                ROW_NUMBER() OVER (PARTITION BY BudgetID ORDER BY CreatedAt DESC) as rn
              FROM import_runs
            ) WHERE rn <= 50
          )
        `);
        if (oldImports > 0) {
          debugLog(`  Pruned ${oldImports} old import run records`);
          totalPruned += oldImports;
        }
      }

      // 4. Prune old transaction rule runs (keep last 100 per rule)
      if (this.tableExists('transaction_rule_runs')) {
        const oldRuleRuns = this.execWithChanges(`
          DELETE FROM transaction_rule_runs
          WHERE ID NOT IN (
            SELECT ID FROM (
              SELECT ID, RuleID,
                ROW_NUMBER() OVER (PARTITION BY RuleID ORDER BY StartedAt DESC) as rn
              FROM transaction_rule_runs
            ) WHERE rn <= 100
          )
        `);
        if (oldRuleRuns > 0) {
          debugLog(`  Pruned ${oldRuleRuns} old transaction rule run records`);
          totalPruned += oldRuleRuns;
        }
      }

      // 5. Run ANALYZE to update query optimizer statistics
      try {
        this.db.exec('ANALYZE');
        analyzed = true;
        debugLog('  ✅ ANALYZE completed');
      } catch (error) {
        debugLog('  ⚠️ ANALYZE failed', { error });
      }

      // 6. Try VACUUM to reclaim space (works on native SQLite, not always on sql.js/WASM)
      // For sql.js, the real compaction happens via export/import cycle which is handled
      // by the adapter when persisting to OPFS/userData
      try {
        this.db.exec('VACUUM');
        vacuumed = true;
        debugLog('  ✅ VACUUM completed');
      } catch {
        // VACUUM often fails in sql.js - that's OK, export() creates a compacted copy anyway
        vacuumed = false;
      }

      if (totalPruned > 0 || vacuumed) {
        debugLog(
          `🔧 Optimization complete: ${totalPruned} records pruned, VACUUM: ${vacuumed}, ANALYZE: ${analyzed}`
        );
      } else {
        debugLog('✅ Database already optimized');
      }

      return { pruned: totalPruned, vacuumed, analyzed };
    } catch (error) {
      debugLog('❌ Database optimization failed', { error });
      return { pruned: totalPruned, vacuumed, analyzed };
    }
  }

  /**
   * Run all pending migrations
   */
  runMigrations(): void {
    // Enable foreign keys before any operations
    this.enableForeignKeys();

    const currentVersion = this.getCurrentVersion();
    if (currentVersion > getMaxSupportedSchemaVersion()) {
      // A DB from a newer app version (restored blob, imported backup).
      // Operating on a schema this code doesn't know would corrupt it — the
      // pre-039 runner silently no-opped here, which is how format skew
      // corrupted data. Hard stop; the app surfaces an update prompt.
      throw new DatabaseNewerThanAppError(currentVersion, getMaxSupportedSchemaVersion());
    }
    const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
      debugLog(`Database is up to date (version ${currentVersion})`);
      return;
    }

    debugLog(`Running ${pendingMigrations.length} migrations from version ${currentVersion}`);

    // Foreign keys must be OFF for the whole migration run: table-rebuild
    // migrations (039) drop parent tables, which under enforcement would
    // cascade-delete their children. The toggle has to happen out here —
    // inside the transaction below, PRAGMA foreign_keys is a silent no-op.
    this.setForeignKeysSuspended(true);
    try {
      if (this.supportsTransactions() && this.db.transaction) {
        const transaction = this.db.transaction(() => {
          for (const migration of pendingMigrations) {
            this.applyMigration(migration);
          }
        });

        try {
          transaction();
        } catch (error) {
          debugLog('Migration transaction failed', { error });
          throw error;
        }
      } else {
        // Manual transaction for sql.js
        try {
          this.db.exec('BEGIN TRANSACTION');
          for (const migration of pendingMigrations) {
            this.applyMigration(migration);
          }
          this.db.exec('COMMIT');
        } catch (error) {
          debugLog('Migration failed, rolling back', { error });
          this.db.exec('ROLLBACK');
          throw error;
        }
      }
    } finally {
      this.setForeignKeysSuspended(false);
    }

    const newVersion = this.getCurrentVersion();
    const expectedVersion = Math.max(...migrations.map((m) => m.version));

    if (newVersion === expectedVersion) {
      debugLog(`✅ Database successfully updated to version ${newVersion}`);
    } else {
      debugLog(`⚠️ Database at version ${newVersion}, expected ${expectedVersion}`);
    }

    // Ensure foreign keys are enabled after migrations complete
    this.enableForeignKeys();
  }

  /**
   * Check if database needs migrations
   */
  needsMigration(): boolean {
    const currentVersion = this.getCurrentVersion();
    const latestVersion = Math.max(...migrations.map((m) => m.version));
    const needsMigration = currentVersion < latestVersion;

    if (needsMigration) {
      debugLog(`Database needs migration from version ${currentVersion} to ${latestVersion}`);
    }

    return needsMigration;
  }
}
