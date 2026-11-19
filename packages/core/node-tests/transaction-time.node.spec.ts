import initSqlJs from 'sql.js';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '../src';
import { migrations } from '../src/database/migrations.js';
import { createMigrationDatabase } from '../src/database/migration-database-factory.js';
import {
  capturedTimeOfDay,
  normalizeTimeOfDay,
  parseTimeOfDay,
  timeFromIsoDateTime,
} from '../src/utils/time-of-day.js';

const m = (value: number) => asMilli(value);

describe('migration 082: transaction time', () => {
  it('adds a nullable Time column and the off-by-default preference; existing rows have no time', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = createMigrationDatabase(new SQL.Database());
    for (const migration of migrations.filter((x) => x.version < 82)) {
      try {
        if (typeof migration.up === 'function') migration.up(db);
        else db.exec(migration.up);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('duplicate column'))) throw error;
      }
    }
    db.exec(`INSERT INTO user_meta (ID) VALUES (1) ON CONFLICT DO NOTHING`);
    const m082 = migrations.find((x) => x.version === 82)!;
    expect(m082.verify!(db)).toBe(false);
    (m082.up as (d: typeof db) => void)(db);
    expect(m082.verify!(db)).toBe(true);
    const columns = db.exec(`PRAGMA table_info(transactions)`)[0].values.map((row) => row[1]);
    expect(columns).toContain('Time');
    expect(db.exec(`SELECT ShowTransactionTime FROM user_meta WHERE ID = 1`)[0].values).toEqual([
      [0],
    ]);
    // Re-running (applied twice) is a no-op and keeps the data.
    db.exec(`UPDATE user_meta SET ShowTransactionTime = 1 WHERE ID = 1`);
    (m082.up as (d: typeof db) => void)(db);
    expect(m082.verify!(db)).toBe(true);
    expect(db.exec(`SELECT ShowTransactionTime FROM user_meta WHERE ID = 1`)[0].values).toEqual([
      [1],
    ]);
  });

  it('fails on anything but an existing column', async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) =>
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    });
    const db = createMigrationDatabase(new SQL.Database());
    const m082 = migrations.find((x) => x.version === 82)!;
    expect(() => (m082.up as (d: typeof db) => void)(db)).toThrow(/no such table/);
  });
});

describe('time-of-day parsing', () => {
  it('normalizes HH:MM and rejects anything else', () => {
    expect(parseTimeOfDay('09:05')).toBe('09:05');
    expect(parseTimeOfDay('9:05')).toBe('09:05');
    expect(parseTimeOfDay('23:59:59')).toBe('23:59');
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay('24:00')).toBeUndefined();
    expect(parseTimeOfDay('12:60')).toBeUndefined();
    expect(parseTimeOfDay('noon')).toBeUndefined();
    expect(parseTimeOfDay(930)).toBeUndefined();
    expect(() => normalizeTimeOfDay('7pm')).toThrow(/HH:MM/);
  });

  it('keeps only real times from source timestamps', () => {
    expect(capturedTimeOfDay(14, 30, 12)).toBe('14:30');
    expect(capturedTimeOfDay(0, 0, 0)).toBeNull();
    expect(capturedTimeOfDay(12, 0, 0)).toBeNull();
    expect(capturedTimeOfDay(12, 0, 1)).toBe('12:00');
    expect(capturedTimeOfDay(0, 1)).toBe('00:01');
    expect(timeFromIsoDateTime('2026-03-04T08:15:00+01:00')).toBe('08:15');
    expect(timeFromIsoDateTime('2026-03-04 21:07')).toBe('21:07');
    expect(timeFromIsoDateTime('2026-03-04T00:00:00Z')).toBeNull();
    expect(timeFromIsoDateTime('2026-03-04')).toBeNull();
    expect(timeFromIsoDateTime(undefined)).toBeNull();
  });
});

describe('transaction time', () => {
  let adapter: NodeSqlJsAdapter;
  let s: Services;
  let budgetId: number;
  let checking: number;
  let savings: number;
  let categoryId: number;

  const time = (id: number) => s.transactions.getTransactionByID(id).Time ?? null;
  const add = (outflow: number, date: string, t?: string | null, transferId = '') =>
    s.transactions.addTransaction(
      m(0),
      m(outflow),
      checking,
      categoryId,
      budgetId,
      date,
      'memo',
      transferId,
      undefined,
      undefined,
      undefined,
      false,
      [],
      false,
      undefined,
      undefined,
      t
    );

  beforeEach(async () => {
    adapter = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    s = manager.getServices();
    budgetId = await s.budgets.createBudget({
      name: 'Times',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    checking = (await s.accounts.createAccount('Checking', budgetId, 'checking', 'USD', m(0))).ID;
    savings = (await s.accounts.createAccount('Savings', budgetId, 'savings', 'USD', m(0))).ID;
    categoryId = s.categories.getAllCategories(budgetId)[0].ID;
  });

  it('is optional on add and stored as HH:MM', async () => {
    const plain = await add(1000, '2026-03-04');
    const timed = await add(2000, '2026-03-04', '8:05');
    expect(time(plain)).toBeNull();
    expect(time(timed)).toBe('08:05');
    await expect(add(1, '2026-03-04', '25:00')).rejects.toThrow(/HH:MM/);
  });

  it('is returned by the register queries', async () => {
    const id = await add(1000, '2026-03-04', '14:30');
    expect(s.transactions.getTransactionsByAccount(checking)[0]).toMatchObject({
      ID: id,
      Time: '14:30',
    });
    expect(s.transactions.getTransactionForAccountRegister(id)).toMatchObject({ Time: '14:30' });
    expect(s.transactions.getAllTransactions(budgetId)[0]).toMatchObject({ Time: '14:30' });
  });

  it('keeps the stored (date, id) order and running balances regardless of time', async () => {
    const first = await add(1000, '2026-03-04', '18:00');
    const second = await add(2000, '2026-03-04', '07:00');
    const rows = s.transactions.getTransactionsByAccount(checking);
    expect(rows.map((row) => row.ID)).toEqual([second, first]);
    expect(rows.map((row) => row.RunningBalanceConverted)).toEqual([-3000, -1000]);
  });

  it('is set and cleared through updateTransactionColumn without touching balances', async () => {
    const id = await add(1000, '2026-03-04');
    const before = s.transactions.getTransactionByID(id);
    await s.transactions.updateTransactionColumn(id, 'Time', '21:45');
    expect(time(id)).toBe('21:45');
    expect(s.transactions.getTransactionByID(id).RunningBalanceConverted).toBe(
      before.RunningBalanceConverted
    );
    await s.transactions.updateTransactionColumn(id, 'Time', '');
    expect(time(id)).toBeNull();
    await expect(s.transactions.updateTransactionColumn(id, 'Time', 'later')).rejects.toThrow();
  });

  it('is shared by both legs of a transfer', async () => {
    const out = await add(5000, '2026-03-04', '10:00', 'xfer-1');
    const inbound = await s.transactions.addTransaction(
      m(5000),
      m(0),
      savings,
      categoryId,
      budgetId,
      '2026-03-04',
      '',
      'xfer-1',
      undefined,
      undefined,
      undefined,
      false,
      [],
      false,
      undefined,
      undefined,
      '10:00'
    );
    expect(time(inbound)).toBe('10:00');
    await s.transactions.updateTransactionColumn(inbound, 'time', '11:30');
    expect([time(out), time(inbound)]).toEqual(['11:30', '11:30']);
  });

  it('carries over to split-transfer mirrors and follows the parent', async () => {
    const parent = await add(3000, '2026-03-04', '09:15');
    await s.splits.upsertSplits(parent, [
      {
        CategoryID: categoryId,
        Memo: 'food',
        InflowConverted: m(0),
        OutflowConverted: m(1000),
        InflowNative: m(0),
        OutflowNative: m(1000),
        OrderIndex: 0,
      },
      {
        TransferAccountID: savings,
        Memo: 'to savings',
        InflowConverted: m(0),
        OutflowConverted: m(2000),
        InflowNative: m(0),
        OutflowNative: m(2000),
        OrderIndex: 1,
      },
    ]);
    const [mirror] = s.transactions.getTransactionsByAccount(savings);
    expect(mirror.Time).toBe('09:15');
    expect(time(parent)).toBe('09:15');
    await s.transactions.updateTransactionColumn(parent, 'Time', '16:40');
    expect(s.transactions.getTransactionsByAccount(savings)[0].Time).toBe('16:40');
    // Editing the mirror sets the time on the parent (and so every mirror).
    await s.transactions.updateTransactionColumn(mirror.ID, 'Time', '06:05');
    expect(time(parent)).toBe('06:05');
    expect(s.transactions.getTransactionsByAccount(savings)[0].Time).toBe('06:05');
  });

  it('is restored exactly by undo snapshots, and kept when an older snapshot has no Time key', async () => {
    const id = await add(1000, '2026-03-04', '12:34');
    const snapshot = s.transactions.captureRestoreSnapshot([id]);
    expect(snapshot.transactions[0].Time).toBe('12:34');

    // Delete + restore puts the time back.
    s.transactions.deleteTransaction(id);
    s.transactions.restoreTransactions(snapshot);
    expect(time(id)).toBe('12:34');

    // An edit undone with a snapshot from a build without the column keeps the time.
    const { Time: _time, ...legacyRow } = snapshot.transactions[0];
    await s.transactions.updateTransactionColumn(id, 'Memo', 'edited');
    s.transactions.restoreTransactions(
      { ...snapshot, transactions: [legacyRow] },
      { replace: true }
    );
    expect(s.transactions.getTransactionByID(id).Memo).toBe('memo');
    expect(time(id)).toBe('12:34');

    // A snapshot that recorded "no time" clears it.
    await s.transactions.updateTransactionColumn(id, 'Time', '');
    const untimed = s.transactions.captureRestoreSnapshot([id]);
    await s.transactions.updateTransactionColumn(id, 'Time', '07:00');
    s.transactions.restoreTransactions(untimed, { replace: true });
    expect(time(id)).toBeNull();
  });

  it('can be patched through the Push API', async () => {
    const id = await add(1000, '2026-03-04');
    await s.transactions.updatePushedTransaction(id, { time: '06:45' });
    expect(time(id)).toBe('06:45');
    await s.transactions.updatePushedTransaction(id, { time: null, memo: 'x' });
    expect(time(id)).toBeNull();
    await expect(s.transactions.updatePushedTransaction(id, { time: '6pm' })).rejects.toThrow(
      /HH:MM/
    );
  });

  it('has a register preference that is off by default', () => {
    expect(s.userMeta.getShowTransactionTime()).toBe(false);
    s.userMeta.setShowTransactionTime(true);
    expect(s.userMeta.getShowTransactionTime()).toBe(true);
  });
});
