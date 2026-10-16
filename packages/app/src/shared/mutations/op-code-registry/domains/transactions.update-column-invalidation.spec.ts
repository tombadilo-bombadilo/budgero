/**
 * transactions.updateColumn invalidates by column: a memo edit refreshes the
 * rows, not the budget, RTA, balances or directories. These tests run the real
 * MutationExecutor against mounted queries and check which ones refetch, for
 * the first write, for undo/redo replays and for remote (receiver) copies.
 */
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { MutationExecutor, type QueryClientLike } from '@budgero/runtime';
import {
  getInvalidatesForOp,
  getUndoSpec,
  opCodeRegistry,
} from '@shared/mutations/op-code-registry';
import { updateColumnInvalidations } from './transactions';

const SPACE = 'space-1';

// One mounted query per screen that could show a column's data.
const SCREENS = {
  register: [
    ['accountTransactionPages', SPACE, 7, '', '', 200],
    ['accountTransactionRange', SPACE, 7, '', ''],
    ['accountTransactionSummary', SPACE, 7, '', ''],
    ['futureAccountTransactions', SPACE, 7, '2026-10-16'],
    ['accountBalanceHistory', SPACE, 7],
  ],
  lists: [
    ['allTransactions', SPACE, 1],
    ['allTransactions', SPACE, 1, 'recentUncategorized', 6],
    ['allTransactions', SPACE, 1, 'uncategorizedCounts'],
    ['allTransactions', SPACE, 1, 'balanceHistory', 'day', '2026-09-16'],
    ['allTransactionsDetailed', SPACE, 1],
    ['allTransactionsAnalytics', SPACE, 1],
    ['transactionsByCategoryAndMonth', SPACE, 1, 5, '2026-10'],
    ['allAccountsMonthlyTransactions', SPACE, 1, '2026-10'],
  ],
  budget: [
    ['monthlyBudget', SPACE, '2026-10', 1],
    ['readyToAssign', SPACE, 1, '2026-10'],
    ['accounts', SPACE, 1],
    ['onBudgetBalance', SPACE, 1],
    ['spendingByDates', SPACE, '2026-09-16', '2026-10-16', 1],
  ],
  payees: [
    ['payees', SPACE, 1],
    ['payeeDirectory', SPACE, 1],
  ],
  labels: [
    ['labelDirectory', SPACE, 1],
    ['spendingByLabels', SPACE, '2026-09-16', '2026-10-16', 1],
  ],
} as const;

type Screen = keyof typeof SCREENS;

async function refreshedScreens(
  payload: Record<string, unknown>,
  { receiver = false, explicit }: { receiver?: boolean; explicit?: string[][] } = {}
) {
  const qc = new QueryClient();
  const fetches = new Map<string, number>();
  const keys = Object.values(SCREENS).flat() as unknown as (string | number)[][];
  const observers = keys.map(
    (queryKey) =>
      new QueryObserver(qc, {
        queryKey,
        queryFn: async () => {
          const id = JSON.stringify(queryKey);
          fetches.set(id, (fetches.get(id) ?? 0) + 1);
          return fetches.get(id);
        },
        staleTime: 5 * 60 * 1000,
      })
  );
  const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
  const executor = new MutationExecutor({
    executeOp: async () => undefined,
    getUndoSpec,
    getInvalidatesForOp,
    getInvalidatesForCall: getInvalidatesForOp,
    getQueryClient: () => qc as unknown as QueryClientLike,
    pushUndo: () => {},
    recordHistory: () => {},
    getActiveSpaceId: () => SPACE,
    getSpaceRole: () => 'owner',
  });
  try {
    await vi.waitFor(() => {
      expect(observers.every((observer) => observer.getCurrentResult().data === 1)).toBe(true);
    });
    await executor.execute({
      op: 'transactions.updateColumn',
      payload,
      spaceId: SPACE,
      ...(receiver ? { mutationId: 'remote-1' } : {}),
      ...(explicit ? { invalidates: explicit, meta: { forceInvalidate: true } } : {}),
    });
    const refreshed = (screen: Screen) =>
      (SCREENS[screen] as unknown as (string | number)[][]).map(
        (key) => fetches.get(JSON.stringify(key)) === 2
      );
    return Object.fromEntries(
      (Object.keys(SCREENS) as Screen[]).map((screen) => {
        const flags = refreshed(screen);
        return [screen, flags.every(Boolean) ? 'all' : flags.some(Boolean) ? 'some' : 'none'];
      })
    ) as Record<Screen, 'all' | 'some' | 'none'>;
  } finally {
    unsubscribe.forEach((stop) => stop());
    qc.clear();
  }
}

const update = (columnName: string | undefined, newValue: unknown = 'x') => ({
  id: 42,
  ...(columnName === undefined ? {} : { columnName }),
  newValue,
});

describe('transactions.updateColumn invalidation by column', () => {
  it('memo edits refresh every row list but no budget, balance or directory query', async () => {
    expect(await refreshedScreens(update('Memo'))).toEqual({
      register: 'all',
      lists: 'all',
      budget: 'none',
      payees: 'none',
      labels: 'none',
    });
  });

  it('payee edits also refresh the payee pickers and directory', async () => {
    expect(await refreshedScreens(update('Payee', 'Bakery'))).toEqual({
      register: 'all',
      lists: 'all',
      budget: 'none',
      payees: 'all',
      labels: 'none',
    });
  });

  it('label edits also refresh the label directory and label analytics', async () => {
    expect(await refreshedScreens(update('LabelID', 3))).toEqual({
      register: 'all',
      lists: 'all',
      budget: 'none',
      payees: 'none',
      labels: 'all',
    });
  });

  it.each([
    'InflowConverted',
    'OutflowConverted',
    'InflowNative',
    'OutflowNative',
    'inflow',
    'outflow_original',
    'Date',
    'CategoryID',
    'AccountID',
    'ExchangeRate',
  ])('%s edits refresh rows, budget, balances and analytics, not the directories', async (col) => {
    expect(await refreshedScreens(update(col, 1000))).toEqual({
      register: 'all',
      lists: 'all',
      budget: 'all',
      payees: 'none',
      // spendingByLabels sums amounts; the label directory only counts rows.
      labels: 'some',
    });
  });

  it.each([undefined, 'Cleared', 'SomethingNew'])(
    'falls back to the full list for column %s',
    async (col) => {
      expect(await refreshedScreens(update(col))).toEqual({
        register: 'all',
        lists: 'all',
        budget: 'all',
        payees: 'all',
        labels: 'all',
      });
    }
  );

  it('remote copies of an edit use the same per-column set', async () => {
    expect(await refreshedScreens(update('Memo'), { receiver: true })).toEqual({
      register: 'all',
      lists: 'all',
      budget: 'none',
      payees: 'none',
      labels: 'none',
    });
    expect((await refreshedScreens(update('OutflowNative', 5), { receiver: true })).budget).toBe(
      'all'
    );
  });

  it('undo and redo replay with the column of the edit they reverse', async () => {
    const spec = getUndoSpec('transactions.updateColumn')!;
    for (const [columnName, budget] of [
      ['Memo', 'none'],
      ['OutflowConverted', 'all'],
    ] as const) {
      const args = update(columnName, 'new');
      const [undoCall] = spec.build(args, undefined, { oldValue: 'old' });
      expect(undoCall.args.columnName).toBe(columnName);
      // UndoStore / useMutationHistory pass getInvalidatesForOp(op, args) explicitly.
      const replay = await refreshedScreens(undoCall.args, {
        explicit: getInvalidatesForOp(undoCall.op, undoCall.args),
      });
      expect(replay.register).toBe('all');
      expect(replay.budget).toBe(budget);
    }
  });

  it('every per-column set stays inside the op-level list', () => {
    const full = new Set(
      opCodeRegistry['transactions.updateColumn'].invalidates.map((key) => key[0])
    );
    for (const col of ['Memo', 'Payee', 'LabelID', 'OutflowNative', 'Date', 'Nope']) {
      for (const [root] of updateColumnInvalidations({ columnName: col })) {
        expect(full.has(root), `${col}: ${root}`).toBe(true);
      }
    }
    // Callers that only know the op (bank-sync roots, push import) keep the full list.
    expect(getInvalidatesForOp('transactions.updateColumn')).toBe(
      opCodeRegistry['transactions.updateColumn'].invalidates
    );
  });
});
