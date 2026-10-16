import { describe, expect, it, vi } from 'vitest';
import type { MutationSpec } from '@budgero/runtime';
import { AppRuntime } from './app-runtime';

/** AppRuntime with the coordinator stubbed; records what would be executed and sent. */
function stubRuntime() {
  const runtime = new AppRuntime();
  const sent: MutationSpec[] = [];
  const internals = runtime as unknown as {
    coordinator: { executeMutation(spec: MutationSpec): Promise<unknown> };
  };
  internals.coordinator = {
    executeMutation: vi.fn(async (spec: MutationSpec) => {
      sent.push(spec);
      return { result: undefined, synced: true, queued: false };
    }),
  };
  return { runtime, sent };
}

describe('AppRuntime prepares originating mutations once', () => {
  it('generates the row ID before executing, so the sent args carry it', async () => {
    const { runtime, sent } = stubRuntime();
    await runtime.executeMutation({
      op: 'customDashboards.create',
      payload: { budgetId: 1, name: 'Main' },
    });
    await runtime.executeMutation({
      op: 'scenarios.save',
      payload: { id: undefined, budgetId: 1, name: 'S', payload: '{}' },
    });
    await runtime.executeMutation({
      op: 'recurring.markReady',
      payload: { options: { occurrenceId: 3 } },
    });

    expect(sent[0]!.payload).toEqual({ budgetId: 1, name: 'Main', id: expect.any(String) });
    expect(sent[1]!.payload.id).toEqual(expect.any(String));
    expect(sent[2]!.payload.options).toEqual({ occurrenceId: 3, transferId: expect.any(String) });
  });

  it('keeps IDs that are already there and never re-prepares a received mutation', async () => {
    const { runtime, sent } = stubRuntime();
    await runtime.executeMutation({
      op: 'customDashboardWidgets.add',
      payload: { id: 'w-1', dashboardId: 'd', reportId: 'r', chartId: 'c' },
    });
    await runtime.executeMutation({
      op: 'customDashboards.create',
      payload: { budgetId: 1, name: 'Remote' },
      mutationId: 'remote-1',
    });

    expect(sent[0]!.payload.id).toBe('w-1');
    expect(sent[1]!.payload).toEqual({ budgetId: 1, name: 'Remote' });
  });
});
