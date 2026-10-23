import { describe, expect, it, vi } from 'vitest';
import type { MutationSpec } from '@budgero/runtime';
import { AppRuntime } from './app-runtime';

const pushApi = vi.hoisted(() => ({
  getQueue: vi.fn(),
  ackQueueItem: vi.fn(async () => {}),
}));
vi.mock('@shared/api/api-client', () => ({ pushApi }));

const RULES = [{ id: 3, enabled: true, mode: 'continuous', runOrder: 1 }];

/** AppRuntime with the coordinator and services stubbed; records every op. */
function stubRuntime() {
  const runtime = new AppRuntime();
  const ops: MutationSpec[] = [];
  const internals = runtime as unknown as {
    coordinator: Record<string, unknown>;
    serviceManager: { getServices(): unknown };
  };
  internals.coordinator = {
    executeMutation: vi.fn(async (spec: MutationSpec) => {
      ops.push(spec);
      return { result: 42, synced: true, queued: false };
    }),
    getActiveSpaceId: () => 'space-1',
    isMutationApplied: () => false,
    getEncryption: () => ({
      decryptMutation: async () => ({
        v: 2,
        op: 'transactions.add',
        args: { budgetId: 1, accountId: 2, date: '2026-09-01', outflow: 1000 },
      }),
    }),
  };
  internals.serviceManager = {
    getServices: () => ({
      rules: { listRules: () => RULES },
      mutationHistory: { record: () => {} },
      budgets: { getAllBudgets: () => [{ ID: 1 }] },
    }),
  };
  const ruleRuns = () => ops.filter((spec) => spec.op === 'rules.execute').length;
  return { runtime, ops, ruleRuns };
}

describe('AppRuntime and undo/redo replays', () => {
  it('does not re-run continuous rules on a row restored by undo', async () => {
    const { runtime, ruleRuns } = stubRuntime();

    await runtime.executeMutation({
      op: 'transactions.add',
      payload: { budgetId: 1 },
      meta: { skipUndo: true, replay: 'undo' },
    });

    expect(ruleRuns()).toBe(0);
  });

  it('runs them on redo, like the original add did', async () => {
    const { runtime, ruleRuns } = stubRuntime();

    await runtime.executeMutation({
      op: 'transactions.add',
      payload: { budgetId: 1 },
      meta: { skipUndo: true, replay: 'redo' },
    });

    expect(ruleRuns()).toBe(1);
  });

  it('keeps Push API items off the Ctrl+Z stack', async () => {
    const { runtime, ops } = stubRuntime();
    pushApi.getQueue.mockResolvedValue({
      items: [{ id: 'q1', encrypted_payload: 'x', message_id: 'm1' }],
    });

    await runtime.processPushQueue();

    const pushed = ops.find((spec) => spec.op === 'transactions.add');
    expect(pushed?.meta?.skipUndo).toBe(true);
  });
});
