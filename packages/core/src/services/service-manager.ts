/**
 * Service Manager for orchestrating all business services
 * Handles service initialization and provides unified access
 */

import { DatabaseAdapter } from '../database/interface.js';
import { getRow } from '../database/sql.js';
import { MigrationRunner } from '../database/migrations.js';
import { BudgetService } from './budgets/index.js';
import { CategoryService } from './categories/index.js';
import { AccountService } from './accounts/index.js';
import { TransactionService } from './transactions/index.js';
import { PayeeService } from './transactions/payee-service.js';
import { LabelService } from './transactions/label-service.js';
import { SplitService } from './transactions/split-service.js';
import { GoalService } from './goals/index.js';
import { MonthlyBudgetService } from './monthly-budgets/index.js';
import { AnalyticsService } from './analytics/index.js';
import { CurrencyService } from './currency/index.js';
import { ExportService, DatabaseExportService } from './export/index.js';
import { UnifiedReportService, DatabaseUnifiedReportService } from './reports/index.js';
import { RulesService } from './rules/index.js';
import { RecurringTransactionService } from './recurring/index.js';
import { ImportHistoryService } from './import/import-history-service.js';
import { MutationHistoryService } from './mutation-history/index.js';
import { LLMSettingsService } from './llm-settings/index.js';
import { ChatService } from './chat/index.js';
import { UserMetaService } from './user-meta/index.js';
import {
  CustomDashboardService,
  DatabaseCustomDashboardService,
} from './custom-dashboards/index.js';
import { WarrantyService } from './warranties/index.js';

import { createLogger } from '../logger.js';

interface CountResult {
  count: number;
}

/** Interface for PRAGMA foreign_keys result */
interface ForeignKeysResult {
  foreign_keys: number;
}
const debugLog = createLogger('services:service-manager');

export interface Services {
  budgets: BudgetService;
  categories: CategoryService;
  accounts: AccountService;
  transactions: TransactionService;
  payees: PayeeService;
  labels: LabelService;
  splits: SplitService;
  goals: GoalService;
  monthlyBudgets: MonthlyBudgetService;
  analytics: AnalyticsService;
  currency: CurrencyService;
  export: ExportService;
  reports: UnifiedReportService;
  rules: RulesService;
  recurring: RecurringTransactionService;
  importHistory: ImportHistoryService;
  mutationHistory: MutationHistoryService;
  llmSettings: LLMSettingsService;
  chat: ChatService;
  userMeta: UserMetaService;
  customDashboards: CustomDashboardService;
  warranties: WarrantyService;
}

export class ServiceManager {
  private db: DatabaseAdapter | null = null;

  private services: Services | null = null;

  private initialized = false;

  /**
   * Initialize the service manager with a database instance
   */
  async initialize(database: DatabaseAdapter): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.db = database;

    // Apply migrations if needed
    // Cast to MigrationDatabase since MigrationRunner expects that interface
    // which is compatible with DatabaseAdapter's methods
    const migrationRunner = new MigrationRunner(
      this.db as unknown as import('../database/migrations.js').MigrationDatabase
    );
    if (migrationRunner.needsMigration()) {
      debugLog('Database needs migrations, applying...');
      migrationRunner.runMigrations();
    } else {
      debugLog('Database is up to date');
    }

    // Clean up orphaned records before enabling foreign keys
    // This fixes constraint violations that might prevent FK enforcement
    const orphansRemoved = migrationRunner.cleanupOrphanedRecords();
    if (orphansRemoved > 0) {
      debugLog(`Cleaned up ${orphansRemoved} orphaned records on startup`);
    }

    // Optimize database: prune old data and run VACUUM to reclaim space
    const optimizeResult = migrationRunner.optimizeDatabase();
    if (optimizeResult.pruned > 0 || optimizeResult.vacuumed) {
      debugLog(
        `Database optimized: ${optimizeResult.pruned} records pruned, vacuumed: ${optimizeResult.vacuumed}`
      );
    }

    this.initializeServices();

    // Run integrity check on startup (now just verifies, doesn't clean)
    await this.runStartupIntegrityCheck();

    this.initialized = true;
  }

  private initializeServices(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.services = {
      budgets: new BudgetService(this.db),
      categories: new CategoryService(this.db),
      accounts: new AccountService(this.db),
      transactions: new TransactionService(this.db),
      payees: new PayeeService(this.db),
      labels: new LabelService(this.db),
      splits: new SplitService(this.db),
      goals: new GoalService(this.db),
      monthlyBudgets: new MonthlyBudgetService(this.db),
      analytics: new AnalyticsService(this.db),
      currency: new CurrencyService(this.db),
      export: new DatabaseExportService(this),
      reports: new DatabaseUnifiedReportService(this.db),
      rules: new RulesService(this.db),
      recurring: new RecurringTransactionService(this.db),
      importHistory: new ImportHistoryService(this.db),
      mutationHistory: new MutationHistoryService(this.db),
      llmSettings: new LLMSettingsService(this.db),
      chat: new ChatService(this.db),
      userMeta: new UserMetaService(this.db),
      customDashboards: new DatabaseCustomDashboardService(this.db),
      warranties: new WarrantyService(this.db),
    };
  }

  /**
   * Get all services
   */
  getServices(): Services {
    if (!this.services) {
      throw new Error('Services not initialized');
    }
    return this.services;
  }

  /**
   * Get raw database (for advanced operations)
   */
  getDatabase(): DatabaseAdapter {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  private async runStartupIntegrityCheck(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Force enable foreign keys
      this.db.exec('PRAGMA foreign_keys = ON');

      const fkResult = getRow<ForeignKeysResult>(this.db, 'PRAGMA foreign_keys');
      const fkEnabled = fkResult?.foreign_keys === 1;

      if (fkEnabled) {
        debugLog('✅ Foreign keys are enabled - CASCADE deletes will work properly');
      } else {
        console.warn('⚠️ Foreign keys could not be enabled - CASCADE deletes will not work');
        console.warn('This may be due to existing constraint violations in the database');
      }

      // Quick orphaned record count
      const accountsResult = getRow<CountResult>(
        this.db,
        `SELECT COUNT(*) as count
          FROM accounts a
          LEFT JOIN budgets b ON a.BudgetID = b.ID
          WHERE b.ID IS NULL`
      );

      const categoriesResult = getRow<CountResult>(
        this.db,
        `SELECT COUNT(*) as count
          FROM categories c
          LEFT JOIN budgets b ON c.BudgetID = b.ID
          WHERE b.ID IS NULL`
      );

      const transactionsResult = getRow<CountResult>(
        this.db,
        `SELECT COUNT(*) as count
          FROM transactions t
          LEFT JOIN budgets b ON t.BudgetID = b.ID
          WHERE b.ID IS NULL`
      );

      const orphanCounts = {
        accounts: accountsResult?.count ?? 0,
        categories: categoriesResult?.count ?? 0,
        transactions: transactionsResult?.count ?? 0,
      };

      const totalOrphans =
        orphanCounts.accounts + orphanCounts.categories + orphanCounts.transactions;

      if (totalOrphans > 0) {
        console.warn(`⚠️ Database integrity issue: ${totalOrphans} orphaned records found`);
        console.warn('Orphaned counts:', orphanCounts);
        console.warn('Consider running database cleanup from Settings → Data → Cleanup Orphans');
      } else {
        debugLog('✅ Database integrity check passed');
      }
    } catch (error) {
      console.warn('Could not run startup integrity check', error);
    }
  }

  /**
   * Check if services are initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset all services (for cleanup)
   */
  reset(): void {
    this.db = null;
    this.services = null;
    this.initialized = false;
  }
}
