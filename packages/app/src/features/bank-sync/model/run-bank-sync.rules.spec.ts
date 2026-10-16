import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The integration test needs the Node database adapter; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import type { SimpleFINAccountSet } from '@budgero/core/browser';
import { executeMutationOp } from '@shared/mutations/op-code-registry';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import { runBankSync } from './run-bank-sync';

const state = vi.hoisted(() => ({
  services: undefined as Services | undefined,
  applied: new Set<string>(),
  remote: { errors: [], accounts: [] } as SimpleFINAccountSet,
  metas: [] as unknown[],
}));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => state.services }),
}));
vi.mock('@shared/runtime/mutation-router', () => ({
  executeSpaceMutation: async (
    _runtime: unknown,
    spec: { op: string; payload: Record<string, unknown>; idempotencyKey?: string; meta?: unknown }
  ) => {
    if (spec.idempotencyKey) state.applied.add(spec.idempotencyKey);
    if (spec.op === 'transactions.import') state.metas.push(spec.meta);
    return executeMutationOp(spec.op, spec.payload);
  },
}));
vi.mock('../lib/simplefin-client', () => ({
  fetchTransactions: async () => structuredClone(state.remote),
}));

const posted = (day: number) => Math.floor(new Date(2026, 8, day, 12).getTime() / 1000);

describe('bank sync continuous rules', () => {
  let budgetId: number;

  beforeEach(async () => {
    const manager = new ServiceManager();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
    try {
      await manager.initialize(await NodeSqlJsAdapter.create());
    } finally {
      cwd.mockRestore();
    }
    const services = manager.getServices();
    state.services = services;
    state.applied.clear();
    state.metas = [];
    budgetId = await services.budgets.createBudget({
      name: 'Bank sync',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    services.bankSync.saveConnection(budgetId, 'https://u:p@bridge.example/simplefin');
    const account = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'Checking',
      'USD',
      asMilli(0),
      {},
      true
    );
    services.bankSync.saveLink({
      budgetId,
      accountId: account.ID,
      externalAccountId: 'ACT-1',
      externalName: 'Everyday Checking',
      orgName: 'Bank',
      importFrom: '2026-09-01',
    });
  });

  it('runs continuous rules once over the created rows, not per row', async () => {
    state.remote = {
      errors: [],
      accounts: [
        {
          org: { 'sfin-url': 'https://bridge.example', name: 'Bank' },
          id: 'ACT-1',
          name: 'Everyday Checking',
          currency: 'USD',
          balance: '900.00',
          'balance-date': posted(10),
          transactions: [2, 3, 4].map((day) => ({
            id: `t${day}`,
            posted: posted(day),
            amount: `-${day}.00`,
            description: `Shop ${day}`,
          })),
        },
      ],
    };
    const runContinuousRules = vi.fn(async () => undefined);
    const runtime = {
      services: () => state.services!,
      isMutationApplied: (id: string) => state.applied.has(id),
      save: async () => undefined,
      runContinuousRules,
    } as unknown as AppRuntime;

    expect((await runBankSync(runtime, budgetId)).imported).toBe(3);

    expect(state.metas).toHaveLength(3);
    expect(
      state.metas.every((meta) => (meta as { deferContinuousRules?: boolean }).deferContinuousRules)
    ).toBe(true);
    expect(runContinuousRules).toHaveBeenCalledTimes(1);
    const created = state.services!.transactions.getAllTransactions(budgetId).map((tx) => tx.ID);
    expect(runContinuousRules).toHaveBeenCalledWith(budgetId, expect.any(Array), {
      skipInvalidate: true,
    });
    const [, ids] = runContinuousRules.mock.calls[0] as unknown as [number, number[]];
    expect([...ids].sort()).toEqual([...created].sort());

    // A second sync dedups every row: nothing new, no rules on old rows.
    runContinuousRules.mockClear();
    expect((await runBankSync(runtime, budgetId)).imported).toBe(0);
    expect(runContinuousRules).toHaveBeenCalledWith(budgetId, [], { skipInvalidate: true });
  });
});
