/**
 * Data-level proof for transactions.updateColumn's per-column invalidation:
 * with real services, a column edit leaves every query it no longer refreshes
 * byte-for-byte unchanged, and changes the ones it does refresh.
 */
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { executeMutationOp } from '@shared/mutations/op-code-registry';
import { updateColumnInvalidations } from './transactions';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

const MONTH = '2026-09';
const MONTHS = ['2026-08', '2026-09', '2026-10'];

describe('column edits leave the queries they skip unchanged', () => {
  let services: Services;
  let budgetId: number;
  let checking: number;
  let euro: number;
  let card: number;
  let groceries: number;
  let rent: number;
  let label: number;
  let otherLabel: number;
  let txId: number;
  let euroTxId: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      await manager.initialize(await NodeSqlJsAdapter.create());
    } finally {
      cwd.mockRestore();
    }
    services = manager.getServices();
    runtime.services = services;
    budgetId = await services.budgets.createBudget({
      name: 'Narrowing',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    await services.currency.saveRate('EUR', 'USD', 1.1, '2026-08-01', budgetId);
    checking = (
      await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
    ).ID;
    euro = (await services.accounts.createAccount('Euro', budgetId, 'checking', 'EUR', asMilli(0)))
      .ID;
    card = (await services.accounts.createAccount('Card', budgetId, 'credit', 'USD', asMilli(0)))
      .ID;
    const categories = services.categories.getAllCategories(budgetId);
    const income = categories.find((c) => c.Name === 'Income')!.ID;
    const spending = categories.filter(
      (c) => !['Income', 'Uncategorized', 'Transfers'].includes(c.Name)
    );
    groceries = spending[0].ID;
    rent = spending[1].ID;
    label = services.labels.addLabel(budgetId, 'Trip', '#ff0000');
    otherLabel = services.labels.addLabel(budgetId, 'Work', '#00ff00');
    const add = (account: number, date: string, inflow: number, outflow: number, cat: number) =>
      services.transactions.addTransaction(
        asMilli(inflow),
        asMilli(outflow),
        account,
        cat,
        budgetId,
        date,
        'memo',
        '',
        'Shop',
        label
      );
    await add(checking, '2026-08-01', 500_000, 0, income);
    await add(euro, '2026-08-02', 100_000, 0, income);
    txId = await add(checking, '2026-09-05', 0, 12_000, groceries);
    euroTxId = await add(euro, '2026-09-06', 0, 8_000, groceries);
    await add(card, '2026-09-07', 0, 30_000, rent);
    await add(checking, '2026-10-01', 0, 1_000, rent);
    services.monthlyBudgets.upsertMonthlyAssignment(groceries, asMilli(50_000), MONTH, budgetId);
    services.monthlyBudgets.upsertMonthlyAssignment(rent, asMilli(40_000), MONTH, budgetId);
  });

  // What each skippable group of queries shows.
  const snapshot = () => ({
    budget: {
      months: MONTHS.map((m) => services.monthlyBudgets.getMonthlyBudget(m, budgetId)),
      rta: MONTHS.map((m) => services.monthlyBudgets.getReadyToAssignBreakdown(budgetId, m)),
      accounts: services.accounts.listAccounts(budgetId),
      onBudget: services.analytics.getOnBudgetBalance(budgetId),
      spending: services.analytics.getSpendingByDates('2026-08-01', '2026-10-31', budgetId),
    },
    payees: {
      names: services.payees.getPayeeNames(budgetId),
      usage: services.payees.getPayeesWithUsage(budgetId),
    },
    labels: services.labels.getLabelsWithUsage(budgetId),
    labelSpending: services.analytics.getSpendingByLabels('2026-08-01', '2026-10-31', budgetId),
    rows: services.transactions.getAllTransactionsDetailed(budgetId),
  });

  const edit = async (columnName: string, newValue: unknown, id = txId) => {
    const before = snapshot();
    await executeMutationOp('transactions.updateColumn', { id, columnName, newValue });
    return {
      before,
      after: snapshot(),
      roots: new Set(updateColumnInvalidations({ columnName }).map(([r]) => r)),
    };
  };

  it('memo: only the rows change', async () => {
    const { before, after, roots } = await edit('Memo', 'new memo');
    expect(after.rows).not.toEqual(before.rows);
    expect(after.budget).toEqual(before.budget);
    expect(after.payees).toEqual(before.payees);
    expect(after.labels).toEqual(before.labels);
    expect(after.labelSpending).toEqual(before.labelSpending);
    expect(roots.has('monthlyBudget')).toBe(false);
  });

  it('payee: rows and payees change, budget and labels do not', async () => {
    const { before, after, roots } = await edit('Payee', 'Bakery');
    expect(after.rows).not.toEqual(before.rows);
    expect(after.payees).not.toEqual(before.payees);
    expect(after.budget).toEqual(before.budget);
    expect(after.labels).toEqual(before.labels);
    expect(roots.has('payees')).toBe(true);
    expect(roots.has('readyToAssign')).toBe(false);
  });

  it('label: rows and labels change, budget and payees do not', async () => {
    const { before, after, roots } = await edit('LabelID', otherLabel);
    expect(after.rows).not.toEqual(before.rows);
    expect(after.labels).not.toEqual(before.labels);
    expect(after.labelSpending).not.toEqual(before.labelSpending);
    expect(after.budget).toEqual(before.budget);
    expect(after.payees).toEqual(before.payees);
    expect(roots.has('labelDirectory')).toBe(true);
    expect(roots.has('accounts')).toBe(false);
  });

  it.each([
    ['OutflowConverted', 15_000, 'checking'],
    ['OutflowNative', 9_000, 'euro'],
    ['Date', '2026-10-03', 'checking'],
    ['CategoryID', 'rent', 'checking'],
    ['AccountID', 'card', 'checking'],
    ['ExchangeRate', 1.3, 'euro'],
  ] as const)(
    '%s: budget data changes, payee and label directories do not',
    async (col, value, on) => {
      const resolved =
        value === 'rent' ? String(rent) : value === 'card' ? card : (value as string | number);
      const { before, after, roots } = await edit(col, resolved, on === 'euro' ? euroTxId : txId);
      expect(after.rows).not.toEqual(before.rows);
      expect(after.budget).not.toEqual(before.budget);
      expect(after.payees).toEqual(before.payees);
      expect(after.labels).toEqual(before.labels);
      expect(roots.has('monthlyBudget')).toBe(true);
      expect(roots.has('payees')).toBe(false);
      expect(roots.has('labelDirectory')).toBe(false);
    }
  );
});
