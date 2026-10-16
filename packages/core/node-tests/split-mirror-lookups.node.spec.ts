import { beforeEach, describe, expect, it } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { asMilli } from '../src/money';
import { TransactionQueries } from '../src/services/transactions/queries';

type RawDb = {
  prepare(sql: string): {
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
};

describe('split mirror lookups (Node/sql.js)', () => {
  let adapter: NodeSqlJsAdapter;
  let services: Services;
  let queries: TransactionQueries;
  let budgetId: number;
  let checking: number;
  let groceries: number;

  const add = (transferId: string, date = '2026-01-01') =>
    services.transactions.addTransaction(
      asMilli(0),
      asMilli(1_000),
      checking,
      groceries,
      budgetId,
      date,
      'memo',
      transferId
    );

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    services = manager.getServices();
    queries = new TransactionQueries(adapter);
    budgetId = await services.budgets.createBudget({
      name: 'Mirrors',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });
    checking = (await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', 0))
      .ID;
    groceries = services.categories
      .getAllCategories(budgetId)
      .find((c) => c.Name === 'Groceries')!.ID;
  });

  it('finds, groups and re-keys mirrors by parent prefix only', async () => {
    const own = await add('split_transfer_1_2026-01-01');
    const olderDate = await add('split_transfer_1_2025-12-01');
    const otherParent = await add('split_transfer_12_2026-01-01');
    await add('split_transfer_2_2026-01-01');
    await add('tr-plain');
    await add('');

    const ids = (rows: { ID: number }[]) => rows.map((r) => r.ID).sort((a, b) => a - b);
    expect(ids(queries.getSplitMirrorTransactions(1))).toEqual(
      [own, olderDate].sort((a, b) => a - b)
    );
    expect(ids(queries.getSplitMirrorsForParents([12]))).toEqual([otherParent]);

    queries.rekeySplitMirrors(1, '2026-02-01');
    const rekeyed = queries.getSplitMirrorTransactions(1);
    expect(rekeyed.map((r) => [r.TransferID, r.Date])).toEqual([
      ['split_transfer_1_2026-02-01', '2026-02-01'],
      ['split_transfer_1_2026-02-01', '2026-02-01'],
    ]);
    expect(queries.getSplitMirrorTransactions(12).map((r) => r.TransferID)).toEqual([
      'split_transfer_12_2026-01-01',
    ]);
  });

  it('uses the TransferID index instead of scanning transactions', () => {
    const captured: string[] = [];
    const prepare = adapter.prepare.bind(adapter);
    adapter.prepare = ((query: string) => {
      captured.push(query);
      return prepare(query);
    }) as typeof adapter.prepare;
    try {
      queries.getSplitMirrorTransactions(1);
      queries.getSplitMirrorsForParents([1]);
      queries.rekeySplitMirrors(1, '2026-02-01');
    } finally {
      adapter.prepare = prepare;
    }

    const raw = (adapter as unknown as { db: RawDb }).db;
    const lookups = captured.filter((query) => query.includes('GLOB'));
    expect(lookups).toHaveLength(3);
    for (const query of lookups) {
      const stmt = raw.prepare(`EXPLAIN QUERY PLAN ${query}`);
      const details: string[] = [];
      while (stmt.step()) details.push(String(stmt.getAsObject().detail));
      stmt.free();
      const detail = details.join('\n');
      expect(detail, query).toContain('idx_transactions_transfer_id');
      expect(detail, query).not.toMatch(/SCAN transactions\b/);
    }
  });
});
