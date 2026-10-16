import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedMutationHistoryEntry } from '@budgero/core/browser';
import { runInUndoGroup, useUndoStore } from '@shared/mutations/UndoStore';
import {
  getAuditUndoAvailability,
  undoMutationHistoryEntry,
} from '@shared/mutations/useMutationHistory';
import { SPACE_ID, createUndoHarness, resetUndoStore, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

const TABLES = ['transactions', 'accounts'];

describe('UndoStore replays', () => {
  let h: UndoHarness;

  const add = (memo: string, outflow = 1000) =>
    h.run<number>('transactions.add', {
      budgetId: h.budgetId,
      accountId: h.accountId,
      categoryId: h.categoryId,
      date: '2026-09-01',
      outflow,
      memo,
    });

  const history = (): ParsedMutationHistoryEntry[] =>
    h.services.mutationHistory.getHistoryForSpace(SPACE_ID, { limit: 100 });
  const historyOf = (mutationId: string) =>
    history().find((entry) => entry.mutationId === mutationId)!;

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
  });

  it('applies a multi-step undo all-or-nothing and keeps a failed entry retryable', async () => {
    const id = await add('original');
    await add('other');
    const before = h.dump(TABLES);
    const store = useUndoStore.getState();
    store.push({
      id: 'broken',
      undo: [
        { op: 'transactions.updateColumn', args: { id, columnName: 'Memo', newValue: 'changed' } },
        { op: 'transactions.updateColumn', args: { id: 9999, columnName: 'Memo', newValue: '' } },
      ],
      redo: [],
      ts: 0,
    });
    h.executed.length = 0;

    await expect(store.undo()).rejects.toThrow();
    // Step 1 was reverted when step 2 failed, and only one mutation ran.
    expect(h.dump(TABLES)).toEqual(before);
    expect(h.executed).toHaveLength(1);
    expect(h.executed[0]!.op).toBe('history.applyOps');
    expect(useUndoStore.getState().failed?.item.id).toBe('broken');
    expect(useUndoStore.getState().past.map((item) => item.id)).not.toContain('broken');

    // Retrying applies nothing twice.
    await expect(useUndoStore.getState().retryFailed()).rejects.toThrow();
    expect(h.dump(TABLES)).toEqual(before);
  });

  it('replays carry the replay flag and record no history rows of their own', async () => {
    await add('a');
    const rowsBefore = history().length;
    h.executed.length = 0;

    await useUndoStore.getState().undo();
    expect(h.executed[0]!.meta).toMatchObject({ skipUndo: true, replay: 'undo' });
    await useUndoStore.getState().redo();
    expect(h.executed[1]!.meta).toMatchObject({ skipUndo: true, replay: 'redo' });
    expect(history()).toHaveLength(rowsBefore);
  });

  it('groups an action into one entry that undoes and redoes atomically', async () => {
    await add('before');
    const before = h.dump(TABLES);

    await runInUndoGroup(async () => {
      await add('row 1');
      await add('row 2', 2000);
      await add('row 3', 3000);
    });
    const after = h.dump(TABLES);
    expect(useUndoStore.getState().past).toHaveLength(2);

    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(TABLES)).toEqual(after);
    await useUndoStore.getState().undo();
    expect(h.dump(TABLES)).toEqual(before);
  });

  it('undoItem only undoes its own entry, and only while it is the newest', async () => {
    await add('first');
    const first = useUndoStore.getState().past.at(-1)!.id;
    await add('second');
    const second = useUndoStore.getState().past.at(-1)!.id;
    const afterBoth = h.dump(TABLES);

    await expect(useUndoStore.getState().undoItem(first)).rejects.toThrow();
    expect(h.dump(TABLES)).toEqual(afterBoth);

    await useUndoStore.getState().undoItem(second);
    expect(h.rows('transactions').map((tx) => tx.Memo)).toEqual(['first']);
    await expect(useUndoStore.getState().redoItem('unknown')).rejects.toThrow();
    await useUndoStore.getState().redoItem(second);
    expect(h.dump(TABLES)).toEqual(afterBoth);
  });

  describe('Audit Log undo', () => {
    it('marks Ctrl+Z undo/redo on the history row', async () => {
      await add('a');
      const id = useUndoStore.getState().past.at(-1)!.id;

      await useUndoStore.getState().undo();
      expect(historyOf(id).undoneAt).toBeTruthy();
      await useUndoStore.getState().redo();
      expect(historyOf(id).undoneAt).toBeFalsy();
    });

    it('refuses an entry with newer changes after it', async () => {
      await add('a');
      const first = useUndoStore.getState().past.at(-1)!.id;
      await add('b');
      const afterBoth = h.dump(TABLES);

      const entry = historyOf(first);
      const latest = h.services.mutationHistory.getLatestActiveEntryForSpace(SPACE_ID)?.mutationId;
      expect(getAuditUndoAvailability(entry, latest, useUndoStore.getState().past.at(-1))).toEqual({
        canUndo: false,
        reason: 'newer-changes',
      });
      await expect(undoMutationHistoryEntry(entry)).rejects.toThrow();
      expect(h.dump(TABLES)).toEqual(afterBoth);
    });

    it('undoes the newest entry through the Ctrl+Z stack (no double undo)', async () => {
      await add('seed');
      const initial = h.dump(TABLES);
      await add('a');
      const first = useUndoStore.getState().past.at(-1)!.id;
      await add('b');
      const second = useUndoStore.getState().past.at(-1)!.id;

      await useUndoStore.getState().undo(); // Ctrl+Z "b"
      await undoMutationHistoryEntry(historyOf(first)); // Audit Log "a"
      expect(h.dump(TABLES)).toEqual(initial);
      expect(useUndoStore.getState().past).toHaveLength(1); // the seed row
      expect(useUndoStore.getState().future.map((item) => item.id)).toEqual([second, first]);
      expect(historyOf(first).undoneAt).toBeTruthy();
      await expect(undoMutationHistoryEntry(historyOf(first))).rejects.toThrow();
      expect(h.dump(TABLES)).toEqual(initial);
    });

    it('after a reload, undoes the newest entry and then the one before it', async () => {
      await add('seed');
      const initial = h.dump(TABLES);
      await add('a');
      const first = useUndoStore.getState().past.at(-1)!.id;
      const afterFirst = h.dump(TABLES);
      await add('b');
      const second = useUndoStore.getState().past.at(-1)!.id;
      resetUndoStore(); // the Ctrl+Z stack does not survive a reload

      await expect(undoMutationHistoryEntry(historyOf(first))).rejects.toThrow();
      await undoMutationHistoryEntry(historyOf(second));
      expect(h.dump(TABLES)).toEqual(afterFirst);
      await undoMutationHistoryEntry(historyOf(first));
      expect(h.dump(TABLES)).toEqual(initial);
    });
  });
});
