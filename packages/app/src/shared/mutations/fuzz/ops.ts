/**
 * Seed dataset and random op generator for the op-level integrity fuzz.
 *
 * fast-check generates abstract intents (an op kind plus a few integers), and
 * `realize` turns an intent into the `{ op, payload }` a UI hook would send,
 * picking real IDs from the device's current state (index modulo the list).
 * Payload shapes follow the hooks that send them (e.g. dashboards and
 * scenarios are created without an ID, reports with a client-generated one).
 */
import fc from 'fast-check';
import { Device, ids, rows } from './harness';

// ------------------------------------------------------------------ dates

const BASE_YEAR = 2026;
const BASE_MONTH = 6; // 2026-06 .. 2027-01
const MONTHS = 8;

export function monthOf(offset: number): string {
  const total = BASE_YEAR * 12 + BASE_MONTH - 1 + (offset % MONTHS);
  const y = Math.floor(total / 12);
  return `${y}-${String(total - y * 12 + 1).padStart(2, '0')}`;
}

export const dateOf = (m: number, d: number) =>
  `${monthOf(m)}-${String((d % 28) + 1).padStart(2, '0')}`;

// ------------------------------------------------------------------ seed

/**
 * Builds the shared starting dataset through the same op path (so both
 * devices of invariant 6 start from byte-identical copies, IDs included).
 */
export async function seedDataset(device: Device): Promise<void> {
  const op = <T = unknown>(name: string, payload: Record<string, unknown>) =>
    device.local<T>(name, payload);
  await device.run(async () => {
    const budgetId = await device.services.budgets.createBudget({
      name: 'Fuzz',
      space_id: 'space-fuzz',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    device.services.currency.saveManualRate('EUR', 'USD', 1.1, budgetId);
    for (let m = 0; m < MONTHS; m++)
      for (const d of [0, 7, 14, 21]) {
        const date = dateOf(m, d);
        device.services.currency.saveRate('EUR', 'USD', 1 + ((m + d) % 7) / 40, date, budgetId);
        device.services.currency.saveRate(
          'USD',
          'EUR',
          1 / (1 + ((m + d) % 7) / 40),
          date,
          budgetId
        );
      }
  });
  const budgetId = ids(device, 'SELECT ID FROM budgets')[0]!;
  const start = dateOf(0, 0);
  const account = async (
    name: string,
    type: string,
    currency: string,
    balance: number,
    onBudget = true
  ) =>
    (
      await op<{ ID: number }>('accounts.create', {
        name,
        budgetId,
        type,
        currency,
        balance,
        onBudget,
        initialBalanceDate: start,
      })
    ).ID;
  const chk = await account('Checking', 'checking', 'USD', 3_000_000);
  const sav = await account('Savings', 'savings', 'USD', 1_000_000);
  const eur = await account('Euro', 'checking', 'EUR', 800_000);
  const cc = await account('Card', 'credit', 'USD', -200_000);
  const off = await account('Tracking', 'savings', 'USD', 5_000_000, false);
  await account('Loan', 'loan', 'USD', -4_000_000);

  const g1 = await op<number>('categoryGroups.create', { name: 'Bills', budgetId });
  const g2 = await op<number>('categoryGroups.create', { name: 'Life', budgetId });
  const cats: number[] = [];
  for (const [i, name] of ['Rent', 'Power', 'Food', 'Fun', 'Gifts'].entries()) {
    cats.push(
      await op<number>('categories.create', {
        parentId: i < 2 ? g1 : g2,
        budgetId,
        name,
        note: '',
      })
    );
  }
  for (let m = 0; m < 5; m++)
    for (const [i, c] of cats.entries())
      await op('monthlyBudgets.upsertAssignment', {
        categoryId: c,
        amount: (i + 1) * 100_000,
        month: monthOf(m),
        budgetId,
      });
  await op('payees.add', { budgetId, name: 'Grocer' });
  await op('payees.add', { budgetId, name: 'Landlord' });
  const label = await op<number>('labels.add', { budgetId, name: 'Work', color: '#ff0000' });
  const txs: number[] = [];
  for (let i = 0; i < 8; i++) {
    txs.push(
      await op<number>('transactions.add', {
        budgetId,
        accountId: [chk, cc, eur, sav][i % 4],
        categoryId: cats[i % cats.length],
        date: dateOf(i, i * 3),
        memo: i % 3 === 0 ? 'coffee beans' : `seed ${i}`,
        payee: i % 2 ? 'Grocer' : 'Landlord',
        inflow: 0,
        outflow: (i + 1) * 12_340,
        labelId: i === 2 ? label : null,
      })
    );
  }
  await op('transactions.add', {
    budgetId,
    accountId: chk,
    date: dateOf(3, 9),
    memo: 'split seed',
    payee: 'Grocer',
    inflow: 0,
    outflow: 90_000,
    splits: [
      { categoryId: cats[2], outflow: 50_000 },
      { categoryId: cats[3], outflow: 40_000 },
    ],
  });
  const transfersCat = transfersCategory(device, budgetId);
  await op('transactions.addTransfer', {
    budgetId,
    transferId: 'seed-transfer',
    source: {
      accountId: chk,
      categoryId: transfersCat,
      date: dateOf(2, 4),
      memo: 'move',
      payee: '',
      inflow: 0,
      outflow: 150_000,
    },
    destination: {
      accountId: sav,
      categoryId: transfersCat,
      date: dateOf(2, 4),
      memo: 'move',
      payee: '',
      inflow: 150_000,
      outflow: 0,
    },
  });
  await op('transactions.import', {
    inflow: 0,
    outflow: 25_000,
    accountId: chk,
    categoryId: cats[2],
    budgetId,
    date: dateOf(4, 2),
    memo: 'imported',
    payee: 'Grocer',
    transferId: '',
    importIdentities: [identity('seed-op-1', dateOf(4, 2), 25_000, 'USD')],
  });
  await op('goals.create', {
    goalType: 'monthly',
    categoryId: cats[2],
    target: 300_000,
    startDate: dateOf(0, 0),
    endDate: '',
    purpose: 'spending',
    recurring: false,
    cycleMonths: null,
  });
  await op('recurring.create', {
    input: {
      budgetId,
      accountId: chk,
      categoryId: cats[0],
      name: 'Rent',
      memo: 'rent',
      amount: 900_000,
      direction: 'outflow',
      schedule: { startDate: dateOf(1, 0), intervalUnit: 'month', intervalCount: 1 },
      notifyDaysBefore: 3,
    },
  });
  await op('recurring.create', {
    input: {
      budgetId,
      accountId: chk,
      toAccountId: sav,
      categoryId: null,
      name: 'Save',
      memo: 'save',
      amount: 100_000,
      direction: 'outflow',
      schedule: { startDate: dateOf(2, 14), intervalUnit: 'month', intervalCount: 1 },
      notifyDaysBefore: 0,
    },
  });
  await op('rules.create', {
    input: {
      budgetId,
      name: 'Coffee',
      conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
      actions: [{ type: 'category.set', payload: { categoryId: cats[2] } }],
      mode: 'continuous',
      enabled: true,
      runOrder: 0,
    },
  });
  await op('rules.create', {
    input: {
      budgetId,
      name: 'Tidy',
      conditions: [{ field: 'payee', operator: 'equals', value: 'Grocer' }],
      actions: [{ type: 'memo.set', payload: { memo: 'groceries' } }],
      mode: 'one_time',
      enabled: true,
      runOrder: 1,
    },
  });
  const report = await op<{ id: string; charts: { id: string }[] }>('reports.create', {
    id: 'seed-report',
    name: 'Spending',
    description: '',
    query: 'SELECT 1 AS x, 2 AS y',
    charts: [chart('seed-chart-1', 'bar'), chart('seed-chart-2', 'line')],
    tags: [],
    isFavorite: false,
  });
  const dashboard = await op<{ id: string }>('customDashboards.create', {
    id: 'seed-dashboard',
    budgetId,
    name: 'Home',
  });
  await op('customDashboardWidgets.add', {
    id: 'seed-widget',
    dashboardId: dashboard.id,
    reportId: report.id,
    chartId: report.charts[0]!.id,
  });
  await op('bankSync.addReviews', {
    budgetId,
    reviews: [
      {
        budgetId,
        accountId: chk,
        identity: identity('seed-review-1', dateOf(4, 5), 31_000, 'USD'),
        candidateTransactionId: txs[1],
      },
    ],
  });
  await op('scenarios.save', { id: 'seed-scenario', budgetId, name: 'Plan', payload: '{}' });
  await op('warranties.create', {
    budgetId,
    name: 'Laptop',
    expiresAt: '2028-01-01',
    amount: 1_200_000,
    transactionId: txs[0],
  });
  await op('currency.customRates.add', {
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    rate: 1.2,
    startDate: dateOf(5, 0),
    endDate: dateOf(5, 27),
    budgetId,
  });
  void off;
  device.clearUndo();
  device.outbox.length = 0;
}

function chart(id: string, chartType: string) {
  return { id, chartType, title: id, xAxisColumn: 'x', yAxisColumn: 'y', aggregateFunction: 'SUM' };
}

function identity(operationId: string, date: string, outflow: number, currency: string) {
  return {
    operationId,
    fileRowKey: `row:${operationId}`,
    date,
    inflow: 0,
    outflow,
    payee: 'Grocer',
    memo: 'imported',
    currency,
  };
}

function transfersCategory(device: Device, budgetId: number): number {
  return (
    ids(
      device,
      "SELECT ID FROM categories WHERE BudgetID = ? AND Name = 'Transfers'",
      budgetId
    )[0] ?? 0
  );
}

// ------------------------------------------------------------------ intents

/** Op kinds the generator produces, with weights. `k` is usually the op code. */
const KINDS: [string, number][] = [
  // transactions
  ['transactions.add', 10],
  ['transactions.add#split', 3],
  ['transactions.import', 3],
  ['transactions.addTransfer', 4],
  ['transactions.updateTransferRate', 2],
  ['transactions.deleteTransfer', 2],
  ['transactions.updateColumn', 10],
  ['transactions.delete', 5],
  ['transactions.deleteBatch', 2],
  ['transactions.moveToNewCategory', 3],
  ['transactions.moveToNewAccount', 3],
  ['transactions.reconcile', 1],
  ['transactions.reconcileCleared', 2],
  ['transactions.setCleared', 3],
  ['transactions.duplicate', 2],
  ['transactions.upsertSplits', 3],
  ['transactions.clearSplits', 2],
  ['transactions.saveSplits', 3],
  ['transactions.batchEdit', 3],
  ['transactions.reassign', 1],
  // payees / labels
  ['payees.add', 1],
  ['payees.rename', 2],
  ['payees.delete', 1],
  ['payees.deleteMany', 1],
  ['labels.add', 1],
  ['labels.update', 1],
  ['labels.delete', 1],
  // recurring
  ['recurring.create', 2],
  ['recurring.update', 2],
  ['recurring.markReady', 4],
  ['recurring.skip', 2],
  ['recurring.delete', 1],
  // rules
  ['rules.create', 1],
  ['rules.update', 1],
  ['rules.delete', 1],
  ['rules.execute', 2],
  // categories
  ['categories.updateFundingPriorities', 1],
  ['categories.updateDetails', 1],
  ['categoryGroups.create', 1],
  ['categoryGroups.update', 1],
  ['categoryGroups.delete', 1],
  ['categories.create', 2],
  ['categories.updateName', 1],
  ['categories.updateNote', 1],
  ['categories.updateExcludeFromBudgetPace', 1],
  ['categories.delete', 1],
  ['categories.deleteAndReassign', 2],
  ['categoryGroups.deleteAndReassign', 1],
  ['categories.moveToNewGroup', 1],
  ['categoryGroups.reorder', 1],
  ['categories.reorder', 1],
  // accounts
  ['accounts.create', 2],
  ['accounts.createLinked', 1],
  ['accounts.update', 2],
  ['accounts.reorder', 1],
  ['accounts.setArchived', 1],
  ['accounts.delete', 1],
  // assignments / goals
  ['monthlyBudgets.upsertAssignment', 6],
  ['monthlyBudgets.batchUpsertAssignments', 2],
  ['monthlyBudgets.updateAssignment', 2],
  ['monthlyBudgets.reassignAssignment', 1],
  ['goals.create', 1],
  ['goals.update', 1],
  ['goals.delete', 1],
  // reports / dashboards / scenarios
  ['reports.create', 1],
  ['reports.update', 1],
  ['reports.delete', 1],
  ['reports.toggleFavorite', 1],
  ['reports.addChart', 1],
  ['reports.updateChart', 1],
  ['reports.removeChart', 1],
  ['reports.duplicate', 1],
  ['customDashboards.create', 2],
  ['customDashboards.update', 1],
  ['customDashboards.delete', 1],
  ['customDashboards.reorder', 1],
  ['customDashboardWidgets.add', 2],
  ['customDashboardWidgets.update', 1],
  ['customDashboardWidgets.delete', 1],
  ['customDashboardWidgets.reorder', 1],
  ['scenarios.save', 2],
  ['scenarios.delete', 1],
  // currency / warranties
  ['currency.customRates.add', 1],
  ['currency.customRates.update', 1],
  ['currency.customRates.delete', 1],
  ['warranties.create', 1],
  ['warranties.update', 1],
  ['warranties.delete', 1],
  // imports
  ['importHistory.record', 1],
  ['importHistory.undo', 1],
  ['importHistory.match', 1],
  ['bankSync.setReviewStatus', 2],
  // preferences / budget settings
  ['userPreferences.setDuplicateHintSettings', 1],
  ['userPreferences.setWeekStartsOn', 1],
  ['userPreferences.setAllowOverAssignment', 1],
  ['userPreferences.setSuggestCategoryFromPayee', 1],
  ['userPreferences.setShowGroupPercent', 1],
  ['userPreferences.setPlanningNumberAnimations', 1],
  ['userPreferences.setDialogBackgroundBlur', 1],
  ['userPreferences.setHideZeroAmounts', 1],
  ['userPreferences.setInlineTransactionEntry', 1],
  ['userPreferences.setCompactTransactionRows', 1],
  ['userPreferences.setSameDayTransactionOrder', 1],
  ['budgets.updateGoalFundingSettings', 1],
  ['budgets.updateName', 1],
  ['budgets.updateIcon', 1],
  ['budgets.updateNumberFormat', 1],
  ['budgets.updateRtaMode', 2],
];

export const OP_KINDS = KINDS.map(([k]) => k);

const nat = (max: number) => fc.integer({ min: 0, max });

export const intentArb = fc.record({
  k: fc.oneof(...KINDS.map(([k, weight]) => ({ weight, arbitrary: fc.constant(k) }))),
  a: nat(999),
  b: nat(999),
  c: nat(999),
  d: nat(999),
  f: fc.boolean(),
  g: fc.boolean(),
});
export type Intent = typeof intentArb extends fc.Arbitrary<infer T> ? T : never;

/** Op code an intent kind sends (kinds may carry a `#variant`). */
export const opCodeOf = (kind: string) => kind.split('#')[0]!;

export interface OpCall {
  op: string;
  payload: Record<string, unknown>;
}

const pick = <T>(list: T[], index: number): T | undefined =>
  list.length ? list[index % list.length] : undefined;

const amountOf = (n: number) => ((n % 5000) + 1) * 10;

let uniqueCounter = 0;
/** Deterministic per-intent unique string (client-generated IDs). */
const uid = (prefix: string, intent: Intent) =>
  `${prefix}-${intent.a}-${intent.b}-${intent.c}-${intent.d}-${(uniqueCounter += 1)}`;

export function resetUniqueCounter(): void {
  uniqueCounter = 0;
}

/** Turns an intent into the payload the app would send, or null when it doesn't apply. */
export function realize(device: Device, intent: Intent): OpCall | null {
  const { a, b, c, d, f, g } = intent;
  const budgetId = ids(device, 'SELECT ID FROM budgets ORDER BY ID')[0]!;
  const accounts = rows<{
    ID: number;
    Currency: string;
    Type: string;
    OnBudget: number;
    Archived: number;
  }>(
    device,
    'SELECT ID, Currency, Type, OnBudget, Archived FROM accounts WHERE BudgetID = ? ORDER BY ID',
    budgetId
  );
  const openAccounts = accounts.filter((acc) => !acc.Archived);
  const accountIds = openAccounts.map((acc) => acc.ID);
  const cats = ids(device, 'SELECT ID FROM categories WHERE BudgetID = ? ORDER BY ID', budgetId);
  const userCats = ids(
    device,
    `SELECT c.ID FROM categories c JOIN category_groups g ON g.ID = c.CategoryGroupID
      WHERE c.BudgetID = ? AND g.Name IN ('Bills', 'Life', 'More') ORDER BY c.ID`,
    budgetId
  );
  const groups = ids(
    device,
    'SELECT ID FROM category_groups WHERE BudgetID = ? ORDER BY ID',
    budgetId
  );
  const txs = ids(device, 'SELECT ID FROM transactions WHERE BudgetID = ? ORDER BY ID', budgetId);
  const plainTxs = ids(
    device,
    "SELECT ID FROM transactions WHERE BudgetID = ? AND (TransferID IS NULL OR TransferID = '') ORDER BY ID",
    budgetId
  );
  const transfers = rows<{ TransferID: string }>(
    device,
    `SELECT DISTINCT TransferID FROM transactions WHERE BudgetID = ? AND TransferID != ''
       AND TransferID NOT LIKE 'split_transfer_%' ORDER BY TransferID`,
    budgetId
  ).map((r) => r.TransferID);
  const date = dateOf(b, c);
  const amount = amountOf(a);
  const transfersCat = transfersCategory(device, budgetId);
  const { k } = intent;

  switch (k) {
    case 'transactions.add': {
      const acc = pick(openAccounts, b);
      if (!acc) return null;
      return {
        op: k,
        payload: {
          budgetId,
          accountId: acc.ID,
          categoryId: d % 11 === 10 ? 0 : pick(cats, d),
          date,
          memo: f ? 'coffee run' : `memo ${a}`,
          payee: g ? 'Grocer' : `Payee ${d % 4}`,
          inflow: d % 5 === 0 ? amount : 0,
          outflow: d % 5 === 0 ? 0 : amount,
          labelId: d % 7 === 0 ? (ids(device, 'SELECT ID FROM labels')[0] ?? null) : null,
          ...(acc.Currency !== 'USD' && f ? { exchangeRateOverride: 1 + (a % 20) / 100 } : {}),
        },
      };
    }
    case 'transactions.add#split': {
      const acc = pick(openAccounts, b);
      if (!acc) return null;
      const first = Math.max(10, Math.floor(amount / 2));
      const second = amount - first;
      const transferTo = g
        ? pick(
            accountIds.filter((id) => id !== acc.ID),
            d
          )
        : undefined;
      return {
        op: 'transactions.add',
        payload: {
          budgetId,
          accountId: acc.ID,
          date,
          memo: 'split',
          payee: 'Grocer',
          inflow: 0,
          outflow: amount,
          splits: [
            { categoryId: pick(userCats, d), outflow: first },
            transferTo && second > 0
              ? { transferAccountId: transferTo, outflow: second }
              : { categoryId: pick(userCats, d + 1), outflow: second },
          ],
        },
      };
    }
    case 'transactions.import': {
      const acc = pick(openAccounts, b);
      if (!acc) return null;
      const existing = rows<{ OperationID: string }>(
        device,
        'SELECT OperationID FROM import_provenance ORDER BY ID'
      );
      const operationId =
        f && existing.length ? pick(existing, d)!.OperationID : uid('imp', intent);
      return {
        op: k,
        payload: {
          inflow: 0,
          outflow: amount,
          accountId: acc.ID,
          categoryId: pick(cats, d),
          budgetId,
          date,
          memo: 'imported',
          payee: 'Grocer',
          transferId: '',
          importIdentities: [identity(operationId, date, amount, acc.Currency)],
        },
      };
    }
    case 'transactions.addTransfer': {
      const from = pick(openAccounts, b);
      const to = pick(
        openAccounts.filter((acc) => acc.ID !== from?.ID),
        d
      );
      if (!from || !to) return null;
      const destinationAmount = from.Currency === to.Currency ? amount : Math.round(amount * 1.1);
      return {
        op: k,
        payload: {
          budgetId,
          transferId: uid('tr', intent),
          source: {
            accountId: from.ID,
            categoryId: transfersCat,
            date,
            memo: 'xfer',
            payee: '',
            inflow: 0,
            outflow: amount,
          },
          destination: {
            accountId: to.ID,
            categoryId: transfersCat,
            date,
            memo: 'xfer',
            payee: '',
            inflow: destinationAmount,
            outflow: 0,
          },
        },
      };
    }
    case 'transactions.updateTransferRate': {
      const transferId = pick(transfers, a);
      return transferId
        ? { op: k, payload: { transferId, rate: 0.8 + (b % 40) / 100, transferRateOverride: true } }
        : null;
    }
    case 'transactions.deleteTransfer': {
      const transferId = pick(transfers, a);
      return transferId ? { op: k, payload: { transferId } } : null;
    }
    case 'transactions.updateColumn': {
      let id = pick(txs, a);
      if (!id) return null;
      const column = pick(
        [
          'Memo',
          'Payee',
          'Date',
          'CategoryID',
          'InflowNative',
          'OutflowNative',
          'LabelID',
          'AccountID',
          'ExchangeRate',
        ],
        b
      )!;
      const value: Record<string, unknown> = {
        Memo: f ? 'coffee' : `edited ${c}`,
        Payee: g ? 'Grocer' : `P${c % 3}`,
        Date: date,
        CategoryID: pick(cats, c),
        InflowNative: d % 3 ? 0 : amount,
        OutflowNative: d % 3 ? amount : 0,
        LabelID: f ? (ids(device, 'SELECT ID FROM labels')[0] ?? null) : null,
        AccountID: pick(accountIds, c),
        ExchangeRate: 0.9 + (c % 30) / 100,
      };
      if (column === 'ExchangeRate') {
        // The rate cell is only editable on foreign-currency rows.
        id = pick(
          ids(
            device,
            "SELECT t.ID FROM transactions t JOIN accounts acc ON acc.ID = t.AccountID WHERE acc.Currency != 'USD' AND (t.TransferID IS NULL OR t.TransferID = '') ORDER BY t.ID"
          ),
          a
        );
        if (!id) return null;
      }
      return { op: k, payload: { id, columnName: column, newValue: value[column] } };
    }
    case 'transactions.delete': {
      const id = pick(txs, a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'transactions.deleteBatch': {
      if (!txs.length) return null;
      const chosen = [...new Set([pick(txs, a)!, pick(txs, b)!, ...(f ? [pick(txs, c)!] : [])])];
      return { op: k, payload: { ids: chosen } };
    }
    case 'transactions.moveToNewCategory': {
      const id = pick(plainTxs, a);
      return id ? { op: k, payload: { transactionId: id, newCategoryId: pick(cats, b) } } : null;
    }
    case 'transactions.moveToNewAccount': {
      const id = pick(plainTxs, a);
      return id
        ? { op: k, payload: { transactionId: id, newAccountId: pick(accountIds, b) } }
        : null;
    }
    case 'transactions.reconcile': {
      const accountId = pick(accountIds, a);
      return accountId ? { op: k, payload: { accountId, reconcileDate: date } } : null;
    }
    case 'transactions.reconcileCleared': {
      const accountId = pick(accountIds, a);
      if (!accountId) return null;
      return {
        op: k,
        payload: {
          accountId,
          reconcileDate: date,
          ...(f
            ? {
                adjustment: {
                  inflow: 0,
                  outflow: amount,
                  categoryId: pick(cats, d),
                  budgetId,
                  date,
                  memo: 'Reconciliation adjustment',
                  payee: '',
                  accountId,
                },
              }
            : {}),
        },
      };
    }
    case 'transactions.setCleared': {
      if (!txs.length) return null;
      return {
        op: k,
        payload: { ids: [...new Set([pick(txs, a)!, pick(txs, b)!])], cleared: f },
      };
    }
    case 'transactions.duplicate': {
      const id = pick(txs, a);
      if (!id) return null;
      const tid = rows<{ TransferID: string | null }>(
        device,
        'SELECT TransferID FROM transactions WHERE ID = ?',
        id
      )[0]?.TransferID;
      return {
        op: k,
        payload: { ids: [id], transferIds: tid ? { [tid]: uid('dup', intent) } : {} },
      };
    }
    case 'transactions.upsertSplits': {
      const id = pick(plainTxs, a);
      if (!id) return null;
      const parent = rows<{ OutflowConverted: number; InflowConverted: number; AccountID: number }>(
        device,
        'SELECT OutflowConverted, InflowConverted, AccountID FROM transactions WHERE ID = ?',
        id
      )[0]!;
      const out = Number(parent.OutflowConverted);
      const inn = Number(parent.InflowConverted);
      const firstOut = Math.floor(out / 2);
      const firstIn = Math.floor(inn / 2);
      const transferTo = g
        ? pick(
            accountIds.filter((acc) => acc !== parent.AccountID),
            d
          )
        : undefined;
      return {
        op: k,
        payload: {
          transactionId: id,
          splits: [
            {
              CategoryID: pick(userCats, b),
              Memo: 'a',
              OutflowConverted: firstOut,
              InflowConverted: firstIn,
            },
            transferTo
              ? {
                  TransferAccountID: transferTo,
                  Memo: 'b',
                  OutflowConverted: out - firstOut,
                  InflowConverted: inn - firstIn,
                }
              : {
                  CategoryID: pick(userCats, c),
                  Memo: 'b',
                  OutflowConverted: out - firstOut,
                  InflowConverted: inn - firstIn,
                },
          ],
        },
      };
    }
    case 'transactions.saveSplits': {
      // useSaveSplits: snake_case lines in the parent's converted currency,
      // plus a new parent total when the editor changed it.
      const id = pick(plainTxs, a);
      if (!id) return null;
      const parent = rows<{ OutflowConverted: number; InflowConverted: number; AccountID: number }>(
        device,
        'SELECT OutflowConverted, InflowConverted, AccountID FROM transactions WHERE ID = ?',
        id
      )[0]!;
      const total = f ? amount : Number(parent.OutflowConverted) + Number(parent.InflowConverted);
      const inflow = !f && Number(parent.InflowConverted) > 0;
      const first = Math.floor(total / 2);
      const transferTo = g
        ? pick(
            accountIds.filter((acc) => acc !== parent.AccountID),
            d
          )
        : undefined;
      const line = (amt: number, extra: Record<string, unknown>, idx: number) => ({
        category_id: null,
        transfer_account_id: null,
        memo: `l${idx}`,
        payee: '',
        inflow: inflow ? amt : 0,
        outflow: inflow ? 0 : amt,
        inflow_original: null,
        outflow_original: null,
        order_index: idx,
        ...extra,
      });
      return {
        op: k,
        payload: {
          transactionId: id,
          splits: [
            line(first, { category_id: pick(userCats, b) }, 0),
            line(
              total - first,
              transferTo ? { transfer_account_id: transferTo } : { category_id: pick(userCats, c) },
              1
            ),
          ],
          ...(f ? { amount: { inflow: 0, outflow: total, currency: 'converted' } } : {}),
        },
      };
    }
    case 'transactions.batchEdit': {
      if (!plainTxs.length) return null;
      const chosen = [
        ...new Set([pick(plainTxs, a)!, pick(plainTxs, b)!, ...(f ? [pick(plainTxs, c)!] : [])]),
      ];
      const field = d % 3;
      return {
        op: k,
        payload: {
          edits: chosen.map((id) =>
            field === 0
              ? { id, accountId: pick(accountIds, c) }
              : field === 1
                ? { id, categoryId: pick(userCats, c) }
                : { id, payee: g ? 'Grocer' : `Batch ${c % 3}` }
          ),
        },
      };
    }
    case 'transactions.clearSplits': {
      const split = ids(
        device,
        'SELECT DISTINCT TransactionID AS ID FROM transaction_splits ORDER BY TransactionID'
      );
      const id = pick(split, a);
      return id ? { op: k, payload: { transactionId: id } } : null;
    }
    case 'transactions.reassign': {
      const from = pick(userCats, a);
      const to = pick(userCats, b);
      return from && to && from !== to
        ? { op: k, payload: { newCategoryId: to, oldCategoryId: from } }
        : null;
    }
    case 'payees.add':
      return { op: k, payload: { budgetId, name: `Payee ${a % 6}` } };
    case 'payees.rename': {
      const names = payeeNames(device, budgetId);
      const oldName = pick(names, a);
      return oldName
        ? {
            op: k,
            payload: { budgetId, oldName, newName: f ? pick(names, b)! : `Renamed ${b % 5}` },
          }
        : null;
    }
    case 'payees.delete': {
      const name = pick(payeeNames(device, budgetId), a);
      return name ? { op: k, payload: { budgetId, name } } : null;
    }
    case 'payees.deleteMany': {
      const names = payeeNames(device, budgetId);
      if (!names.length) return null;
      return {
        op: k,
        payload: { budgetId, names: [...new Set([pick(names, a)!, pick(names, b)!])] },
      };
    }
    case 'labels.add':
      return {
        op: k,
        payload: { budgetId, name: `Label ${a % 5}`, color: f ? '#00ff00' : '#0000ff' },
      };
    case 'labels.update': {
      const id = pick(ids(device, 'SELECT ID FROM labels ORDER BY ID'), a);
      return id
        ? {
            op: k,
            payload: { id, budgetId, name: `Label ${b % 5}`, color: g ? '#123456' : '#654321' },
          }
        : null;
    }
    case 'labels.delete': {
      const id = pick(ids(device, 'SELECT ID FROM labels ORDER BY ID'), a);
      return id ? { op: k, payload: { id, budgetId } } : null;
    }
    case 'recurring.create': {
      const from = pick(openAccounts, a);
      if (!from) return null;
      const to = f
        ? pick(
            openAccounts.filter((acc) => acc.ID !== from.ID),
            b
          )
        : undefined;
      return {
        op: k,
        payload: {
          input: {
            budgetId,
            accountId: from.ID,
            toAccountId: to?.ID ?? null,
            categoryId: to ? null : pick(userCats, c),
            name: `Bill ${a % 9}`,
            memo: '',
            amount,
            direction: g && !to ? 'inflow' : 'outflow',
            schedule: {
              startDate: dateOf(b, c),
              intervalUnit: pick(['month', 'week', 'day', 'year'], d),
              intervalCount: 1 + (d % 2),
            },
            notifyDaysBefore: d % 4,
          },
        },
      };
    }
    case 'recurring.update': {
      const id = pick(ids(device, 'SELECT ID FROM recurring_transactions ORDER BY ID'), a);
      if (!id) return null;
      const patch = pick(
        [
          { amount },
          { memo: `m${b}` },
          { active: f },
          { schedule: { startDate: dateOf(b, c), intervalUnit: 'month', intervalCount: 1 } },
          { categoryId: pick(userCats, c) },
        ],
        d
      );
      return { op: k, payload: { id, patch } };
    }
    case 'recurring.markReady':
    case 'recurring.skip': {
      const occ = pick(
        rows<{ ID: number; RecurringTransactionID: number; DueDate: string }>(
          device,
          `SELECT o.ID, o.RecurringTransactionID, o.DueDate FROM recurring_transaction_occurrences o
            JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
            WHERE o.Status = 'scheduled' AND o.DueDate <= '2027-03-31' ORDER BY o.DueDate, o.RecurringTransactionID`
        ),
        a
      );
      if (!occ) return null;
      const key = { recurringTransactionId: occ.RecurringTransactionID, dueDate: occ.DueDate };
      return k === 'recurring.markReady'
        ? {
            op: k,
            payload: {
              options: { occurrenceId: occ.ID, ...key, ...(f ? { transactionDate: date } : {}) },
            },
          }
        : { op: k, payload: { id: occ.ID, ...key } };
    }
    case 'recurring.delete': {
      const id = pick(ids(device, 'SELECT ID FROM recurring_transactions ORDER BY ID'), a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'rules.create':
      return {
        op: k,
        payload: {
          input: {
            budgetId,
            name: `Rule ${a % 7}`,
            conditions: [{ field: 'memo', operator: 'contains', value: f ? 'coffee' : 'memo' }],
            actions: [
              pick(
                [
                  { type: 'category.set', payload: { categoryId: pick(userCats, b) } },
                  { type: 'memo.set', payload: { memo: 'ruled' } },
                  { type: 'payee.set', payload: { payee: 'Ruled payee' } },
                  { type: 'amount.adjust_value', payload: { delta: 100 } },
                ],
                c
              ),
            ],
            mode: g ? 'continuous' : 'one_time',
            enabled: true,
            runOrder: d % 3,
          },
        },
      };
    case 'rules.update': {
      const id = pick(ids(device, 'SELECT ID FROM transaction_rules ORDER BY ID'), a);
      return id
        ? {
            op: k,
            payload: {
              id,
              patch: pick([{ enabled: f }, { name: `R${b}` }, { runOrder: b % 4 }], c),
            },
          }
        : null;
    }
    case 'rules.delete': {
      const id = pick(ids(device, 'SELECT ID FROM transaction_rules ORDER BY ID'), a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'rules.execute': {
      const id = pick(ids(device, 'SELECT ID FROM transaction_rules ORDER BY ID'), a);
      return id
        ? { op: k, payload: { ruleId: id, options: { trigger: f ? 'manual' : 'retroactive' } } }
        : null;
    }
    case 'categories.updateFundingPriorities': {
      const id = pick(userCats, a);
      return id
        ? { op: k, payload: { budgetId, updates: [{ categoryId: id, priority: 1 + (b % 5) }] } }
        : null;
    }
    case 'categories.updateDetails': {
      const id = pick(userCats, a);
      return id
        ? {
            op: k,
            payload: {
              budgetId,
              id,
              name: `Cat ${b % 9}`,
              excludeFromBudgetPace: f,
              priority: 1 + (c % 5),
            },
          }
        : null;
    }
    case 'categoryGroups.create':
      return { op: k, payload: { name: f ? 'More' : `Group ${a % 4}`, budgetId } };
    case 'categoryGroups.update': {
      const id = pick(groups, a);
      return id
        ? { op: k, payload: { id, name: pick(['Bills', 'Life', 'More', 'Other'], b) } }
        : null;
    }
    case 'categoryGroups.delete': {
      const id = pick(groups, a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'categories.create': {
      const parentId = pick(groups, a);
      return parentId
        ? { op: k, payload: { parentId, budgetId, name: `New ${b % 6}`, note: f ? 'note' : '' } }
        : null;
    }
    case 'categories.updateName': {
      const id = pick(userCats, a);
      return id ? { op: k, payload: { id, name: `Name ${b % 6}` } } : null;
    }
    case 'categories.updateNote': {
      const id = pick(cats, a);
      return id ? { op: k, payload: { id, note: f ? '' : `note ${b}` } } : null;
    }
    case 'categories.updateExcludeFromBudgetPace': {
      const id = pick(userCats, a);
      return id ? { op: k, payload: { id, excludeFromBudgetPace: f } } : null;
    }
    case 'categories.delete': {
      const id = pick(f ? cats : userCats, a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'categories.deleteAndReassign':
    case 'categoryGroups.deleteAndReassign': {
      // useDeleteCategory / useDeleteCategoryGroup send { id, budgetId };
      // useReassignAndDeleteCategory adds reassignTo.
      const id =
        k === 'categories.deleteAndReassign' ? pick(f ? cats : userCats, a) : pick(groups, a);
      if (!id) return null;
      const target = g
        ? pick(
            userCats.filter((cat) => cat !== id),
            b
          )
        : undefined;
      return { op: k, payload: { id, budgetId, ...(target ? { reassignTo: target } : {}) } };
    }
    case 'categories.moveToNewGroup': {
      const id = pick(userCats, a);
      const group = pick(groups, b);
      return id && group ? { op: k, payload: { newGroupId: group, categoryId: id } } : null;
    }
    case 'categoryGroups.reorder':
      return groups.length > 1
        ? { op: k, payload: { budgetId, orderedGroupIds: rotate(groups, a) } }
        : null;
    case 'categories.reorder': {
      const group = pick(groups, a);
      if (!group) return null;
      const inGroup = ids(
        device,
        'SELECT ID FROM categories WHERE CategoryGroupID = ? ORDER BY Position, ID',
        group
      );
      return inGroup.length > 1
        ? { op: k, payload: { categoryGroupId: group, orderedCategoryIds: rotate(inGroup, b) } }
        : null;
    }
    case 'accounts.create': {
      const type = pick(['checking', 'savings', 'credit', 'cash', 'loan', 'investment'], a)!;
      return {
        op: k,
        payload: {
          name: `Acc ${b % 5}`,
          budgetId,
          type,
          currency: f ? 'EUR' : 'USD',
          balance: type === 'credit' || type === 'loan' ? -amount : amount,
          onBudget: !g,
          initialBalanceDate: date,
        },
      };
    }
    case 'accounts.createLinked':
      // link-accounts.ts: a new account linked to a bank account.
      return {
        op: k,
        payload: {
          name: `Bank ${b % 5}`,
          budgetId,
          type: f ? 'savings' : 'checking',
          currency: g ? 'EUR' : 'USD',
          balance: amount,
          metadata: {},
          onBudget: true,
          initialBalanceDate: date,
          link: {
            provider: 'simplefin',
            externalAccountId: uid('ext', intent),
            externalName: 'Bank account',
            orgName: 'Bank',
            importFrom: date,
          },
        },
      };
    case 'accounts.update': {
      const acc = pick(accounts, a);
      if (!acc) return null;
      return {
        op: k,
        payload: {
          id: acc.ID,
          name: `Renamed ${b % 5}`,
          type: f ? pick(['checking', 'savings', 'cash', 'credit'], c) : acc.Type,
          currency: g && d % 4 === 0 ? (acc.Currency === 'USD' ? 'EUR' : 'USD') : acc.Currency,
          onBudget: d % 3 === 0 ? !acc.OnBudget : Boolean(acc.OnBudget),
        },
      };
    }
    case 'accounts.reorder':
      return accountIds.length > 1
        ? {
            op: k,
            payload: {
              budgetId,
              orderedAccountIds: rotate(
                accounts.map((x) => x.ID),
                a
              ),
            },
          }
        : null;
    case 'accounts.setArchived': {
      const acc = pick(accounts, a);
      return acc ? { op: k, payload: { id: acc.ID, archived: !acc.Archived } } : null;
    }
    case 'accounts.delete': {
      const id = pick(accountIds, a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'monthlyBudgets.upsertAssignment':
    case 'monthlyBudgets.updateAssignment': {
      const id = pick(cats, a);
      return id
        ? {
            op: k,
            payload: { categoryId: id, amount: f ? 0 : amount * 10, month: monthOf(b), budgetId },
          }
        : null;
    }
    case 'monthlyBudgets.batchUpsertAssignments': {
      if (!cats.length) return null;
      return {
        op: k,
        payload: {
          assignments: [
            { categoryId: pick(cats, a), amount: amount * 10, month: monthOf(b), budgetId },
            { categoryId: pick(cats, c), amount: f ? 0 : amount, month: monthOf(d), budgetId },
          ],
        },
      };
    }
    case 'monthlyBudgets.reassignAssignment': {
      const from = pick(userCats, a);
      const to = pick(userCats, b);
      return from && to && from !== to
        ? { op: k, payload: { newCategoryId: to, oldCategoryId: from } }
        : null;
    }
    case 'goals.create': {
      const categoryId = pick(userCats, a);
      if (!categoryId) return null;
      const type = pick(
        ['monthly', 'yearly', 'target-date', 'monthly-savings', 'target-balance'],
        b
      )!;
      return {
        op: k,
        payload: {
          goalType: type,
          categoryId,
          target: amount * 10,
          startDate: `${monthOf(c)}-01`,
          endDate: type === 'target-date' ? dateOf(d, 0) : '',
          purpose: type === 'monthly' || type === 'yearly' ? 'spending' : 'savings',
          recurring: false,
          cycleMonths: null,
        },
      };
    }
    case 'goals.update': {
      const goal = pick(
        rows<{ ID: number; CategoryID: number; Type: string; Purpose: string }>(
          device,
          'SELECT ID, CategoryID, Type, Purpose FROM goals ORDER BY ID'
        ),
        a
      );
      return goal
        ? {
            op: k,
            payload: {
              categoryId: goal.CategoryID,
              target: amount * 10,
              goalType: goal.Type,
              endDate: goal.Type === 'target-date' ? dateOf(d, 0) : '',
              purpose: goal.Purpose,
            },
          }
        : null;
    }
    case 'goals.delete': {
      const goal = pick(
        rows<{ ID: number; CategoryID: number }>(
          device,
          'SELECT ID, CategoryID FROM goals ORDER BY ID'
        ),
        a
      );
      return goal ? { op: k, payload: { goalId: goal.ID, categoryId: goal.CategoryID } } : null;
    }
    case 'reports.create': {
      const id = uid('rep', intent);
      return {
        op: k,
        payload: {
          id,
          name: `Report ${a % 6}`,
          description: '',
          query: 'SELECT 1 AS x, 2 AS y',
          charts: [chart(`${id}-c1`, 'bar')],
          tags: f ? ['t'] : [],
          isFavorite: g,
        },
      };
    }
    case 'reports.update': {
      const id = pick(reportIds(device), a);
      return id
        ? {
            op: k,
            payload: { id, ...(f ? { name: `Report ${b % 6}` } : { description: `d${b}` }) },
          }
        : null;
    }
    case 'reports.delete':
    case 'reports.toggleFavorite': {
      const id = pick(reportIds(device), a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'reports.addChart': {
      const reportId = pick(reportIds(device), a);
      return reportId
        ? { op: k, payload: { reportId, chart: chart(uid('chart', intent), 'pie') } }
        : null;
    }
    case 'reports.updateChart':
    case 'reports.removeChart': {
      const report = pick(reportCharts(device), a);
      const chartId = report ? pick(report.charts, b) : undefined;
      if (!report || !chartId) return null;
      return k === 'reports.updateChart'
        ? { op: k, payload: { reportId: report.id, chartId, updates: { title: `T${c}` } } }
        : { op: k, payload: { reportId: report.id, chartId } };
    }
    case 'reports.duplicate': {
      const source = pick(reportCharts(device), a);
      if (!source) return null;
      const id = uid('rep', intent);
      return {
        op: k,
        payload: {
          sourceId: source.id,
          newReport: {
            id,
            name: `Copy ${b % 6}`,
            description: '',
            query: 'SELECT 1 AS x, 2 AS y',
            charts: source.charts.map((chartId, i) => chart(`${id}-${i}-${chartId}`, 'bar')),
            tags: [],
            isFavorite: false,
          },
        },
      };
    }
    case 'customDashboards.create':
      // useCreateCustomDashboard sends no ID (the service generates one).
      return { op: k, payload: { budgetId, name: `Dash ${a % 5}` } };
    case 'customDashboards.update': {
      const id = pick(dashboardIds(device), a);
      return id
        ? {
            op: k,
            payload: f
              ? { id, name: `Dash ${b % 5}`, budgetId }
              : { id, sortOrder: b % 4, budgetId },
          }
        : null;
    }
    case 'customDashboards.delete': {
      const id = pick(dashboardIds(device), a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'customDashboards.reorder': {
      const list = dashboardIds(device);
      return list.length > 1 ? { op: k, payload: { budgetId, orderedIds: rotate(list, a) } } : null;
    }
    case 'customDashboardWidgets.add': {
      const dashboardId = pick(dashboardIds(device), a);
      const report = pick(
        reportCharts(device).filter((r) => r.charts.length),
        b
      );
      if (!dashboardId || !report) return null;
      return {
        op: k,
        payload: {
          dashboardId,
          reportId: report.id,
          chartId: pick(report.charts, c),
          ...(f ? { titleOverride: `W${d}` } : {}),
        },
      };
    }
    case 'customDashboardWidgets.update': {
      const id = pick(widgetIds(device), a);
      return id
        ? {
            op: k,
            payload: f
              ? { id, titleOverride: `W${b}` }
              : { id, desktopLayout: { colSpan: 1 + (b % 3), rowSpan: 1 + (c % 2) } },
          }
        : null;
    }
    case 'customDashboardWidgets.delete': {
      const id = pick(widgetIds(device), a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'customDashboardWidgets.reorder': {
      const dashboardId = pick(dashboardIds(device), a);
      if (!dashboardId) return null;
      const list = rows<{ ID: string }>(
        device,
        'SELECT ID FROM custom_dashboard_widgets WHERE DashboardID = ? ORDER BY SortOrder, ID',
        dashboardId
      ).map((r) => r.ID);
      return list.length > 1
        ? { op: k, payload: { dashboardId, orderedIds: rotate(list, b) } }
        : null;
    }
    case 'scenarios.save': {
      // useSaveScenario: a new scenario has no ID; a loaded one is re-saved under its ID.
      const existing = rows<{ ID: string }>(device, 'SELECT ID FROM scenarios ORDER BY ID').map(
        (r) => r.ID
      );
      const id = f ? pick(existing, a) : undefined;
      return {
        op: k,
        payload: { id, budgetId, name: `Scenario ${b % 4}`, payload: JSON.stringify({ v: c }) },
      };
    }
    case 'scenarios.delete': {
      const id = pick(
        rows<{ ID: string }>(device, 'SELECT ID FROM scenarios ORDER BY ID').map((r) => r.ID),
        a
      );
      return id ? { op: k, payload: { id } } : null;
    }
    case 'currency.customRates.add':
      return {
        op: k,
        payload: {
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: 1 + (a % 40) / 100,
          startDate: dateOf(b, 0),
          endDate: f ? null : dateOf(b, 27),
          budgetId,
          alsoReverse: g,
        },
      };
    case 'currency.customRates.update': {
      const rate = pick(
        rows<{ ID: number; StartDate: string; EndDate: string | null }>(
          device,
          'SELECT ID, StartDate, EndDate FROM custom_currency_rates ORDER BY ID'
        ),
        a
      );
      return rate
        ? {
            op: k,
            payload: {
              id: rate.ID,
              rate: 1 + (b % 40) / 100,
              startDate: rate.StartDate,
              endDate: rate.EndDate,
              budgetId,
            },
          }
        : null;
    }
    case 'currency.customRates.delete': {
      const id = pick(ids(device, 'SELECT ID FROM custom_currency_rates ORDER BY ID'), a);
      return id ? { op: k, payload: { id, budgetId } } : null;
    }
    case 'warranties.create':
      return {
        op: k,
        payload: {
          budgetId,
          name: `Thing ${a % 5}`,
          expiresAt: dateOf(b, c),
          amount,
          transactionId: f ? (pick(txs, d) ?? null) : null,
          notes: g ? 'n' : '',
        },
      };
    case 'warranties.update': {
      const id = pick(ids(device, 'SELECT ID FROM warranties ORDER BY ID'), a);
      return id
        ? { op: k, payload: { id, name: `Thing ${b % 5}`, notes: f ? 'updated' : '', amount } }
        : null;
    }
    case 'warranties.delete': {
      const id = pick(ids(device, 'SELECT ID FROM warranties ORDER BY ID'), a);
      return id ? { op: k, payload: { id } } : null;
    }
    case 'importHistory.record': {
      const imported = ids(device, 'SELECT TransactionID AS ID FROM import_provenance ORDER BY ID');
      if (!imported.length) return null;
      return {
        op: k,
        payload: {
          input: {
            runKey: uid('run', intent),
            budgetId,
            sourceType: 'csv',
            sourceName: 'bank.csv',
            summary: { totalRows: 1, imported: 1, skipped: 0, failed: 0 },
            transactionIds: [pick(imported, a)],
            accountIds: [],
            categoryIds: [],
            status: 'completed',
          },
        },
      };
    }
    case 'importHistory.match': {
      // Import review "skip": link a file row to an existing transaction.
      const tx = pick(
        rows<{ ID: number; AccountID: number; Currency: string }>(
          device,
          `SELECT t.ID, t.AccountID, acc.Currency FROM transactions t JOIN accounts acc ON acc.ID = t.AccountID
            WHERE t.BudgetID = ? AND (t.TransferID IS NULL OR t.TransferID = '') ORDER BY t.ID`,
          budgetId
        ),
        a
      );
      if (!tx) return null;
      return {
        op: k,
        payload: {
          budgetId,
          accountId: tx.AccountID,
          transactionId: tx.ID,
          identity: identity(uid('match', intent), date, amount, tx.Currency),
        },
      };
    }
    case 'bankSync.setReviewStatus': {
      // Bank sync adds reviews with skipUndo (seeded once); the review panel resolves them.
      const id = pick(ids(device, 'SELECT ID FROM bank_reviews ORDER BY ID'), a);
      return id
        ? {
            op: k,
            payload: { budgetId, id, status: pick(['dismissed', 'resolved', 'pending'], b) },
          }
        : null;
    }
    case 'importHistory.undo': {
      const id = pick(
        ids(device, "SELECT ID FROM import_runs WHERE Status != 'undone' ORDER BY ID"),
        a
      );
      return id ? { op: k, payload: { id } } : null;
    }
    case 'userPreferences.setDuplicateHintSettings':
      return {
        op: k,
        payload: {
          settings: { enabled: f, toleranceBps: 100 * (1 + (a % 5)), dayWindow: 1 + (b % 7) },
        },
      };
    case 'userPreferences.setWeekStartsOn':
      return { op: k, payload: { value: f ? 1 : 0 } };
    case 'userPreferences.setSameDayTransactionOrder':
      return { op: k, payload: { value: f ? 'amount' : 'newest' } };
    case 'userPreferences.setAllowOverAssignment':
    case 'userPreferences.setSuggestCategoryFromPayee':
    case 'userPreferences.setShowGroupPercent':
    case 'userPreferences.setPlanningNumberAnimations':
    case 'userPreferences.setDialogBackgroundBlur':
    case 'userPreferences.setHideZeroAmounts':
    case 'userPreferences.setInlineTransactionEntry':
    case 'userPreferences.setCompactTransactionRows':
      return { op: k, payload: { value: f } };
    case 'budgets.updateGoalFundingSettings':
      return {
        op: k,
        payload: {
          id: budgetId,
          settings: pick(
            [
              { CategoryPriorityMode: f ? 'numeric' : 'five-levels' },
              { GoalFundingDistribution: f ? 'equal-completion' : 'proportional-shortfall' },
              { ShowCategoryPriorities: f },
            ],
            a
          ),
        },
      };
    case 'budgets.updateName':
      return { op: k, payload: { id: budgetId, name: `Budget ${a % 4}` } };
    case 'budgets.updateIcon':
      return { op: k, payload: { id: budgetId, icon: pick(['dollar', 'euro', 'piggy'], a) } };
    case 'budgets.updateNumberFormat':
      return {
        op: k,
        payload: { id: budgetId, format: pick(['123,456.78', '123.456,78', '123 456,78'], a) },
      };
    case 'budgets.updateRtaMode':
      return { op: k, payload: { id: budgetId, mode: f ? 'monthly' : 'cumulative' } };
    default:
      throw new Error(`No realization for ${k}`);
  }
}

function rotate<T>(list: T[], n: number): T[] {
  const s = (n % (list.length - 1)) + 1;
  return [...list.slice(s), ...list.slice(0, s)];
}

function payeeNames(device: Device, budgetId: number): string[] {
  return rows<{ Name: string }>(
    device,
    'SELECT Name FROM payees WHERE BudgetID = ? ORDER BY Name',
    budgetId
  ).map((r) => r.Name);
}

function reportIds(device: Device): string[] {
  return rows<{ ID: string }>(device, 'SELECT ID FROM saved_reports ORDER BY ID').map((r) => r.ID);
}

function reportCharts(device: Device): { id: string; charts: string[] }[] {
  return rows<{ ID: string; Charts: string }>(
    device,
    'SELECT ID, Charts FROM saved_reports ORDER BY ID'
  ).map((r) => ({
    id: r.ID,
    charts: ((JSON.parse(r.Charts || '[]') as { id: string }[]) ?? []).map((ch) => ch.id),
  }));
}

function dashboardIds(device: Device): string[] {
  return rows<{ ID: string }>(device, 'SELECT ID FROM custom_dashboards ORDER BY ID').map(
    (r) => r.ID
  );
}

function widgetIds(device: Device): string[] {
  return rows<{ ID: string }>(device, 'SELECT ID FROM custom_dashboard_widgets ORDER BY ID').map(
    (r) => r.ID
  );
}
