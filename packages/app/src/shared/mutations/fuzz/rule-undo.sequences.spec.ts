/**
 * Shrunk fuzz counterexamples for rule-run undo (tracker A24, A30, A31, A32,
 * U6), replayed step by step on the fuzz devices (harness.ts): real sql.js
 * databases, AppRuntime -> MutationExecutor -> UndoStore, and the remote
 * apply path for the second device.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { useUndoStore } from '@shared/mutations/UndoStore';
import {
  Device,
  diffDumps,
  formatDiffs,
  ids,
  installFxStub,
  resetClock,
  rows,
  setToday,
  type Dump,
  type DumpOptions,
} from './harness';
import { templateBytes } from './invariants';

vi.mock('@shared/runtime/global', async (importOriginal) => {
  const { runtimeHolder } = await import('./runtime-holder');
  return {
    ...(await importOriginal<object>()),
    getRuntime: () => runtimeHolder.current?.runtime ?? null,
  };
});

/** What invariant 5 compares (an undone run counts as no run, see harness.ts). */
const UNDO: DumpOptions = { sequences: false, crossDevice: false, hideUndoneRuns: true };
/** What invariant 6 compares. */
const REPLAY: DumpOptions = { sequences: true, crossDevice: true };

const opened: Device[] = [];

async function open(name = 'A'): Promise<Device> {
  const device = await Device.open(name, await templateBytes());
  opened.push(device);
  return device;
}

function expectSame(expected: Dump, actual: Dump) {
  expect(formatDiffs(diffDumps(expected, actual))).toBe('');
}

/** Deliver everything `from` sent to `to`. */
async function deliver(from: Device, to: Device) {
  for (const message of from.outbox.splice(0)) await to.receive(message);
}

const budgetOf = (d: Device) => ids(d, 'SELECT ID FROM budgets ORDER BY ID')[0]!;
const accountNamed = (d: Device, name: string) =>
  ids(d, 'SELECT ID FROM accounts WHERE Name = ?', name)[0]!;
const categoryNamed = (d: Device, name: string) =>
  ids(d, 'SELECT ID FROM categories WHERE Name = ?', name)[0]!;
/** Seed rule 1: continuous, memo contains "coffee" -> category Food. */
const COFFEE_RULE = 1;

const addCoffee = (d: Device, account = 'Checking') =>
  d.local<number>('transactions.add', {
    budgetId: budgetOf(d),
    accountId: accountNamed(d, account),
    categoryId: categoryNamed(d, 'Rent'),
    date: '2026-10-10',
    memo: 'coffee run',
    payee: 'Grocer',
    inflow: 0,
    outflow: 4_560,
  });

/**
 * undo -> state before, redo -> state after, and once more. `redoSkips`:
 * tables a redo re-creates under new IDs for a known, unrelated reason.
 */
async function expectExactUndoRedo(
  d: Device,
  act: () => Promise<unknown>,
  redoSkips: string[] = []
) {
  const before = d.dump(UNDO);
  await act();
  const after = d.dump(UNDO);
  expect(diffDumps(before, after).length).toBeGreaterThan(0);
  const withoutSkipped = (dump: Dump) =>
    new Map([...dump].filter(([table]) => !redoSkips.includes(table)));
  for (let round = 0; round < 2; round += 1) {
    await d.undo();
    expectSame(before, d.dump(UNDO));
    await d.redo();
    expectSame(withoutSkipped(after), withoutSkipped(d.dump(UNDO)));
  }
  return { before, after };
}

describe('rule-run undo: fuzz counterexamples', () => {
  beforeAll(async () => {
    installFxStub();
    await templateBytes();
  });
  afterAll(() => {
    for (const device of opened) device.close();
    resetClock();
    vi.unstubAllGlobals();
  });

  it('A31: undo of an amount rule on a foreign-currency row restores native and converted amounts', async () => {
    setToday(0);
    const d = await open();
    const rule = await d.local<{ id: number }>('rules.create', {
      input: {
        budgetId: budgetOf(d),
        name: 'Adjust',
        conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
        actions: [{ type: 'amount.adjust_value', payload: { delta: 100 } }],
        mode: 'one_time',
        enabled: true,
        runOrder: 0,
      },
    });
    const eur = accountNamed(d, 'Euro');
    const eurRows = () =>
      rows(d, 'SELECT * FROM transactions WHERE AccountID = ? ORDER BY ID', eur).concat(
        rows(d, 'SELECT * FROM accounts WHERE ID = ?', eur)
      );
    const eurBefore = eurRows();

    await expectExactUndoRedo(d, () =>
      d.local('rules.execute', { ruleId: rule.id, options: { trigger: 'retroactive' } })
    );
    // The rule changed the euro row; undo puts it (and the balance) back exactly.
    expect(eurRows()).not.toEqual(eurBefore);
    await d.undo();
    expect(eurRows()).toEqual(eurBefore);
  });

  it('A30: undo of a manual run works after a continuous rule ran on another row, whatever the clock order', async () => {
    const d = await open();
    // The continuous run of the add completes at a LATER clock time than the
    // manual run below (the old check ordered runs by that time).
    setToday(3);
    await addCoffee(d);
    setToday(0);
    const before = d.dump(UNDO);
    await d.local('rules.execute', { ruleId: COFFEE_RULE, options: { trigger: 'manual' } });
    await d.undo();
    expectSame(before, d.dump(UNDO));
  });

  it('A30: the same undo replayed on the other device after its continuous run (no throw, same state)', async () => {
    setToday(0);
    const a = await open('A');
    const b = await open('B');
    await b.local('rules.execute', { ruleId: COFFEE_RULE, options: { trigger: 'manual' } });
    await deliver(b, a);
    setToday(4);
    await addCoffee(a);
    await deliver(a, b);
    setToday(0);
    await b.undo();
    await deliver(b, a);
    expectSame(a.dump(REPLAY), b.dump(REPLAY));
  });

  it('A30: refuses up front when a later run changed the same rows (nothing written or sent, entry kept)', async () => {
    setToday(0);
    const a = await open('A');
    const b = await open('B');
    await b.local('rules.execute', { ruleId: COFFEE_RULE, options: { trigger: 'manual' } });
    await deliver(b, a);
    const memoRule = await a.local<{ id: number }>('rules.create', {
      input: {
        budgetId: budgetOf(a),
        name: 'Memo',
        conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
        actions: [{ type: 'memo.set', payload: { memo: 'ruled coffee' } }],
        mode: 'one_time',
        enabled: true,
        runOrder: 0,
      },
    });
    await a.local('rules.execute', { ruleId: memoRule.id, options: { trigger: 'manual' } });
    await deliver(a, b);

    const before = b.dump(REPLAY);
    await expect(b.undo()).rejects.toThrow(/later rule run changed the same transactions/);
    expectSame(before, b.dump(REPLAY));
    expect(b.outbox).toHaveLength(0);
    // UndoStore keeps a refused entry for retry.
    expect(useUndoStore.getState().failed?.direction).toBe('undo');
  });

  it('A32: B runs a rule, A deletes (reassigns) a category it moved rows out of, B undoes: all or nothing, same on both devices', async () => {
    setToday(0);
    const a = await open('A');
    const b = await open('B');
    const budgetId = budgetOf(b);
    const food = categoryNamed(b, 'Food');
    // Coffee rows of the seed sit in Rent, Fun and Power; the rule moves them to Food.
    const coffee = rows<{ ID: number; CategoryID: number }>(
      b,
      "SELECT ID, CategoryID FROM transactions WHERE Memo LIKE '%coffee%' ORDER BY ID"
    );
    expect(new Set(coffee.map((row) => row.CategoryID)).size).toBeGreaterThan(1);
    await b.local('rules.execute', { ruleId: COFFEE_RULE, options: { trigger: 'manual' } });
    await deliver(b, a);
    const gone = coffee[1]!.CategoryID;
    await a.local('categories.deleteAndReassign', {
      id: gone,
      budgetId,
      reassignTo: categoryNamed(a, 'Gifts'),
    });
    await deliver(a, b);

    await b.undo();
    await deliver(b, a);
    expectSame(a.dump(REPLAY), b.dump(REPLAY));
    const after = new Map(
      rows<{ ID: number; CategoryID: number }>(
        b,
        `SELECT ID, CategoryID FROM transactions WHERE ID IN (${coffee.map((row) => row.ID).join(',')})`
      ).map((row) => [row.ID, row.CategoryID])
    );
    for (const row of coffee) {
      // Rows whose old category is gone keep the rule's category; the rest go back.
      expect(after.get(row.ID)).toBe(row.CategoryID === gone ? food : row.CategoryID);
    }
  });

  it('A24: undo of an add reverts the continuous-rule run it triggered; redo brings the same run back', async () => {
    setToday(0);
    const d = await open();
    const runIds = () => ids(d, 'SELECT ID FROM transaction_rule_runs ORDER BY ID');
    const before = runIds();
    await expectExactUndoRedo(d, () => addCoffee(d));
    // Redo re-applied the add's run instead of running the rules again.
    expect(runIds()).toEqual([...before, Math.max(0, ...before) + 1]);
  });

  it('A24: the same for a foreign-currency add, an import, a transfer and a posted recurring bill', async () => {
    setToday(0);
    const d = await open();
    const budgetId = budgetOf(d);
    await expectExactUndoRedo(d, () => addCoffee(d, 'Euro'));
    await expectExactUndoRedo(
      d,
      () =>
        d.local('transactions.import', {
          inflow: 0,
          outflow: 3_000,
          accountId: accountNamed(d, 'Checking'),
          categoryId: categoryNamed(d, 'Rent'),
          budgetId,
          date: '2026-10-11',
          memo: 'coffee import',
          payee: 'Grocer',
          transferId: '',
          importIdentities: [
            {
              operationId: 'seq-op-1',
              fileRowKey: 'row:seq-op-1',
              date: '2026-10-11',
              inflow: 0,
              outflow: 3_000,
              payee: 'Grocer',
              memo: 'coffee import',
              currency: 'USD',
            },
          ],
        }),
      // NEW-1: a redone import gets a new import_provenance row ID.
      ['import_provenance']
    );
    const transfers = categoryNamed(d, 'Transfers');
    await expectExactUndoRedo(d, () =>
      d.local('transactions.addTransfer', {
        budgetId,
        transferId: 'seq-transfer',
        source: {
          accountId: accountNamed(d, 'Checking'),
          categoryId: transfers,
          date: '2026-10-12',
          memo: 'coffee fund',
          payee: '',
          inflow: 0,
          outflow: 10_000,
        },
        destination: {
          accountId: accountNamed(d, 'Euro'),
          categoryId: transfers,
          date: '2026-10-12',
          memo: 'coffee fund',
          payee: '',
          inflow: 9_000,
          outflow: 0,
        },
      })
    );
    const occurrence = rows<{ ID: number; RecurringTransactionID: number; DueDate: string }>(
      d,
      `SELECT ID, RecurringTransactionID, DueDate FROM recurring_transaction_occurrences
        WHERE Status = 'scheduled' ORDER BY DueDate, RecurringTransactionID LIMIT 1`
    )[0]!;
    await expectExactUndoRedo(d, () =>
      d.local('recurring.markReady', {
        options: {
          occurrenceId: occurrence.ID,
          recurringTransactionId: occurrence.RecurringTransactionID,
          dueDate: occurrence.DueDate,
        },
      })
    );
  });

  it('A24: posting a recurring transfer after the Transfers group was deleted: undo removes the Transfers category it re-created', async () => {
    setToday(0);
    const d = await open();
    const group = ids(d, "SELECT ID FROM category_groups WHERE Name = 'Transfers'")[0]!;
    await d.local('categoryGroups.delete', { id: group });
    d.clearUndo();
    const occurrence = rows<{ ID: number; RecurringTransactionID: number; DueDate: string }>(
      d,
      `SELECT o.ID, o.RecurringTransactionID, o.DueDate FROM recurring_transaction_occurrences o
         JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
        WHERE o.Status = 'scheduled' AND r.ToAccountID IS NOT NULL
        ORDER BY o.DueDate LIMIT 1`
    )[0]!;
    await expectExactUndoRedo(d, () =>
      d.local('recurring.markReady', {
        options: {
          occurrenceId: occurrence.ID,
          recurringTransactionId: occurrence.RecurringTransactionID,
          dueDate: occurrence.DueDate,
        },
      })
    );
  });

  it('A24: a transfer after the Transfers group was deleted: undo removes the Transfers category it re-created', async () => {
    setToday(0);
    const d = await open();
    const group = ids(d, "SELECT ID FROM category_groups WHERE Name = 'Transfers'")[0]!;
    await d.local('categoryGroups.delete', { id: group });
    d.clearUndo();
    await expectExactUndoRedo(d, () =>
      d.local('transactions.addTransfer', {
        budgetId: budgetOf(d),
        transferId: 'seq-transfer-2',
        source: {
          accountId: accountNamed(d, 'Checking'),
          date: '2026-10-12',
          memo: 'coffee fund',
          payee: '',
          inflow: 0,
          outflow: 10_000,
        },
        destination: {
          accountId: accountNamed(d, 'Savings'),
          date: '2026-10-12',
          memo: 'coffee fund',
          payee: '',
          inflow: 10_000,
          outflow: 0,
        },
      })
    );
  });

  it('A24: a continuous run that failed (its category is gone) is undone with the add', async () => {
    setToday(0);
    const d = await open();
    const budgetId = budgetOf(d);
    const gifts = categoryNamed(d, 'Gifts');
    await d.local('rules.create', {
      input: {
        budgetId,
        name: 'To gifts',
        conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
        actions: [{ type: 'category.set', payload: { categoryId: gifts } }],
        mode: 'continuous',
        enabled: true,
        runOrder: 5,
      },
    });
    await d.local('categories.delete', { id: gifts });
    await expectExactUndoRedo(d, () => addCoffee(d));
    expect(
      rows<{ Status: string }>(d, 'SELECT Status FROM transaction_rule_runs').some(
        (run) => run.Status === 'failed'
      )
    ).toBe(true);
  });

  it('U6: undo of a rule delete brings back its run history', async () => {
    setToday(0);
    const d = await open();
    await d.local('rules.execute', { ruleId: COFFEE_RULE, options: { trigger: 'manual' } });
    await addCoffee(d);
    expect(
      rows(d, 'SELECT * FROM transaction_rule_runs WHERE RuleID = ?', COFFEE_RULE)
    ).not.toEqual([]);
    await expectExactUndoRedo(d, () => d.local('rules.delete', { id: COFFEE_RULE }));
  });
});
