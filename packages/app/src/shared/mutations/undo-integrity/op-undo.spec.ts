import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asMilli, type ImportIdentity, type RecurringTransaction } from '@budgero/core/browser';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { resolveBankReview } from '@features/bank-sync/api/useBankSync';
import { createUndoHarness, resetUndoStore, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

/**
 * import_provenance IDs are AUTOINCREMENT bookkeeping (rows are keyed by
 * OperationID); a redo re-records the identity under a new one.
 */
function withoutProvenanceIds(dump: Record<string, Record<string, unknown>[]>) {
  return {
    ...dump,
    import_provenance: (dump.import_provenance ?? []).map(({ ID: _id, ...row }) => row),
  };
}

describe('op undo specs', () => {
  let h: UndoHarness;

  const add = (extra: Record<string, unknown> = {}) =>
    h.run<number>('transactions.add', {
      budgetId: h.budgetId,
      accountId: h.accountId,
      categoryId: h.categoryId,
      date: '2026-09-01',
      outflow: 1000,
      memo: 'row',
      ...extra,
    });

  const identity = (operationId: string): ImportIdentity => ({
    operationId,
    fileRowKey: `row-${operationId}`,
    date: '2026-09-02',
    inflow: 0,
    outflow: 2500,
    payee: 'Bank payee',
    memo: 'bank memo',
    currency: 'USD',
  });

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
  });

  it('an add that returns an existing imported row records no undo', async () => {
    const id = await add({ importIdentities: [identity('op-1')] });
    const before = h.dump(['transactions', 'import_provenance']);
    const depth = useUndoStore.getState().past.length;

    const again = await add({ importIdentities: [identity('op-1')] });
    expect(again).toBe(id);
    expect(useUndoStore.getState().past).toHaveLength(depth);

    await useUndoStore.getState().undo(); // undoes the FIRST add only
    expect(h.rows('transactions')).toHaveLength(0);
    await useUndoStore.getState().redo();
    expect(withoutProvenanceIds(h.dump(['transactions', 'import_provenance']))).toEqual(
      withoutProvenanceIds(before)
    );
  });

  it('records no undo when the before-state capture fails', async () => {
    await expect(
      h.run('transactions.updateColumn', { id: 9999, columnName: 'Memo', newValue: 'x' })
    ).rejects.toThrow();
    const depth = useUndoStore.getState().past.length;
    // A capture that throws (row gone) must not leave an inverse writing undefined.
    const spec = (await import('@shared/mutations/op-code-registry')).getUndoSpec(
      'transactions.updateColumn'
    )!;
    expect(spec.build({ id: 1, columnName: 'Memo', newValue: 'x' }, undefined, undefined)).toEqual(
      []
    );
    expect(useUndoStore.getState().past).toHaveLength(depth);
  });

  it('split edits refresh balances, Uncategorized and Ready to Assign', () => {
    for (const op of ['transactions.upsertSplits', 'transactions.clearSplits']) {
      const roots = new Set((getInvalidatesForOp(op) ?? []).map(([root]) => root));
      for (const root of [
        'accounts',
        'uncategorizedTransactions',
        'readyToAssign',
        'balanceByDates',
      ]) {
        expect(roots.has(root), `${op}: ${root}`).toBe(true);
      }
    }
  });

  it('undoing an amount edit restores a manual exchange rate', async () => {
    const euro = (
      await h.services.accounts.createAccount('Euro', h.budgetId, 'checking', 'EUR', asMilli(0))
    ).ID;
    const id = await add({ accountId: euro, outflow: 10000, exchangeRateOverride: 1.25 });
    const before = h.dump(['transactions', 'accounts']);
    expect(before.transactions.find((tx) => tx.ID === id)).toMatchObject({
      ExchangeRate: 1.25,
      ExchangeRateOverride: 1,
    });

    await h.run('transactions.updateColumn', { id, columnName: 'OutflowNative', newValue: 20000 });
    const after = h.dump(['transactions', 'accounts']);

    await useUndoStore.getState().undo();
    expect(h.dump(['transactions', 'accounts'])).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(['transactions', 'accounts'])).toEqual(after);
  });

  it('undoing a recurring delete restores the template and its occurrences', async () => {
    const template = await h.run<RecurringTransaction>('recurring.create', {
      input: {
        budgetId: h.budgetId,
        accountId: h.accountId,
        categoryId: h.categoryId,
        name: 'Rent',
        amount: asMilli(50000),
        direction: 'outflow',
        schedule: { startDate: '2026-08-01', intervalUnit: 'month' },
      },
    });
    h.services.recurring.listOccurrences(h.budgetId);
    await h.run('recurring.markReady', {
      options: { recurringTransactionId: template.id, dueDate: '2026-08-01' },
    });
    const tables = ['recurring_transactions', 'recurring_transaction_occurrences', 'transactions'];
    const before = h.dump(tables);
    expect(before.recurring_transaction_occurrences.length).toBeGreaterThan(1);

    await h.run('recurring.delete', { id: template.id });
    const after = h.dump(tables);
    expect(after.recurring_transactions).toHaveLength(0);

    await useUndoStore.getState().undo();
    expect(h.dump(tables)).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(tables)).toEqual(after);
  });

  it('undoing a category create never cascades away transactions added since', async () => {
    const groupId = h.services.categories.getAllCategories(h.budgetId)[0]!.CategoryGroupID;
    const created = await h.run<number>('categories.create', {
      parentId: groupId,
      budgetId: h.budgetId,
      name: 'New one',
      note: '',
    });
    // A row that is not on the Ctrl+Z stack (e.g. from bank sync).
    await h.runtime.mutationsRouter().execute({
      op: 'transactions.add',
      payload: {
        budgetId: h.budgetId,
        accountId: h.accountId,
        categoryId: created,
        date: '2026-09-01',
        outflow: 1000,
      },
      meta: { skipUndo: true },
    });
    const before = h.dump(['transactions', 'categories', 'accounts']);

    await expect(useUndoStore.getState().undo()).rejects.toThrow();
    expect(h.dump(['transactions', 'categories', 'accounts'])).toEqual(before);
  });

  it('undoing a category create removes the empty category; redo brings it back', async () => {
    const groupId = h.services.categories.getAllCategories(h.budgetId)[0]!.CategoryGroupID;
    const before = h.dump(['categories']);
    await h.run<number>('categories.create', {
      parentId: groupId,
      budgetId: h.budgetId,
      name: 'Empty',
      note: '',
    });
    const after = h.dump(['categories']);

    await useUndoStore.getState().undo();
    expect(h.dump(['categories'])).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(['categories'])).toEqual(after);
  });

  describe('bank review', () => {
    const tables = ['transactions', 'import_provenance', 'bank_reviews'];

    const review = async (candidate: number | null) => {
      h.services.bankSync.addReviews([
        {
          budgetId: h.budgetId,
          accountId: h.accountId,
          identity: identity('bank-1'),
          candidateTransactionId: candidate,
        },
      ]);
      const [pending] = h.services.bankSync.listPendingReviews(h.budgetId);
      return pending!;
    };

    it('one undo reverts a whole match (identity, cleared flag, review status)', async () => {
      const candidate = await add({ outflow: 2500 });
      const pending = await review(candidate);
      const before = h.dump(tables);
      const depth = useUndoStore.getState().past.length;

      await resolveBankReview(h.runtime as never, pending, 'match');
      const after = h.dump(tables);
      expect(useUndoStore.getState().past).toHaveLength(depth + 1);

      await useUndoStore.getState().undo();
      expect(h.dump(tables)).toEqual(before);
      await useUndoStore.getState().redo();
      expect(withoutProvenanceIds(h.dump(tables))).toEqual(withoutProvenanceIds(after));
    });

    it('a pushed review added as new replays what was sent (category, memo, cleared)', async () => {
      h.services.bankSync.addReviews([
        {
          budgetId: h.budgetId,
          accountId: h.accountId,
          identity: {
            ...identity('push-1'),
            sourceKey: 'push-api',
            pushArgs: {
              budgetId: h.budgetId,
              accountId: h.accountId,
              categoryId: h.categoryId,
              date: '2026-09-01',
              outflow: 2500,
              memo: 'pushed',
              cleared: true,
            },
          },
          candidateTransactionId: null,
        },
      ]);
      const [pending] = h.services.bankSync.listPendingReviews(h.budgetId);
      await resolveBankReview(h.runtime as never, pending!, 'import');
      const [row] = h.dump(['transactions']).transactions;
      expect(row).toMatchObject({ CategoryID: h.categoryId, Memo: 'pushed', Cleared: 1 });
      // Recorded under the push identity: a replay of the same message is a no-op.
      expect(h.dump(['import_provenance']).import_provenance).toHaveLength(1);
    });

    it('one undo reverts an import and puts the review back to pending', async () => {
      const pending = await review(null);
      const before = h.dump(tables);

      await resolveBankReview(h.runtime as never, pending, 'import');
      const after = h.dump(tables);
      expect(after.transactions).toHaveLength(1);

      await useUndoStore.getState().undo();
      expect(h.dump(tables)).toEqual(before);
      expect(h.services.bankSync.listPendingReviews(h.budgetId)).toHaveLength(1);
      await useUndoStore.getState().redo();
      expect(withoutProvenanceIds(h.dump(tables))).toEqual(withoutProvenanceIds(after));
    });
  });
});
