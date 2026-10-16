import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// The equivalence test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import type { MutationSpec } from '@budgero/runtime';
import { AppRuntime } from './app-runtime';

type Rule = { id: number; enabled: boolean; mode: string; runOrder: number };

/** AppRuntime with the coordinator and services stubbed; records every op. */
function stubRuntime(rules: Rule[], resultFor: (spec: MutationSpec) => unknown = () => 1) {
  const runtime = new AppRuntime();
  const ops: MutationSpec[] = [];
  const internals = runtime as unknown as {
    coordinator: { executeMutation(spec: MutationSpec): Promise<unknown> };
    serviceManager: { getServices(): unknown };
  };
  internals.coordinator = {
    executeMutation: vi.fn(async (spec: MutationSpec) => {
      ops.push(spec);
      return { result: resultFor(spec), synced: true, queued: false };
    }),
  };
  internals.serviceManager = { getServices: () => ({ rules: { listRules: () => rules } }) };
  const ruleOps = () =>
    ops
      .filter((spec) => spec.op === 'rules.execute')
      .map((spec) => {
        const payload = spec.payload as {
          ruleId: number;
          options: { transactionIds: number[] };
        };
        return [payload.ruleId, payload.options.transactionIds];
      });
  return { runtime, ops, ruleOps };
}

const RULES: Rule[] = [
  { id: 7, enabled: true, mode: 'continuous', runOrder: 2 },
  { id: 3, enabled: true, mode: 'continuous', runOrder: 1 },
  { id: 5, enabled: false, mode: 'continuous', runOrder: 0 },
  { id: 9, enabled: true, mode: 'one_time', runOrder: 0 },
];

describe('AppRuntime continuous rules', () => {
  it('runs each enabled continuous rule once over a batch, in runOrder', async () => {
    const { runtime, ruleOps, ops } = stubRuntime(RULES);

    await runtime.runContinuousRules(1, [11, 12, 13], { skipInvalidate: true });

    expect(ruleOps()).toEqual([
      [3, [11, 12, 13]],
      [7, [11, 12, 13]],
    ]);
    expect(ops[0]!.meta).toMatchObject({ skipUndo: true, skipInvalidate: true });
  });

  it('splits very large batches', async () => {
    const { runtime, ruleOps } = stubRuntime([RULES[1]!]);
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);

    await runtime.runContinuousRules(1, ids);

    expect(ruleOps().map(([, chunk]) => (chunk as number[]).length)).toEqual([500, 500, 201]);
    expect(ruleOps().flatMap(([, chunk]) => chunk as number[])).toEqual(ids);
  });

  it('still runs rules right after a plain add, one op per rule', async () => {
    const { runtime, ruleOps } = stubRuntime(RULES, () => 42);

    await runtime.executeMutation({ op: 'transactions.add', payload: { budgetId: 1 } });

    expect(ruleOps()).toEqual([
      [3, [42]],
      [7, [42]],
    ]);
  });

  it('keeps transfer legs one at a time', async () => {
    const { runtime, ruleOps } = stubRuntime(RULES, (spec) =>
      spec.op === 'transactions.addTransfer' ? { sourceId: 1, destinationId: 2 } : null
    );

    await runtime.executeMutation({ op: 'transactions.addTransfer', payload: { budgetId: 1 } });

    expect(ruleOps()).toEqual([
      [3, [1]],
      [7, [1]],
      [3, [2]],
      [7, [2]],
    ]);
  });

  it('leaves rules to the caller when an import defers them', async () => {
    const { runtime, ruleOps } = stubRuntime(RULES, () => ({ transactionId: 5, created: true }));

    await runtime.executeMutation({
      op: 'transactions.import',
      payload: { budgetId: 1 },
      meta: { skipInvalidate: true, deferContinuousRules: true },
    });
    expect(ruleOps()).toEqual([]);

    await runtime.executeMutation({ op: 'transactions.import', payload: { budgetId: 1 } });
    expect(ruleOps()).toEqual([
      [3, [5]],
      [7, [5]],
    ]);
  });
});

async function createServices(): Promise<Services> {
  const manager = new ServiceManager();
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    await manager.initialize(await NodeSqlJsAdapter.create());
  } finally {
    cwd.mockRestore();
  }
  return manager.getServices();
}

/** Same budget, rules and rows in a fresh DB; returns the created transaction ids. */
async function seed(services: Services) {
  const budgetId = await services.budgets.createBudget({
    name: 'Rules',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const account = await services.accounts.createAccount(
    'Checking',
    budgetId,
    'Checking',
    'USD',
    asMilli(0),
    {},
    true
  );
  const categories = services.categories.getAllCategories(budgetId) as { ID: number }[];
  const [shopping, fees] = [categories[0]!.ID, categories[1]!.ID];
  // Order-dependent chain: rule 2 only matches what rule 1 renamed, rule 3
  // only what rule 2 categorized.
  services.rules.createRule({
    budgetId,
    name: 'rename amazon',
    runOrder: 1,
    conditions: [{ field: 'payee', operator: 'contains', value: 'AMZN' }],
    actions: [{ type: 'payee.set', payload: { payee: 'Amazon' } }],
  });
  services.rules.createRule({
    budgetId,
    name: 'categorize amazon',
    runOrder: 2,
    conditions: [{ field: 'payee', operator: 'equals', value: 'Amazon' }],
    actions: [
      { type: 'category.set', payload: { categoryId: shopping } },
      { type: 'memo.remove_regex', payload: { pattern: 'REF\\d+' } },
    ],
  });
  services.rules.createRule({
    budgetId,
    name: 'fee surcharge',
    runOrder: 3,
    conditions: [{ field: 'memo', operator: 'contains', value: 'fee' }],
    actions: [
      { type: 'category.set', payload: { categoryId: fees } },
      { type: 'amount.adjust_percent', payload: { percent: 10 } },
    ],
  });
  const ids: number[] = [];
  const payees = ['AMZN Mktp', 'Coffee', 'AMZN Prime', 'Bank', 'Grocer'];
  for (let i = 0; i < 25; i++) {
    ids.push(
      await services.transactions.addTransaction(
        asMilli(0),
        asMilli(10 + i),
        account.ID,
        0,
        budgetId,
        `2026-09-${String(1 + (i % 9)).padStart(2, '0')}`,
        i % 4 === 0 ? `card fee REF${i}` : `REF${i} order`,
        '',
        payees[i % payees.length]
      )
    );
  }
  return { budgetId, ids };
}

function snapshot(services: Services, budgetId: number) {
  return (
    services.transactions.getAllTransactions(budgetId) as unknown as Record<string, unknown>[]
  )
    .map((tx) => ({
      id: tx.ID,
      date: tx.Date,
      payee: tx.Payee,
      memo: tx.Memo,
      category: tx.CategoryID,
      account: tx.AccountID,
      inflow: tx.InflowConverted,
      outflow: tx.OutflowConverted,
    }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function realRuntime(services: Services) {
  const runtime = new AppRuntime();
  const internals = runtime as unknown as {
    coordinator: { executeMutation(spec: MutationSpec): Promise<unknown> };
    serviceManager: { getServices(): unknown };
  };
  let ops = 0;
  internals.coordinator = {
    executeMutation: async (spec: MutationSpec) => {
      ops++;
      const { ruleId, options } = spec.payload as {
        ruleId: number;
        options: Record<string, unknown>;
      };
      return { result: await services.rules.executeRule(ruleId, options), synced: true };
    },
  };
  internals.serviceManager = { getServices: () => services };
  return { runtime, opCount: () => ops };
}

describe('batched continuous rules match per-transaction runs', () => {
  it('leaves every transaction exactly as one-at-a-time runs did', async () => {
    const perRow = await createServices();
    const batched = await createServices();
    const a = await seed(perRow);
    const b = await seed(batched);
    expect(snapshot(perRow, a.budgetId)).toEqual(snapshot(batched, b.budgetId));

    // Old fan-out: one rules.execute per (transaction x rule).
    const old = realRuntime(perRow);
    for (const id of a.ids) await old.runtime.runContinuousRules(a.budgetId, [id]);
    // New: one per rule for the whole batch.
    const now = realRuntime(batched);
    await now.runtime.runContinuousRules(b.budgetId, b.ids);

    expect(old.opCount()).toBe(75);
    expect(now.opCount()).toBe(3);
    const after = snapshot(batched, b.budgetId);
    expect(after).toEqual(snapshot(perRow, a.budgetId));
    // The rules did fire (the chain renamed, categorized and surcharged).
    expect(after.filter((tx) => tx.payee === 'Amazon')).toHaveLength(10);
    expect(after.some((tx) => tx.memo === 'order')).toBe(true);
    expect(after.find((tx) => tx.id === a.ids[0])?.outflow).toBe(11);
  });
});
