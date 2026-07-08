import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeSqlJsAdapter, YNABImportService, BudgetService } from '../src';

// @ts-expect-error ESM import.meta.url is not recognized by TypeScript in CommonJS context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('YNABImportService', () => {
  let adapter: NodeSqlJsAdapter;
  let budgetsServices: BudgetService;
  let importedBudgetId: number;

  beforeAll(async () => {
    // Initialize in-memory database
    adapter = await NodeSqlJsAdapter.create();

    // Initialize services - YNABImportService takes the adapter directly
    const ynabImportService = new YNABImportService(adapter);
    budgetsServices = new BudgetService(adapter);

    // Read the test YNAB export file
    const testFilePath = join(__dirname, 'test-data', 'test_ynab_export.zip');
    const fileBuffer = readFileSync(testFilePath);

    // Import the YNAB data with config - ONLY ONCE
    importedBudgetId = await ynabImportService.importYNABFromZip(fileBuffer, {
      budgetName: 'Test YNAB Import',
      currency: 'USD',
      numberFormat: '$1,097',
      badgeIcon: 'HelpCircle',
    });
  });

  it('should create a budget with correct name', () => {
    const allBudgets = budgetsServices.getAllBudgets();
    const importedBudget = allBudgets.find((b) => b.ID === importedBudgetId);

    expect(importedBudget).toBeDefined();
    expect(importedBudget?.Name).toBe('Test YNAB Import');
    expect(importedBudget?.DisplayCurrency).toBe('USD');
  });

  it('should have total assignments of 36866410 milliunits', () => {
    const stmt = adapter.prepare(`
      SELECT COALESCE(SUM(Amount), 0) as total
      FROM assignments
      WHERE BudgetId = ?
    `);
    const result = stmt.get(importedBudgetId) as { total: number };
    stmt.finalize();

    expect(result.total).toBe(36866410); // 36,866.41 in milliunits
  });

  it('should have imported category groups', () => {
    const stmt = adapter.prepare(`
      SELECT COUNT(*) as count 
      FROM category_groups 
      WHERE BudgetId = ?
    `);
    const result = stmt.get(importedBudgetId) as { count: number };
    stmt.finalize();

    // 11 from the budget and 3  for SYSTEM CATEGORIES
    expect(result.count).toBe(14);
  });

  it('should have imported categories', () => {
    const stmt = adapter.prepare(`
      SELECT COUNT(*) as count 
      FROM categories 
      WHERE BudgetId = ?
    `);
    const result = stmt.get(importedBudgetId) as { count: number };
    stmt.finalize();
    // 42 from the budget and 3 for SYSTEM CATEGORIES
    expect(result.count).toBe(45);
  });

  it('should have imported transactions', () => {
    const stmt = adapter.prepare(`
      SELECT COUNT(*) as count 
      FROM transactions 
      WHERE BudgetId = ?
    `);
    const result = stmt.get(importedBudgetId) as { count: number };
    stmt.finalize();

    expect(result.count).toBe(787);
  });

  it('should populate payees for register transactions', () => {
    const stmt = adapter.prepare(`
      SELECT DISTINCT Payee 
      FROM transactions 
      WHERE BudgetId = ? AND Payee IS NOT NULL AND TRIM(Payee) <> ''
    `);
    const rows = stmt.all(importedBudgetId) as { Payee: string }[];
    stmt.finalize();

    const payees = rows.map((row) => row.Payee);
    expect(payees.length).toBeGreaterThan(0);
    expect(payees).toContain('Budgero'); // starting balances fallback
  });

  it('should import payees for register entries', () => {
    const countStmt = adapter.prepare(`
      SELECT COUNT(*) as count
      FROM transactions
      WHERE BudgetId = ?
        AND Payee IS NOT NULL
        AND TRIM(Payee) <> ''
    `);
    const countResult = countStmt.get(importedBudgetId) as { count: number };
    countStmt.finalize();

    expect(countResult.count).toBeGreaterThan(0);

    const sampleStmt = adapter.prepare(`
      SELECT Payee
      FROM transactions
      WHERE BudgetId = ?
        AND Payee IS NOT NULL
        AND TRIM(Payee) <> ''
      ORDER BY Date ASC, ID ASC
      LIMIT 1
    `);
    const sample = sampleStmt.get(importedBudgetId) as { Payee: string } | undefined;
    sampleStmt.finalize();

    expect(sample?.Payee).toBeTypeOf('string');
    expect(sample?.Payee?.trim().length).toBeGreaterThan(0);
  });

  it('should have imported accounts', () => {
    const stmt = adapter.prepare(`
      SELECT COUNT(*) as count
      FROM accounts
      WHERE BudgetId = ?
    `);
    const result = stmt.get(importedBudgetId) as { count: number };
    stmt.finalize();

    expect(result.count).toBe(5);
  });

  it('should categorize "Inflow: Ready to Assign" rows as Income (regression)', () => {
    // Starting balances, wages, reconciliation adjustments — anything YNAB
    // files under "Inflow: Ready to Assign" — must import into the Income
    // category. They regressed to Uncategorized when system categories
    // started existing on every new budget: createCategoryStructure's
    // only-if-group-missing branch stopped populating categories['Income'].
    const stmt = adapter.prepare(`
      SELECT c.Name as categoryName, COUNT(*) as count
      FROM transactions t
      JOIN categories c ON t.CategoryID = c.ID
      WHERE t.BudgetId = ?
        AND (t.Memo = 'Starting Balance' OR t.Memo = 'Wage' OR t.Memo = 'Balance Adjustment'
             OR t.Memo = 'Savings Income')
      GROUP BY c.Name
    `);
    const rows = stmt.all(importedBudgetId) as { categoryName: string; count: number }[];
    stmt.finalize();

    expect(rows).toEqual([{ categoryName: 'Income', count: expect.any(Number) }]);
    expect(rows[0].count).toBeGreaterThan(0);
  });
});

type SharedImportTestCase = {
  title: string;
  zipFile: string;
  numberFormat: string;
  currency: string;
  budgetName: string;
};

// Money totals are integer milliunits (1/1000 currency unit).
const SHARED_EXPECTATIONS = {
  assignmentsTotal: 6682116000,
  categoryGroups: 13,
  categories: 49,
  transactions: 1008,
  accounts: 7,
  septemberInflow: 458161550,
  septemberOutflow: 604032530,
} as const;

const sharedImportCases: SharedImportTestCase[] = [
  {
    title: 'TSV export',
    zipFile: 'ynab_export_tsv.zip',
    numberFormat: '123.456,78',
    currency: 'RSD',
    budgetName: 'TSV YNAB Import',
  },
];

for (const testCase of sharedImportCases) {
  describe(`YNABImportService ${testCase.title}`, () => {
    let adapter: NodeSqlJsAdapter;
    let budgetsService: BudgetService;
    let importedBudgetId: number;

    beforeAll(async () => {
      adapter = await NodeSqlJsAdapter.create();
      const ynabImportService = new YNABImportService(adapter);
      budgetsService = new BudgetService(adapter);

      const testFilePath = join(__dirname, 'test-data', testCase.zipFile);
      const fileBuffer = readFileSync(testFilePath);

      importedBudgetId = await ynabImportService.importYNABFromZip(fileBuffer, {
        budgetName: testCase.budgetName,
        currency: testCase.currency,
        numberFormat: testCase.numberFormat,
        badgeIcon: 'HelpCircle',
      });
    });

    afterAll(() => {
      adapter.close();
    });

    it('should create a budget with correct name', () => {
      const allBudgets = budgetsService.getAllBudgets();
      const importedBudget = allBudgets.find((b) => b.ID === importedBudgetId);

      expect(importedBudget).toBeDefined();
      expect(importedBudget?.Name).toBe(testCase.budgetName);
      expect(importedBudget?.DisplayCurrency).toBe(testCase.currency);
    });

    it('should have total assignments of 6682116000 milliunits', () => {
      const stmt = adapter.prepare(`
        SELECT COALESCE(SUM(Amount), 0) as total
        FROM assignments
        WHERE BudgetId = ?
      `);
      const result = stmt.get(importedBudgetId) as { total: number };
      stmt.finalize();

      expect(result.total).toBe(SHARED_EXPECTATIONS.assignmentsTotal);
    });

    it('should have imported category groups', () => {
      const stmt = adapter.prepare(`
        SELECT COUNT(*) as count
        FROM category_groups
        WHERE BudgetId = ?
      `);
      const result = stmt.get(importedBudgetId) as { count: number };
      stmt.finalize();

      expect(result.count).toBe(SHARED_EXPECTATIONS.categoryGroups);
    });

    it('should have imported categories', () => {
      const stmt = adapter.prepare(`
        SELECT COUNT(*) as count
        FROM categories
        WHERE BudgetId = ?
      `);
      const result = stmt.get(importedBudgetId) as { count: number };
      stmt.finalize();

      expect(result.count).toBe(SHARED_EXPECTATIONS.categories);
    });

    it('should have imported transactions', () => {
      const stmt = adapter.prepare(`
        SELECT COUNT(*) as count
        FROM transactions
        WHERE BudgetId = ?
      `);
      const result = stmt.get(importedBudgetId) as { count: number };
      stmt.finalize();

      expect(result.count).toBe(SHARED_EXPECTATIONS.transactions);
    });

    it('should have imported accounts', () => {
      const stmt = adapter.prepare(`
        SELECT COUNT(*) as count
        FROM accounts
        WHERE BudgetId = ?
      `);
      const result = stmt.get(importedBudgetId) as { count: number };
      stmt.finalize();

      expect(result.count).toBe(SHARED_EXPECTATIONS.accounts);
    });

    it('should have correct September 2025 inflow and outflow totals', () => {
      const stmt = adapter.prepare(`
        SELECT 
          COALESCE(SUM(Inflow), 0) as totalInflow,
          COALESCE(SUM(Outflow), 0) as totalOutflow
        FROM transactions
        WHERE BudgetId = ?
          AND strftime('%Y-%m', Date) = '2025-09'
      `);
      const result = stmt.get(importedBudgetId) as { totalInflow: number; totalOutflow: number };
      stmt.finalize();

      expect(result.totalInflow).toBe(SHARED_EXPECTATIONS.septemberInflow);
      expect(result.totalOutflow).toBe(SHARED_EXPECTATIONS.septemberOutflow);
    });

    it('should categorize every transfer leg as "Transfers", not "Uncategorized"', () => {
      const stmt = adapter.prepare(`
        SELECT c.Name as categoryName, COUNT(*) as count
        FROM transactions t
        JOIN categories c ON t.CategoryID = c.ID
        WHERE t.BudgetId = ?
          AND t.TransferID IS NOT NULL AND TRIM(t.TransferID) <> ''
        GROUP BY c.Name
      `);
      const rows = stmt.all(importedBudgetId) as { categoryName: string; count: number }[];
      stmt.finalize();

      // Both legs of a transfer (the outflow/source side and the inflow/dest side)
      // must land in "Transfers" — the source side previously regressed to
      // "Uncategorized" because the importer passed a non-zero default category.
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.categoryName).toBe('Transfers');
      }
    });

    it('should put the savings→checking source legs in Transfers (regression)', () => {
      // These are the exact rows from the bug report: outflow side of the
      // "Transfer : Beta Checking" transfers on the Beta Savings RSD account.
      const stmt = adapter.prepare(`
        SELECT c.Name as categoryName, COUNT(*) as count
        FROM transactions t
        JOIN categories c ON t.CategoryID = c.ID
        WHERE t.BudgetId = ?
          AND t.Payee = 'Transfer : Beta Checking'
          AND t.Outflow > 0
        GROUP BY c.Name
      `);
      const rows = stmt.all(importedBudgetId) as { categoryName: string; count: number }[];
      stmt.finalize();

      expect(rows).toEqual([{ categoryName: 'Transfers', count: expect.any(Number) }]);
      expect(rows[0].count).toBeGreaterThan(0);
    });
  });
}
