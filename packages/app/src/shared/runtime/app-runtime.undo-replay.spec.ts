import { describe, expect, it, vi } from 'vitest';
import { REQUIRES_FORMAT_ARG, type MutationSpec } from '@budgero/runtime';
import { AppRuntime } from './app-runtime';

const pushApi = vi.hoisted(() => ({
  getQueue: vi.fn(),
  ackQueueItem: vi.fn(async () => {}),
}));
vi.mock('@shared/api/api-client', () => ({ pushApi }));

const RULES = [{ id: 3, enabled: true, mode: 'continuous', runOrder: 1 }];

/** AppRuntime with the coordinator and services stubbed; records every op. */
function stubRuntime(
  pushed: Record<string, unknown> = {
    v: 2,
    op: 'transactions.add',
    args: { budgetId: 1, accountId: 2, date: '2026-09-01', outflow: 1000 },
  }
) {
  const runtime = new AppRuntime();
  const ops: MutationSpec[] = [];
  const internals = runtime as unknown as {
    coordinator: Record<string, unknown>;
    serviceManager: { getServices(): unknown; getDatabase(): unknown };
  };
  const db = {};
  internals.coordinator = {
    getDatabase: () => db,
    executeMutation: vi.fn(async (spec: MutationSpec) => {
      ops.push(spec);
      return { result: 42, synced: true, queued: false };
    }),
    getActiveSpaceId: () => 'space-1',
    isMutationApplied: () => false,
    getEncryption: () => ({
      decryptMutation: async () => pushed,
    }),
  };
  internals.serviceManager = {
    getServices: () => ({
      rules: { listRules: () => RULES },
      mutationHistory: { record: () => {} },
      budgets: { getAllBudgets: () => [{ ID: 1 }] },
    }),
    getDatabase: () => db,
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

  it('applies a pushed time as format 7 and drops an invalid one, never the push', async () => {
    const push = (time: unknown) =>
      stubRuntime({
        v: 7,
        op: 'transactions.add',
        args: { budgetId: 1, accountId: 2, date: '2026-09-01', outflow: 1000, time },
      });
    pushApi.getQueue.mockResolvedValue({
      items: [{ id: 'q1', encrypted_payload: 'x', message_id: 'm1' }],
    });

    const valid = push('14:30');
    await valid.runtime.processPushQueue();
    const added = valid.ops.find((spec) => spec.op === 'transactions.add');
    expect(added?.payload).toMatchObject({ time: '14:30', [REQUIRES_FORMAT_ARG]: 7 });

    const invalid = push('7pm');
    await invalid.runtime.processPushQueue();
    const kept = invalid.ops.find((spec) => spec.op === 'transactions.add');
    expect(kept?.payload).toMatchObject({ outflow: 1000 });
    expect(kept?.payload).not.toHaveProperty('time');
    expect(kept?.payload).not.toHaveProperty(REQUIRES_FORMAT_ARG);
  });
});
