import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { createUndoHarness, resetUndoStore, withoutTimestamps, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

const TABLES = ['transactions', 'transaction_splits', 'payees', 'labels'];

describe('payee and label undo restore exactly the affected rows', () => {
  let h: UndoHarness;

  const add = (payee: string, outflow: number, extra: Record<string, unknown> = {}) =>
    h.run<number>('transactions.add', {
      budgetId: h.budgetId,
      accountId: h.accountId,
      categoryId: h.categoryId,
      date: '2026-09-01',
      outflow,
      payee,
      ...extra,
    });

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
  });

  it('undoing a payee merge un-merges only the rows that had the old name', async () => {
    await add('Amazon', 1000);
    await add('Amazon.com', 2000);
    await add('Amazon.com', 3000);
    const split = await add('', 4000, {
      categoryId: undefined,
      splits: [
        { categoryId: h.categoryId, outflow: 1500, payee: 'Amazon.com' },
        { categoryId: h.categoryId, outflow: 2500, payee: 'Amazon' },
      ],
    });
    expect(split).toBeGreaterThan(0);
    await h.run('payees.add', { budgetId: h.budgetId, name: 'Amazon' });
    await h.run('payees.add', { budgetId: h.budgetId, name: 'Amazon.com' });
    const before = h.dump(TABLES);

    await h.run('payees.rename', {
      budgetId: h.budgetId,
      oldName: 'Amazon.com',
      newName: 'Amazon',
    });
    const after = h.dump(TABLES);
    expect(after.transactions.map((tx) => tx.Payee)).not.toContain('Amazon.com');

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);

    await useUndoStore.getState().redo();
    expect(h.dump(TABLES)).toEqual(after);

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
  });

  it('undoing a rename to a new name removes the directory entry the rename created', async () => {
    await add('Cafe', 1000);
    await h.run('payees.add', { budgetId: h.budgetId, name: 'Cafe' });
    const before = h.dump(TABLES);

    await h.run('payees.rename', { budgetId: h.budgetId, oldName: 'Cafe', newName: 'Coffee' });
    const after = h.dump(TABLES);

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
    await useUndoStore.getState().redo();
    // Redo re-creates the Coffee entry under the same ID (its CreatedAt is the redo time).
    const redone = h.dump(TABLES);
    expect({ ...redone, payees: withoutTimestamps(redone.payees) }).toEqual({
      ...after,
      payees: withoutTimestamps(after.payees),
    });
  });

  it('undoing a payee delete puts the payee back on its transactions and splits', async () => {
    await add('Gym', 1000);
    await add('Shop', 2000);
    await add('', 3000, {
      categoryId: undefined,
      splits: [
        { categoryId: h.categoryId, outflow: 1000, payee: 'Gym' },
        { categoryId: h.categoryId, outflow: 2000, payee: 'Shop' },
      ],
    });
    await h.run('payees.add', { budgetId: h.budgetId, name: 'Gym' });
    const before = h.dump(TABLES);

    await h.run('payees.delete', { budgetId: h.budgetId, name: 'Gym' });
    const after = h.dump(TABLES);
    expect(after.transactions.map((tx) => tx.Payee)).not.toContain('Gym');

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(TABLES)).toEqual(after);
  });

  it('undoing deleteMany restores every name on its own rows', async () => {
    await add('A', 1000);
    await add('B', 2000);
    await add('C', 3000);
    await h.run('payees.add', { budgetId: h.budgetId, name: 'A' });
    const before = h.dump(TABLES);

    await h.run('payees.deleteMany', { budgetId: h.budgetId, names: ['A', 'B'] });
    const after = h.dump(TABLES);

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(TABLES)).toEqual(after);
  });

  it('undoing a label delete re-attaches the label to its transactions', async () => {
    const labelId = await h.run<number>('labels.add', {
      budgetId: h.budgetId,
      name: 'Trip',
      color: '#112233',
    });
    const other = await h.run<number>('labels.add', {
      budgetId: h.budgetId,
      name: 'Work',
      color: '#445566',
    });
    await add('X', 1000, { labelId });
    await add('Y', 2000, { labelId });
    await add('Z', 3000, { labelId: other });
    const before = h.dump(TABLES);

    await h.run('labels.delete', { budgetId: h.budgetId, id: labelId });
    const after = h.dump(TABLES);
    expect(after.transactions.filter((tx) => tx.LabelID === labelId)).toHaveLength(0);

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(TABLES)).toEqual(after);
  });
});
