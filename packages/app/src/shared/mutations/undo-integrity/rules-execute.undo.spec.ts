import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateRuleInput, RuleExecutionResult, TransactionRule } from '@budgero/core/browser';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { createUndoHarness, resetUndoStore, withoutTimestamps, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

const DATA_TABLES = ['transactions', 'accounts'];

describe('rules.execute undo/redo uses the core run log', () => {
  let h: UndoHarness;

  const add = (payee: string, outflow: number, memo = 'coffee') =>
    h.run<number>('transactions.add', {
      budgetId: h.budgetId,
      accountId: h.accountId,
      categoryId: h.categoryId,
      date: '2026-09-01',
      outflow,
      payee,
      memo,
    });

  const createRule = async (actions: CreateRuleInput['actions']) =>
    h.run<TransactionRule>('rules.create', {
      input: {
        budgetId: h.budgetId,
        name: 'Rule',
        conditions: [{ field: 'memo', operator: 'contains', value: 'coffee' }],
        actions,
        mode: 'one_time',
      } satisfies CreateRuleInput,
    });

  const ruleRow = (id: number) =>
    withoutTimestamps(h.rows('transaction_rules').filter((row) => row.ID === id));

  beforeEach(async () => {
    resetUndoStore();
    h = await createUndoHarness();
    holder.runtime = h.runtime;
  });

  it('restores payee, memo and category and marks the run undone; redo re-applies the same run', async () => {
    await add('Cafe', 1000);
    await add('Bakery', 2000, 'coffee and cake');
    await add('Other', 3000, 'groceries');
    const otherCategory = h.services.categories
      .getAllCategories(h.budgetId)
      .find(
        (c) => c.ID !== h.categoryId && !['Income', 'Uncategorized', 'Transfers'].includes(c.Name)
      )!.ID;
    const rule = await createRule([
      { type: 'payee.set', payload: { payee: 'Coffee Shop' } },
      { type: 'memo.set', payload: { memo: 'Coffee' } },
      { type: 'category.set', payload: { categoryId: otherCategory } },
    ]);
    const before = h.dump(DATA_TABLES);
    const ruleBefore = ruleRow(rule.id);

    const result = await h.run<RuleExecutionResult>('rules.execute', { ruleId: rule.id });
    const after = h.dump(DATA_TABLES);
    const ruleAfter = ruleRow(rule.id);
    expect(after.transactions.filter((tx) => tx.Payee === 'Coffee Shop')).toHaveLength(2);

    await useUndoStore.getState().undo();
    expect(h.dump(DATA_TABLES)).toEqual(before);
    expect(ruleRow(rule.id)).toEqual(ruleBefore);
    expect(h.services.rules.getRun(result.run.id).status).toBe('undone');

    await useUndoStore.getState().redo();
    expect(h.dump(DATA_TABLES)).toEqual(after);
    expect(ruleRow(rule.id)).toEqual(ruleAfter);
    const redone = h.services.rules.getRun(result.run.id);
    expect(redone.status).toBe('completed');
    expect(redone.transactionCount).toBe(result.run.transactionCount);
    expect(h.rows('transaction_rule_runs')).toHaveLength(1);

    // The same run can be undone again.
    await useUndoStore.getState().undo();
    expect(h.dump(DATA_TABLES)).toEqual(before);
  });

  it('restores amounts in one op', async () => {
    await add('Cafe', 1000);
    const rule = await createRule([{ type: 'amount.adjust_percent', payload: { percent: 10 } }]);
    const before = h.dump(DATA_TABLES);

    await h.run('rules.execute', { ruleId: rule.id });
    const after = h.dump(DATA_TABLES);
    expect(after.transactions[0]!.OutflowConverted).toBe(1100);
    expect(useUndoStore.getState().past.at(-1)!.undo).toEqual([
      expect.objectContaining({ op: 'rules.undoRun' }),
    ]);

    await useUndoStore.getState().undo();
    expect(h.dump(DATA_TABLES)).toEqual(before);
    await useUndoStore.getState().redo();
    expect(h.dump(DATA_TABLES)).toEqual(after);
  });
});
