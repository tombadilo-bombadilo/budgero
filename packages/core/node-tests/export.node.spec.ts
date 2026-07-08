import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';
import { DatabaseExportService } from '../src/services/export/index.js';

describe('ExportService', () => {
  it('exports CSV/DB', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);

    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'Export Budget',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const account = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      100
    );
    const expenseCategory = services.categories
      .getAllCategories(budgetId)
      .find((c: { Name: string }) => c.Name !== 'Income');
    if (!expenseCategory) throw new Error('Expense category not found');
    const categoryId = expenseCategory.ID;
    await services.transactions.addTransaction(
      0,
      10,
      account.ID,
      categoryId,
      budgetId,
      '2024-01-01',
      'x'
    );

    const exportSvc = new DatabaseExportService(sm);

    const csv = await exportSvc.exportCSV();
    expect(Object.keys(csv)).toEqual(
      expect.arrayContaining([
        'budgets.csv',
        'accounts.csv',
        'categories.csv',
        'category_groups.csv',
        'transactions.csv',
        'assignments.csv',
        'goals.csv',
      ])
    );
    expect(csv['budgets.csv']).toContain('\n');

    const backup = await exportSvc.exportDatabase();
    expect(backup instanceof Uint8Array).toBe(true);
    expect(backup.length).toBeGreaterThan(0);
  });
});
