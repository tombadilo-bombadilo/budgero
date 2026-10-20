/**
 * A25 / U1 / U12 / A27: ops whose undo comes from the row journal
 * (history.restoreRows) restore every row exactly, and "today"-dependent ops
 * run at the clock of the device they came from (opClock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The harness runs the Node core build; its clock is the one to move.
// eslint-disable-next-line no-restricted-imports
import { asMilli, setClock } from '@budgero/core';
import { opCodeFormatVersion, REQUIRES_FORMAT_ARG } from '@budgero/runtime';
import {
  executeMutationOp,
  OP_CLOCK_ARG,
  prepareMutationArgs,
} from '@shared/mutations/op-code-registry';
import { RESTORE_ROWS_OP } from '@shared/mutations/op-code-registry/shared';
import { withLegacyFormat } from '@shared/mutations/legacy-format';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { createUndoHarness, resetUndoStore, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

const TABLES = [
  'accounts',
  'transactions',
  'transaction_splits',
  'categories',
  'category_groups',
  'assignments',
  'recurring_transactions',
  'recurring_transaction_occurrences',
  'saved_reports',
  'import_runs',
];

describe('journaled undo', () => {
  let h: UndoHarness;
  let other: number;

  const dump = () => h.dump(TABLES.filter((table) => tableExists(table)));
  const tableExists = (table: string) =>
    (
      h.adapter
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table) as { n: number }
    ).n > 0;

  const addRow = (categoryId: number, outflow: number, date = '2026-09-01') =>
    h.run<number>('transactions.add', {
      budgetId: h.budgetId,
      accountId: h.accountId,
      categoryId,
      date,
      outflow,
      memo: 'row',
    });

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
    other = h.services.categories
      .getAllCategories(h.budgetId)
      .find(
        (category) =>
          category.ID !== h.categoryId &&
          !['Income', 'Uncategorized', 'Transfers'].includes(category.Name)
      )!.ID;
    await addRow(h.categoryId, 1000);
    await addRow(h.categoryId, 2500, '2026-08-03');
    await h.run('monthlyBudgets.upsertAssignment', {
      budgetId: h.budgetId,
      categoryId: h.categoryId,
      month: '2026-09',
      amount: 5000,
    });
  });

  afterEach(() => setClock(null));

  async function expectExactUndo(op: string, payload: Record<string, unknown>) {
    const before = dump();
    const depth = useUndoStore.getState().past.length;
    await h.run(op, payload);
    const after = dump();
    expect(after).not.toEqual(before);
    expect(useUndoStore.getState().past).toHaveLength(depth + 1);
    const undoOps = JSON.stringify(useUndoStore.getState().past.at(-1));
    expect(undoOps).toContain(RESTORE_ROWS_OP);
    await useUndoStore.getState().undo();
    expect(dump()).toEqual(before);
    await useUndoStore.getState().redo();
    expect(dump()).toEqual(after);
  }

  it('restores a legacy category delete with its transactions and assignments (U1)', async () => {
    await expectExactUndo('categories.delete', { id: h.categoryId, budgetId: h.budgetId });
  });

  it('restores a legacy group delete (U1)', async () => {
    const groupId = h.services.categories.getCategory(h.categoryId).CategoryGroupID;
    await expectExactUndo('categoryGroups.delete', { id: groupId, budgetId: h.budgetId });
  });

  it('restores both legacy reassign steps (U1)', async () => {
    await expectExactUndo('transactions.reassign', {
      budgetId: h.budgetId,
      newCategoryId: other,
      oldCategoryId: h.categoryId,
    });
    await expectExactUndo('monthlyBudgets.reassignAssignment', {
      budgetId: h.budgetId,
      newCategoryId: other,
      oldCategoryId: h.categoryId,
    });
  });

  it('undoes an account currency change exactly (A27 NEW-12)', async () => {
    await expectExactUndo('accounts.update', {
      budgetId: h.budgetId,
      id: h.accountId,
      name: 'Checking',
      type: 'checking',
      currency: 'EUR',
      currencyChangeMode: 'reinterpret',
    });
  });

  it('undoes a type change, dropping the payment category it created (A27 NEW-5)', async () => {
    await expectExactUndo('accounts.update', {
      budgetId: h.budgetId,
      id: h.accountId,
      name: 'Checking',
      type: 'credit',
      currency: 'USD',
    });
  });

  it('undo of a split add removes the Uncategorized category it re-created', async () => {
    const uncategorized = h.services.categories
      .getAllCategories(h.budgetId)
      .find((category) => category.Name === 'Uncategorized')!;
    await h.run('categoryGroups.delete', {
      id: uncategorized.CategoryGroupID,
      budgetId: h.budgetId,
    });
    const before = h.dump(['categories', 'category_groups']);
    await h.run('transactions.add', {
      budgetId: h.budgetId,
      accountId: h.accountId,
      date: '2026-09-02',
      outflow: 2000,
      memo: 'split',
      splits: [
        { categoryId: h.categoryId, outflow: 1000 },
        { categoryId: other, outflow: 1000 },
      ],
    });
    await useUndoStore.getState().undo();
    expect(h.dump(['categories', 'category_groups'])).toEqual(before);
  });

  it('a loan rename v1.18 would half-apply (linked category gone) asks for format 3 (A28)', async () => {
    const loan = await h.services.accounts.createAccount(
      'Car',
      h.budgetId,
      'loan',
      'USD',
      asMilli(0),
      {
        debt_total: 100_000,
      }
    );
    const linked = (
      JSON.parse(String(h.services.accounts.getAccount(loan.ID).Metadata || '{}')) as {
        linked_category_id: number;
      }
    ).linked_category_id;
    const call = { id: loan.ID, name: 'Truck', type: 'loan', currency: 'USD' };
    expect(withLegacyFormat('accounts.update', call)).not.toHaveProperty(REQUIRES_FORMAT_ARG);
    // What a replayed legacy group delete leaves behind.
    h.adapter.prepare('DELETE FROM categories WHERE ID = ?').run(linked);
    expect(withLegacyFormat('accounts.update', call)[REQUIRES_FORMAT_ARG]).toBe(3);
  });

  it('a new op code older builds cannot read is stamped format 3', () => {
    expect(opCodeFormatVersion(RESTORE_ROWS_OP)).toBe(3);
  });
});

describe('ops carry the clock they ran at (A25)', () => {
  let h: UndoHarness;

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
  });

  afterEach(() => setClock(null));

  it('prepare stamps opClock on budget ops, not on UI-only records', async () => {
    setClock(Date.UTC(2026, 2, 10, 9));
    const prepared = await prepareMutationArgs('transactions.reconcile', { accountId: 1 });
    expect(prepared[OP_CLOCK_ARG]).toBe(Date.UTC(2026, 2, 10, 9));
    const plain = await prepareMutationArgs('categories.updateNote', { id: 1, note: 'x' });
    expect(plain[OP_CLOCK_ARG]).toBe(Date.UTC(2026, 2, 10, 9));
    const ui = await prepareMutationArgs('userPreferences.setHideZeroAmounts', { value: true });
    expect(ui).not.toHaveProperty(OP_CLOCK_ARG);
    // An already stamped op keeps its clock (redo, replay).
    const again = await prepareMutationArgs('transactions.reconcile', prepared);
    expect(again[OP_CLOCK_ARG]).toBe(Date.UTC(2026, 2, 10, 9));
  });

  it('a receiver applies the op at the sender’s clock, not its own', async () => {
    const sent = Date.UTC(2026, 2, 10, 9);
    setClock(Date.UTC(2026, 4, 20, 18)); // the receiver is two months later
    await executeMutationOp(
      'transactions.reconcile',
      { accountId: h.accountId, [OP_CLOCK_ARG]: sent },
      { isReceiver: true } as Parameters<typeof executeMutationOp>[2]
    );
    const account = h.services.accounts.getAccount(h.accountId);
    expect(account.ReconciledAt).toBe(new Date(sent).toISOString());
    // ...and its own clock is back afterwards.
    expect(h.services.clock.now()).toBe(Date.UTC(2026, 4, 20, 18));
  });

  it('ops from older clients (no opClock) run at the local clock', async () => {
    const local = Date.UTC(2026, 4, 20, 18);
    setClock(local);
    await executeMutationOp('transactions.reconcile', { accountId: h.accountId });
    expect(h.services.accounts.getAccount(h.accountId).ReconciledAt).toBe(
      new Date(local).toISOString()
    );
  });
});
