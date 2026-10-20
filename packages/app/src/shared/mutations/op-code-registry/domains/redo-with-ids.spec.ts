import { describe, expect, it, vi } from 'vitest';
import { getUndoSpec, REDO_WITH_IDS } from '@shared/mutations/op-code-registry';

let counters: Record<string, number> = { payees: 4 };
const history = {
  idCounters: () => ({ ...counters }),
  allocatedIds: (before: Record<string, number>) => {
    const out: Record<string, [number | null, number]> = {};
    for (const [table, after] of Object.entries(counters)) {
      if (after > (before[table] ?? 0)) out[table] = [before[table] ?? null, after];
    }
    return out;
  },
  withReusedIds: vi.fn(async (_range: unknown, fn: () => unknown) => fn()),
};

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({ mutationHistory: history }),
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

type Spec = {
  capture: (args: Record<string, unknown>) => Promise<unknown>;
  buildRedo: (args: Record<string, unknown>, result: unknown, before: unknown) => unknown;
};

describe('redo carries the IDs the first run allocated', () => {
  it('wraps the redo in history.redoWithIds when the op allocated rows', async () => {
    counters = { payees: 4 };
    const spec = getUndoSpec('labels.add') as unknown as Spec;
    const args = { budgetId: 1, name: 'Trip' };
    const before = await spec.capture(args);
    counters = { payees: 4, labels: 7 };
    expect(spec.buildRedo(args, 7, before)).toEqual([
      {
        op: REDO_WITH_IDS,
        args: {
          ids: { labels: [null, 7] },
          ops: [{ op: 'labels.add', args: { ...args, id: 7 } }],
        },
      },
    ]);
  });

  it('keeps the plain redo when nothing was allocated', async () => {
    counters = { payees: 4 };
    const spec = getUndoSpec('labels.add') as unknown as Spec;
    const args = { budgetId: 1, name: 'Trip' };
    const before = await spec.capture(args);
    expect(spec.buildRedo(args, 7, before)).toEqual([
      { op: 'labels.add', args: { ...args, id: 7 } },
    ]);
  });
});
