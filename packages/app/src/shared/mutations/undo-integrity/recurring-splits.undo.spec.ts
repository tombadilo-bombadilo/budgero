/**
 * Recurring templates with split lines (#118): the create / update ops carry
 * the lines, undo and redo put them back, marking an occurrence ready posts
 * them (with the mirror of a transfer line) and its undo removes all of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asMilli, type RecurringTransaction } from '@budgero/core/browser';
import { mutationFormatVersion } from '@budgero/runtime';
import { prepareMutationArgs } from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { createUndoHarness, resetUndoStore, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

describe('recurring templates with split lines', () => {
  let h: UndoHarness;
  let savings: number;
  let other: number;

  const line = (outflow: number, target: { categoryId?: number; transferAccountId?: number }) => ({
    categoryId: target.categoryId ?? null,
    transferAccountId: target.transferAccountId ?? null,
    memo: '',
    payee: '',
    inflow: 0,
    outflow,
  });

  const createInput = () => ({
    budgetId: h.budgetId,
    accountId: h.accountId,
    categoryId: null,
    name: 'Payday',
    amount: 100_000,
    direction: 'outflow',
    schedule: { startDate: '2026-08-01', intervalUnit: 'month', intervalCount: 1 },
    splits: [
      line(60_000, { categoryId: h.categoryId }),
      line(40_000, { transferAccountId: savings }),
    ],
  });

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
    savings = (
      await h.services.accounts.createAccount('Savings', h.budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    other = h.services.categories
      .getAllCategories(h.budgetId)
      .find(
        (category) =>
          category.ID !== h.categoryId &&
          !['Income', 'Uncategorized', 'Transfers'].includes(category.Name)
      )!.ID;
  });

  it('create carries the lines through, and undo / redo keep them', async () => {
    const template = await h.run<RecurringTransaction>('recurring.create', {
      input: createInput(),
    });
    expect(template.splits).toEqual(createInput().splits);

    await useUndoStore.getState().undo();
    expect(h.rows('recurring_transactions')).toHaveLength(0);
    await useUndoStore.getState().redo();
    expect(h.services.recurring.getRecurringTransaction(template.id).splits).toEqual(
      createInput().splits
    );
  });

  it('update undo restores the previous lines', async () => {
    const template = await h.run<RecurringTransaction>('recurring.create', {
      input: createInput(),
    });
    await h.run('recurring.update', {
      id: template.id,
      patch: {
        amount: 90_000,
        splits: [line(50_000, { categoryId: other }), line(40_000, { categoryId: h.categoryId })],
      },
    });
    const after = h.services.recurring.getRecurringTransaction(template.id);
    expect(after.splits?.[0].categoryId).toBe(other);

    await useUndoStore.getState().undo();
    const undone = h.services.recurring.getRecurringTransaction(template.id);
    expect(undone.amount).toBe(100_000);
    expect(undone.splits).toEqual(createInput().splits);

    await useUndoStore.getState().redo();
    expect(h.services.recurring.getRecurringTransaction(template.id).splits).toEqual(after.splits);
  });

  it('a template without the splits field has none (older payloads)', async () => {
    const { splits: _splits, ...legacy } = createInput();
    const template = await h.run<RecurringTransaction>('recurring.create', {
      input: { ...legacy, categoryId: h.categoryId },
    });
    expect(template.splits).toBeNull();
    expect(template.categoryId).toBe(h.categoryId);
  });

  it('mark ready posts the lines and the mirror; undo removes them and redo puts them back', async () => {
    const template = await h.run<RecurringTransaction>('recurring.create', {
      input: createInput(),
    });
    h.services.recurring.listOccurrences(h.budgetId);

    const ready = await h.run<{ transactionId: number }>('recurring.markReady', {
      options: { recurringTransactionId: template.id, dueDate: '2026-08-01' },
    });
    expect(h.rows('transaction_splits')).toHaveLength(2);
    const mirrors = h.services.transactions.getTransactionsByAccount(savings);
    expect(mirrors).toHaveLength(1);
    expect(h.services.accounts.getAccount(savings).BalanceNative).toBe(40_000);

    await useUndoStore.getState().undo();
    expect(h.rows('transactions')).toEqual([]);
    expect(h.rows('transaction_splits')).toEqual([]);
    expect(h.services.accounts.getAccount(h.accountId).BalanceNative).toBe(0);
    expect(h.services.accounts.getAccount(savings).BalanceNative).toBe(0);
    expect(
      h.services.recurring.getOccurrenceWithTemplate(
        h.services.recurring.resolveOccurrenceId({
          recurringTransactionId: template.id,
          dueDate: '2026-08-01',
        })
      ).status
    ).toBe('scheduled');

    // A row added meanwhile would take the next free IDs.
    await h.services.transactions.addTransaction(
      asMilli(0),
      asMilli(1_000),
      h.accountId,
      h.categoryId,
      h.budgetId,
      '2026-08-02',
      'meanwhile',
      ''
    );

    await useUndoStore.getState().redo();
    expect(h.services.splits.getSplits(ready.transactionId)).toHaveLength(2);
    expect(h.services.accounts.getAccount(savings).BalanceNative).toBe(40_000);
    // The mirror is back under its first ID, so history naming it stays valid.
    expect(h.services.transactions.getTransactionsByAccount(savings).map((tx) => tx.ID)).toEqual(
      mirrors.map((tx) => tx.ID)
    );
  });

  it('calls with lines go out in a format v1.20 builds reject', async () => {
    const withLines = { input: createInput() };
    const { splits: _splits, ...plain } = createInput();
    expect(
      mutationFormatVersion(
        'recurring.create',
        await prepareMutationArgs('recurring.create', withLines)
      )
    ).toBe(5);
    expect(
      mutationFormatVersion(
        'recurring.create',
        await prepareMutationArgs('recurring.create', { input: { ...plain, splits: null } })
      )
    ).toBe(2);
    expect(
      mutationFormatVersion(
        'recurring.update',
        await prepareMutationArgs('recurring.update', {
          id: 1,
          patch: { splits: createInput().splits },
        })
      )
    ).toBe(5);
    expect(
      mutationFormatVersion(
        'recurring.update',
        await prepareMutationArgs('recurring.update', { id: 1, patch: { name: 'x' } })
      )
    ).toBe(2);
  });
});
