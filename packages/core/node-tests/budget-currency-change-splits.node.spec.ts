import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, asMilli, type DatabaseAdapter } from '../src';
import { migration084 } from '../src/database/migrations/084-resync-split-lines-after-currency-change';
import { createMigrationDatabase } from '../src/database/migration-database-factory';

const RSD_PER_USD = 100;

/** fetch stub for /api/v1/exchange-rates: a flat USD↔RSD rate. */
function stubRates() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const params = new URL(url, 'http://local').searchParams;
      const base = params.get('base')!;
      const quotes: Record<string, number> = {};
      for (const symbol of params.get('symbols')!.split(',').filter(Boolean)) {
        quotes[`${base}${symbol}`] =
          base === symbol ? 1 : base === 'RSD' ? 1 / RSD_PER_USD : RSD_PER_USD;
      }
      return { ok: true, json: async () => ({ date: params.get('date'), quotes }) };
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

async function seedSplitBudget() {
  const adapter = await NodeSqlJsAdapter.create();
  const manager = new ServiceManager();
  await manager.initialize(adapter as DatabaseAdapter);
  const s = manager.getServices();
  const budgetId = await s.budgets.createBudget({
    name: 'RSD budget',
    display_currency: 'RSD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: false,
  });
  const group = s.categories.addCategoryGroup('Spending', budgetId);
  const food = s.categories.addCategory(group, budgetId, 'Hrana i Pice');
  const home = s.categories.addCategory(group, budgetId, 'Kucna Hemija');
  const account = await s.accounts.createAccount('Tekuci', budgetId, 'checking', 'RSD', asMilli(0));
  const parentId = await s.transactions.addTransaction(
    asMilli(0),
    asMilli(4_585_240),
    account.ID,
    food,
    budgetId,
    '2026-07-15',
    'split'
  );
  await s.splits.upsertSplits(parentId, [
    {
      CategoryID: home,
      Memo: '',
      InflowConverted: 0,
      OutflowConverted: asMilli(3_200_000),
      OrderIndex: 0,
    },
    {
      CategoryID: food,
      Memo: '',
      InflowConverted: 0,
      OutflowConverted: asMilli(1_385_240),
      OrderIndex: 1,
    },
  ]);
  return { adapter, s, budgetId, parentId };
}

function q<T>(adapter: DatabaseAdapter, sql: string): T[] {
  const stmt = adapter.prepare(sql);
  const rows = stmt.all() as T[];
  stmt.finalize();
  return rows;
}

describe('budget currency change with split transactions', () => {
  it('converts split lines with their parent', async () => {
    const { adapter, s, budgetId, parentId } = await seedSplitBudget();
    stubRates();
    await s.budgets.updateBudgetCurrency(budgetId, 'USD');

    const [parent] = q<{ OutflowConverted: number }>(
      adapter,
      `SELECT OutflowConverted FROM transactions WHERE ID = ${parentId}`
    );
    const lines = q<{ OutflowConverted: number }>(
      adapter,
      `SELECT OutflowConverted FROM transaction_splits WHERE TransactionID = ${parentId} ORDER BY OrderIndex`
    );
    expect(parent.OutflowConverted).toBe(Math.round(asMilli(4_585_240) / RSD_PER_USD));
    expect(lines.map((l) => l.OutflowConverted)).toEqual([
      Math.round(asMilli(3_200_000) / RSD_PER_USD),
      Math.round(asMilli(1_385_240) / RSD_PER_USD),
    ]);
    expect(lines.reduce((sum, l) => sum + l.OutflowConverted, 0)).toBe(parent.OutflowConverted);
  });

  it('migration 084 repairs lines a past change left in the old currency', async () => {
    const { adapter, parentId } = await seedSplitBudget();
    // What the old change left: parent in USD, lines still in RSD amounts.
    adapter.exec(
      `UPDATE transactions SET OutflowConverted = ${Math.round(asMilli(4_585_240) / RSD_PER_USD)} WHERE ID = ${parentId}`
    );
    const migrationDb = createMigrationDatabase(
      (adapter as unknown as { db: Parameters<typeof createMigrationDatabase>[0] }).db
    );
    migration084.up instanceof Function && migration084.up(migrationDb);

    const lines = q<{ OutflowConverted: number }>(
      adapter,
      `SELECT OutflowConverted FROM transaction_splits WHERE TransactionID = ${parentId} ORDER BY OrderIndex`
    );
    expect(lines.map((l) => l.OutflowConverted)).toEqual([
      Math.round(asMilli(3_200_000) / RSD_PER_USD),
      Math.round(asMilli(1_385_240) / RSD_PER_USD),
    ]);
    // A second run changes nothing.
    migration084.up instanceof Function && migration084.up(migrationDb);
    const again = q<{ OutflowConverted: number }>(
      adapter,
      `SELECT OutflowConverted FROM transaction_splits WHERE TransactionID = ${parentId} ORDER BY OrderIndex`
    );
    expect(again).toEqual(lines);
  });
});
