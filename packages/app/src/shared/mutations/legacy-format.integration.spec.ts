/**
 * Existing op codes whose behaviour or args changed since v1.18.0: a call that
 * a v1.18 device would apply differently carries mutation format 3 (so that
 * device stops with "update required"); every other call stays format 2 and
 * keeps syncing to older devices. One block per decision; the reasons are in
 * legacy-format.ts.
 */
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import {
  BASE_MUTATION_FORMAT_VERSION,
  mutationFormatVersion,
  OP_CODE_FORMAT_VERSIONS,
  REQUIRES_FORMAT_ARG,
} from '@budgero/runtime';
import { executeMutationOp, KNOWN_OP_CODES, prepareMutationArgs } from './op-code-registry';
import { LEGACY_FORMAT_RULES, withLegacyFormat } from './legacy-format';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

/** Highest mutation format v1.18.0 and earlier read. */
const V1_18_MAX_FORMAT = 2;

let services: Services;
let adapter: NodeSqlJsAdapter;
let budgetId: number;
let checking: number;
let savings: number;
let groceries: number;
let rent: number;

const sql = (statement: string, ...params: unknown[]) => adapter.prepare(statement).run(...params);

/** The format the call goes out with, after the originating device prepared it. */
async function sentFormat(op: string, args: Record<string, unknown>): Promise<number> {
  return mutationFormatVersion(op, await prepareMutationArgs(op, args));
}

const line = (
  outflow: number,
  target: { CategoryID?: number | null; TransferAccountID?: number | null }
) => ({
  CategoryID: target.CategoryID ?? null,
  TransferAccountID: target.TransferAccountID ?? null,
  Memo: '',
  Payee: '',
  InflowConverted: asMilli(0),
  OutflowConverted: asMilli(outflow),
  InflowNative: null,
  OutflowNative: null,
  PairID: null,
  OrderIndex: 0,
});

async function addRow(
  accountId: number,
  outflow: number,
  categoryId = groceries,
  date = '2026-09-10'
) {
  return services.transactions.addTransaction(
    asMilli(0),
    asMilli(outflow),
    accountId,
    categoryId,
    budgetId,
    date,
    'row',
    ''
  );
}

/** Split parent with a category line and a transfer line (one mirror row in savings). */
async function addTransferSplit(date = '2026-09-10') {
  const parent = await addRow(checking, 10000, groceries, date);
  await services.splits.upsertSplits(parent, [
    line(6000, { CategoryID: groceries }),
    { ...line(4000, { TransferAccountID: savings }), OrderIndex: 1 },
  ]);
  const [mirror] = services.transactions.getTransactionsByTransferID(
    `split_transfer_${parent}_${date}`
  );
  return { parent, mirror: mirror.ID };
}

/** Split parent with category lines only (no mirrors). */
async function addCategorySplit() {
  const parent = await addRow(checking, 10000);
  await services.splits.upsertSplits(parent, [
    line(6000, { CategoryID: groceries }),
    { ...line(4000, { CategoryID: rent }), OrderIndex: 1 },
  ]);
  return parent;
}

beforeEach(async () => {
  const manager = new ServiceManager();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    adapter = await NodeSqlJsAdapter.create();
    await manager.initialize(adapter);
  } finally {
    cwd.mockRestore();
  }
  services = manager.getServices();
  runtime.services = services;
  budgetId = await services.budgets.createBudget({
    name: 'Legacy formats',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  checking = (
    await services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
  ).ID;
  savings = (
    await services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
  ).ID;
  const spendable = services.categories
    .getAllCategories(budgetId)
    .filter((category) => !['Income', 'Uncategorized', 'Transfers'].includes(category.Name));
  groceries = spendable[0].ID;
  rent = spendable[1].ID;
});

describe('the rule list', () => {
  it('only covers op codes v1.18 has (newer ones are format 3 by name)', () => {
    for (const op of Object.keys(LEGACY_FORMAT_RULES)) {
      expect(KNOWN_OP_CODES.has(op), op).toBe(true);
      expect(OP_CODE_FORMAT_VERSIONS[op], op).toBeUndefined();
    }
  });

  it('stamps a format v1.18 rejects, and drops a stale stamp a redo copied', () => {
    const stamped = withLegacyFormat('payees.rename', { budgetId, newPayeeId: 4 });
    expect(mutationFormatVersion('payees.rename', stamped)).toBeGreaterThan(V1_18_MAX_FORMAT);
    const copied = withLegacyFormat('payees.rename', { budgetId, [REQUIRES_FORMAT_ARG]: 3 });
    expect(copied).not.toHaveProperty(REQUIRES_FORMAT_ARG);
    expect(withLegacyFormat('labels.add', { [REQUIRES_FORMAT_ARG]: 3 })).toEqual({});
  });

  it('leaves the call at the base format when a check cannot run', () => {
    runtime.services = undefined;
    expect(
      mutationFormatVersion(
        'transactions.updateColumn',
        withLegacyFormat('transactions.updateColumn', { id: 1, columnName: 'date' })
      )
    ).toBe(BASE_MUTATION_FORMAT_VERSION);
  });

  it('stamped calls still apply on this build (the marker is ignored)', async () => {
    const { parent } = await addTransferSplit();
    const args = await prepareMutationArgs('transactions.updateColumn', {
      id: parent,
      columnName: 'OutflowConverted',
      newValue: 20000,
    });
    expect(args[REQUIRES_FORMAT_ARG]).toBe(3);
    await executeMutationOp('transactions.updateColumn', args);
    expect(services.transactions.getTransactionByID(parent).OutflowConverted).toBe(20000);
  });
});

describe('format 3 only when the new args are present', () => {
  it('budgets.updateCurrency: carried rates (v1.18 fetches its own per row)', () => {
    const plain = { id: budgetId, currency: 'EUR' };
    expect(
      mutationFormatVersion(
        'budgets.updateCurrency',
        withLegacyFormat('budgets.updateCurrency', plain)
      )
    ).toBe(2);
    const carried = { ...plain, fromCurrency: 'USD', asOf: '2026-09-10', rates: [] };
    expect(
      mutationFormatVersion(
        'budgets.updateCurrency',
        withLegacyFormat('budgets.updateCurrency', carried)
      )
    ).toBe(3);
  });

  it('payees.rename: only a redo carrying newPayeeId', async () => {
    expect(await sentFormat('payees.rename', { budgetId, oldName: 'A', newName: 'B' })).toBe(2);
    expect(
      await sentFormat('payees.rename', { budgetId, oldName: 'A', newName: 'B', newPayeeId: 9 })
    ).toBe(3);
  });

  it('recurring.markReady: occurrence key, TransferID or redo ids', () => {
    const stamp = (options: Record<string, unknown>) =>
      mutationFormatVersion(
        'recurring.markReady',
        withLegacyFormat('recurring.markReady', { options })
      );
    expect(stamp({ occurrenceId: 3 })).toBe(2);
    expect(stamp({ occurrenceId: 3, recurringTransactionId: 1, dueDate: '2026-09-10' })).toBe(3);
    expect(stamp({ occurrenceId: 3, transferId: 'tx-1' })).toBe(3);
    expect(stamp({ occurrenceId: 3, reuse: { transactionId: 5 } })).toBe(3);
  });

  it.each(['recurring.skip', 'recurring.markNotified', 'recurring.resetOccurrence'])(
    '%s: only keyed by (template, due date)',
    (op) => {
      expect(mutationFormatVersion(op, withLegacyFormat(op, { id: 3 }))).toBe(2);
      expect(
        mutationFormatVersion(
          op,
          withLegacyFormat(op, { id: 3, recurringTransactionId: 1, dueDate: '2026-09-10' })
        )
      ).toBe(3);
    }
  );

  it('rules.undoRun: always (restore path and run bookkeeping changed)', () => {
    expect(
      mutationFormatVersion('rules.undoRun', withLegacyFormat('rules.undoRun', { runId: 1 }))
    ).toBe(3);
  });
});

describe('format 3 only when the database is in a state the old code handles differently', () => {
  it('transactions.updateColumn: value edits of a split parent', async () => {
    const { parent } = await addTransferSplit();
    const plain = await addRow(checking, 500);
    const edit = (id: number, columnName: string, newValue: unknown) =>
      sentFormat('transactions.updateColumn', { id, columnName, newValue });
    expect(await edit(parent, 'OutflowConverted', 20000)).toBe(3);
    expect(await edit(parent, 'Date', '2026-09-12')).toBe(3);
    expect(await edit(parent, 'AccountID', savings)).toBe(3);
    expect(await edit(parent, 'ExchangeRate', 1.2)).toBe(3);
    expect(await edit(parent, 'Memo', 'note')).toBe(2);
    expect(await edit(parent, 'Payee', 'Shop')).toBe(2);
    expect(await edit(plain, 'OutflowConverted', 700)).toBe(2);
    expect(await edit(plain, 'Date', '2026-09-12')).toBe(2);
  });

  it('transactions.moveToNewAccount: split parents only', async () => {
    const parent = await addCategorySplit();
    const plain = await addRow(checking, 500);
    expect(
      await sentFormat('transactions.moveToNewAccount', {
        transactionId: parent,
        newAccountId: savings,
      })
    ).toBe(3);
    expect(
      await sentFormat('transactions.moveToNewAccount', {
        transactionId: plain,
        newAccountId: savings,
      })
    ).toBe(2);
  });

  it('transactions.upsertSplits / clearSplits: only when mirror rows exist', async () => {
    const { parent } = await addTransferSplit();
    const categoryOnly = await addCategorySplit();
    const fresh = await addRow(checking, 10000);
    const lines = [{ category_id: groceries, outflow: 10000 }];
    expect(
      await sentFormat('transactions.upsertSplits', { transactionId: parent, splits: lines })
    ).toBe(3);
    expect(await sentFormat('transactions.clearSplits', { transactionId: parent })).toBe(3);
    expect(
      await sentFormat('transactions.upsertSplits', { transactionId: categoryOnly, splits: lines })
    ).toBe(2);
    expect(await sentFormat('transactions.clearSplits', { transactionId: categoryOnly })).toBe(2);
    expect(
      await sentFormat('transactions.upsertSplits', { transactionId: fresh, splits: lines })
    ).toBe(2);
  });

  it('transactions.delete / deleteBatch: only when the deleted set differs', async () => {
    const { parent, mirror } = await addTransferSplit();
    const plain = await addRow(checking, 500);
    expect(await sentFormat('transactions.delete', { id: plain })).toBe(2);
    // Parent + mirror keyed by its current date: v1.18 finds the same rows.
    expect(await sentFormat('transactions.delete', { id: parent })).toBe(2);
    // A mirror now takes its whole split transaction with it (A21).
    expect(await sentFormat('transactions.delete', { id: mirror })).toBe(3);
    expect(await sentFormat('transactions.deleteBatch', { ids: [plain] })).toBe(2);
    expect(await sentFormat('transactions.deleteBatch', { ids: [plain, mirror] })).toBe(3);
    // A parent whose mirror is keyed by an older date (data an older build left).
    sql('UPDATE transactions SET Date = ? WHERE ID = ?', '2026-09-11', parent);
    expect(await sentFormat('transactions.delete', { id: parent })).toBe(3);
  });

  it('transactions.deleteTransfer / deleteByRef: plain transfers and rows stay format 2', async () => {
    const legA = await services.transactions.addTransaction(
      asMilli(0),
      asMilli(1000),
      checking,
      groceries,
      budgetId,
      '2026-09-10',
      't',
      'tr-1'
    );
    await services.transactions.addTransaction(
      asMilli(1000),
      asMilli(0),
      savings,
      groceries,
      budgetId,
      '2026-09-10',
      't',
      'tr-1'
    );
    expect(legA).toBeGreaterThan(0);
    expect(await sentFormat('transactions.deleteTransfer', { transferId: 'tr-1' })).toBe(2);
    expect(await sentFormat('transactions.deleteByRef', { messageId: 'missing' })).toBe(2);
  });

  it('transactions.updateTransferRate: only when split lines in its accounts are out of step', async () => {
    await services.transactions.addTransaction(
      asMilli(0),
      asMilli(1000),
      checking,
      groceries,
      budgetId,
      '2026-09-10',
      't',
      'tr-2'
    );
    await services.transactions.addTransaction(
      asMilli(1000),
      asMilli(0),
      savings,
      groceries,
      budgetId,
      '2026-09-10',
      't',
      'tr-2'
    );
    const parent = await addCategorySplit();
    const args = { transferId: 'tr-2', rate: 1.1 };
    expect(await sentFormat('transactions.updateTransferRate', args)).toBe(2);
    sql(
      'UPDATE transaction_splits SET OutflowConverted = OutflowConverted + 1 WHERE TransactionID = ?',
      parent
    );
    expect(await sentFormat('transactions.updateTransferRate', args)).toBe(3);
  });

  it.each([
    'currency.customRates.add',
    'currency.customRates.update',
    'currency.customRates.delete',
  ])('%s: only with split parents in foreign-currency accounts', async (op) => {
    const args = {
      id: 1,
      budgetId,
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: 1.1,
      startDate: '2026-01-01',
    };
    expect(await sentFormat(op, args)).toBe(2);
    const euro = (
      await services.accounts.createAccount('Euro', budgetId, 'checking', 'EUR', asMilli(0))
    ).ID;
    await executeMutationOp('transactions.add', {
      accountId: euro,
      budgetId,
      date: '2026-09-10',
      outflow: 10000,
      exchangeRateOverride: 1.1,
      splits: [
        { categoryId: groceries, outflow: 6000 },
        { categoryId: rent, outflow: 4000 },
      ],
    });
    expect(await sentFormat(op, args)).toBe(3);
  });

  it('accounts.update: liability start amounts or currency with split parents', async () => {
    const loan = await services.accounts.createAccount(
      'Car loan',
      budgetId,
      'loan',
      'USD',
      asMilli(0),
      {
        liability: true,
        debt_total: 1000,
      }
    );
    const update = (id: number, extra: Record<string, unknown>) =>
      sentFormat('accounts.update', { id, name: 'x', type: 'loan', budgetId, ...extra });
    const stored = JSON.parse(String(services.accounts.getAccount(loan.ID).Metadata));
    expect(await update(loan.ID, { currency: 'USD', metadata: stored })).toBe(2);
    expect(
      await update(loan.ID, { currency: 'USD', metadata: { ...stored, debt_total: 2000 } })
    ).toBe(3);
    expect(
      await update(loan.ID, { currency: 'USD', metadata: { ...stored, paid_so_far: 100 } })
    ).toBe(3);
    await addCategorySplit();
    expect(await update(checking, { type: 'checking', currency: 'USD' })).toBe(2);
    expect(await update(checking, { type: 'checking', currency: 'EUR' })).toBe(3);
    expect(await update(savings, { type: 'savings', currency: 'EUR' })).toBe(2);
  });

  it('accounts.delete: only when other accounts hold rows in its categories', async () => {
    const loan = await services.accounts.createAccount(
      'Mortgage',
      budgetId,
      'mortgage',
      'USD',
      asMilli(0),
      {
        liability: true,
        debt_total: 1000,
      }
    );
    expect(await sentFormat('accounts.delete', { id: loan.ID })).toBe(2);
    expect(await sentFormat('accounts.delete', { id: savings })).toBe(2);
    const linked = JSON.parse(String(services.accounts.getAccount(loan.ID).Metadata))
      .linked_category_id as number;
    await addRow(checking, 300, linked);
    expect(await sentFormat('accounts.delete', { id: loan.ID })).toBe(3);
  });

  it('categories.delete / categoryGroups.delete: only when they hold transactions', async () => {
    const group = services.categories.getCategory(rent).CategoryGroupID;
    expect(await sentFormat('categories.delete', { id: rent })).toBe(2);
    expect(await sentFormat('categoryGroups.delete', { id: group })).toBe(2);
    await addRow(checking, 300, rent);
    expect(await sentFormat('categories.delete', { id: rent })).toBe(3);
    expect(await sentFormat('categoryGroups.delete', { id: group })).toBe(3);
  });

  it('rules.execute: amount / account actions with split parents among the candidates', async () => {
    const amountRule = services.rules.createRule({
      budgetId,
      name: 'amount',
      conditions: [],
      actions: [{ type: 'amount.set', payload: { amount: 1 } }],
    });
    const categoryRule = services.rules.createRule({
      budgetId,
      name: 'category',
      conditions: [],
      actions: [{ type: 'category.set', payload: { categoryId: rent } }],
    });
    const plain = await addRow(checking, 500);
    expect(await sentFormat('rules.execute', { ruleId: amountRule.id })).toBe(2);
    const parent = await addCategorySplit();
    expect(await sentFormat('rules.execute', { ruleId: amountRule.id })).toBe(3);
    expect(await sentFormat('rules.execute', { ruleId: categoryRule.id })).toBe(2);
    expect(
      await sentFormat('rules.execute', {
        ruleId: amountRule.id,
        options: { transactionIds: [plain] },
      })
    ).toBe(2);
    expect(
      await sentFormat('rules.execute', {
        ruleId: amountRule.id,
        options: { transactionIds: [parent] },
      })
    ).toBe(3);
  });
});

describe('format 2: v1.18 applies these the same way', () => {
  it.each([
    // Same rows and IDs; the new code only commits them in one DB transaction (A10/A11).
    [
      'transactions.add',
      () => ({
        accountId: checking,
        budgetId,
        date: '2026-09-10',
        outflow: 100,
        splits: [{ categoryId: groceries, outflow: 100 }],
      }),
    ],
    [
      'transactions.addTransfer',
      () => ({
        budgetId,
        transferId: 'tr-x',
        source: { accountId: checking },
        destination: { accountId: savings },
      }),
    ],
    ['transactions.reconcileCleared', () => ({ accountId: checking })],
    ['transactions.restoreBatch', () => ({ snapshots: [] })],
    // v1.18 already honours a passed id (A14 only fills it in).
    ['customDashboards.create', () => ({ budgetId, name: 'D' })],
    ['customDashboardWidgets.add', () => ({ dashboardId: 'd', type: 'x' })],
    ['scenarios.save', () => ({ budgetId, name: 'S', payload: '{}' })],
    // Only their undo changed (it is a format-3 op of its own).
    ['categories.create', () => ({ groupId: 1, budgetId, name: 'C' })],
    ['categoryGroups.create', () => ({ budgetId, name: 'G' })],
    // Same writes in the same order, now in one transaction (A9).
    ['accounts.create', () => ({ name: 'A', budgetId, type: 'checking', currency: 'USD' })],
    // Same execute, same core code (bookkeeping timestamps only).
    ['transactions.updateByRef', () => ({ messageId: 'm' })],
    ['labels.delete', () => ({ id: 1, budgetId })],
    ['payees.delete', () => ({ budgetId, name: 'P' })],
    [
      'monthlyBudgets.upsertAssignment',
      () => ({ categoryId: groceries, month: '2026-09', amount: 1 }),
    ],
  ])('%s', async (op, args) => {
    const prepared = withLegacyFormat(op, args());
    expect(prepared).not.toHaveProperty(REQUIRES_FORMAT_ARG);
    expect(mutationFormatVersion(op, prepared)).toBe(2);
  });
});

describe('follow-up audit decisions', () => {
  /** Leave a stored balance off from its rows (what an older build's A3 bug left). */
  const drift = (accountId: number, by = 7) =>
    sql(
      `UPDATE accounts SET BalanceNative = BalanceNative + ?,
         BalanceConverted = COALESCE(BalanceConverted, BalanceNative) + ? WHERE ID = ?`,
      by,
      by,
      accountId
    );

  it('budgets.updateCurrency: a no-op is marked as one and stays format 2', async () => {
    const args = await prepareMutationArgs('budgets.updateCurrency', {
      id: budgetId,
      currency: 'USD',
    });
    expect(args.fromCurrency).toBe('USD');
    expect(mutationFormatVersion('budgets.updateCurrency', args)).toBe(2);
    const repair = vi.spyOn(services.currency, 'repairBudgetCurrencyChange');
    await executeMutationOp('budgets.updateCurrency', args, { isReceiver: true } as never);
    expect(repair).not.toHaveBeenCalled();
  });

  it('transactions.upsertSplits: transfer lines into an account whose balance drifted', async () => {
    const parent = await addRow(checking, 10000);
    const lines = [
      { category_id: groceries, outflow: 6000 },
      { transfer_account_id: savings, outflow: 4000 },
    ];
    expect(
      await sentFormat('transactions.upsertSplits', { transactionId: parent, splits: lines })
    ).toBe(2);
    drift(savings);
    expect(
      await sentFormat('transactions.upsertSplits', { transactionId: parent, splits: lines })
    ).toBe(3);
    drift(checking);
    drift(savings, -7);
    // Only the mirror accounts are recalculated in full.
    expect(
      await sentFormat('transactions.upsertSplits', { transactionId: parent, splits: lines })
    ).toBe(2);
  });

  it('transactions.add: transfer split lines into an account whose balance drifted', async () => {
    const args = {
      accountId: checking,
      budgetId,
      date: '2026-09-10',
      outflow: 10000,
      splits: [
        { categoryId: groceries, outflow: 6000 },
        { transferAccountId: savings, outflow: 4000 },
      ],
    };
    expect(await sentFormat('transactions.add', args)).toBe(2);
    drift(savings);
    expect(await sentFormat('transactions.add', args)).toBe(3);
  });

  it('transactions.duplicate: copies of split transfers into a drifted account', async () => {
    const { parent } = await addTransferSplit();
    const plain = await addRow(checking, 500);
    expect(await sentFormat('transactions.duplicate', { ids: [parent] })).toBe(2);
    drift(savings);
    expect(await sentFormat('transactions.duplicate', { ids: [parent] })).toBe(3);
    expect(await sentFormat('transactions.duplicate', { ids: [plain] })).toBe(2);
  });

  it('currency.customRates.*: split lines already out of step in any account', async () => {
    const parent = await addCategorySplit();
    const args = {
      id: 1,
      budgetId,
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rate: 1.1,
      startDate: '2026-01-01',
    };
    expect(await sentFormat('currency.customRates.update', args)).toBe(2);
    sql(
      'UPDATE transaction_splits SET OutflowConverted = OutflowConverted + 1 WHERE TransactionID = ?',
      parent
    );
    expect(await sentFormat('currency.customRates.add', args)).toBe(3);
    expect(await sentFormat('currency.customRates.update', args)).toBe(3);
    expect(await sentFormat('currency.customRates.delete', args)).toBe(3);
  });

  it('accounts.update: metadata passed as a JSON string is read too', async () => {
    const loan = await services.accounts.createAccount(
      'Loan',
      budgetId,
      'loan',
      'USD',
      asMilli(0),
      { liability: true, debt_total: 1000 }
    );
    const stored = JSON.parse(String(services.accounts.getAccount(loan.ID).Metadata));
    expect(
      await sentFormat('accounts.update', {
        id: loan.ID,
        name: 'Loan',
        type: 'loan',
        currency: 'USD',
        budgetId,
        metadata: JSON.stringify({ ...stored, debt_total: 3000 }),
      })
    ).toBe(3);
  });
});

describe('deleteDiffersFromLegacy (set-based)', () => {
  /** The rows v1.18's getTransactionsForDelete removes. */
  const legacySet = (ids: number[]) => {
    const rows = ids.map((id) => services.transactions.getTransactionByID(id)).filter(Boolean);
    const keys = rows
      .map(
        (row) =>
          row.TransferID ||
          (services.splits.getSplits(row.ID).some((line) => line.TransferAccountID)
            ? `split_transfer_${row.ID}_${row.Date}`
            : undefined)
      )
      .filter((key): key is string => Boolean(key));
    const partners = keys.flatMap((key) => services.transactions.getTransactionsByTransferID(key));
    return new Set([...rows, ...partners].map((row) => row.ID));
  };
  const currentSet = (ids: number[]) =>
    new Set(services.transactions.getTransactionsForDelete(ids).map((row) => row.ID));
  const differs = (ids: number[]) => {
    const [a, b] = [legacySet(ids), currentSet(ids)];
    return a.size !== b.size || [...a].some((id) => !b.has(id));
  };

  it('agrees with comparing both delete sets row by row', async () => {
    const { parent, mirror } = await addTransferSplit();
    const old = await addTransferSplit('2026-09-05');
    sql('UPDATE transactions SET Date = ? WHERE ID = ?', '2026-09-06', old.parent);
    const category = await addCategorySplit();
    const plain = await addRow(checking, 500);
    const orphan = await addTransferSplit('2026-09-03');
    sql('DELETE FROM transactions WHERE ID = ?', orphan.parent);
    const cases = [
      [plain],
      [parent],
      [mirror],
      [parent, mirror],
      [old.parent],
      [old.mirror],
      [category],
      [orphan.mirror],
      [plain, category, parent],
      [plain, mirror],
    ];
    for (const ids of cases) {
      expect(services.legacyReplay.deleteDiffersFromLegacy(ids), JSON.stringify(ids)).toBe(
        differs(ids)
      );
    }
    expect(services.legacyReplay.deleteDiffersFromLegacy([parent, mirror])).toBe(false);
    expect(services.legacyReplay.deleteDiffersFromLegacy([orphan.mirror])).toBe(false);
  });

  it('runs a handful of queries for a large selection', async () => {
    const ids: number[] = [];
    for (let index = 0; index < 1200; index++) ids.push(await addRow(checking, 1));
    const prepare = vi.spyOn(adapter, 'prepare');
    expect(services.legacyReplay.deleteDiffersFromLegacy(ids)).toBe(false);
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('rules.execute and empty payees', () => {
  it("stamps format 3 when a candidate row stores Payee '' (v1.18 wrote NULL)", async () => {
    const rule = services.rules.createRule({
      budgetId,
      name: 'category',
      conditions: [],
      actions: [{ type: 'category.set', payload: { categoryId: rent } }],
    });
    const named = await addRow(checking, 500);
    sql("UPDATE transactions SET Payee = 'Shop' WHERE ID = ?", named);
    const blank = await addRow(checking, 700);
    sql("UPDATE transactions SET Payee = 'Cafe' WHERE ID = ?", blank);
    expect(await sentFormat('rules.execute', { ruleId: rule.id })).toBe(2);
    sql("UPDATE transactions SET Payee = '' WHERE ID = ?", blank);
    expect(await sentFormat('rules.execute', { ruleId: rule.id })).toBe(3);
    const only = (ids: number[]) =>
      sentFormat('rules.execute', { ruleId: rule.id, options: { transactionIds: ids } });
    expect(await only([named])).toBe(2);
    expect(await only([named, blank])).toBe(3);
    sql('UPDATE transactions SET Payee = NULL WHERE ID = ?', blank);
    expect(await only([blank])).toBe(2);
  });
});
