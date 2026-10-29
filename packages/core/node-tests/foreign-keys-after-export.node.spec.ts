/**
 * sql.js export() re-opens the connection, which also resets
 * PRAGMA foreign_keys to OFF. Every save goes through backup() → export(), so
 * without re-enabling, cascades (import provenance, split lines...) silently
 * stopped after each save until the adapter's periodic re-check.
 */
import { describe, it, expect } from 'vitest';
import initSqlJs from 'sql.js';
import { NodeSqlJsAdapter, ServiceManager, asMilli } from '../src';
import { WebDatabaseAdapter } from '../src/database/web-adapter.js';

const fkOn = (exec: (sql: string) => { values: unknown[][] }[]) =>
  exec('PRAGMA foreign_keys')[0]?.values[0][0];

describe('foreign keys after export', () => {
  it('web adapter: backup() leaves foreign keys on, unless suspended', async () => {
    const SQL = await initSqlJs();
    const adapter = Object.create(WebDatabaseAdapter.prototype) as WebDatabaseAdapter;
    const internal = adapter as unknown as {
      db: InstanceType<typeof SQL.Database>;
      fkSuspended: boolean;
    };
    internal.db = new SQL.Database();
    internal.db.exec('PRAGMA foreign_keys = ON');
    internal.fkSuspended = false;
    adapter.backup();
    expect(fkOn((sql) => internal.db.exec(sql))).toBe(1);

    adapter.setForeignKeysSuspended(true);
    internal.db.exec('PRAGMA foreign_keys = OFF');
    adapter.backup();
    expect(fkOn((sql) => internal.db.exec(sql))).toBe(0);
  });

  it('node adapter: deleting a transaction after a save still cascades its import identity', async () => {
    const db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(db);
    const services = manager.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'FK',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const account = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'Checking',
      'USD',
      asMilli(0),
      true
    );
    const identity = {
      operationId: 'op-1',
      fileRowKey: 'row-1',
      date: '2026-09-01',
      inflow: 0,
      outflow: 1000,
      payee: 'Shop',
      memo: '',
      currency: 'USD',
    };
    const id = await services.transactions.addTransaction(
      asMilli(0),
      asMilli(1000),
      account.ID,
      0,
      budgetId,
      '2026-09-01',
      '',
      '',
      'Shop',
      null,
      null,
      false,
      [identity]
    );
    db.backup(); // what every save does
    services.transactions.deleteTransactions([id]);
    const left = db.exec('SELECT COUNT(*) FROM import_provenance')[0].values[0][0];
    expect(left).toBe(0);
  });
});
