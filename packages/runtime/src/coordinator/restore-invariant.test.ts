import { describe, expect, it, vi } from 'vitest';
import { reapplyQueueAfterRestore } from './restore-invariant';

function payload(id: string, spaceId = 's1') {
  return { id, op: 'x.y', args: { a: 1 }, baseVersion: 0, timestamp: new Date(), spaceId };
}

describe('reapplyQueueAfterRestore', () => {
  it('resets dedup, re-applies queued mutations in order, re-marks in-flight, persists', async () => {
    const calls: string[] = [];
    const offlineQueue = {
      resetForRestore: vi.fn(() => calls.push('reset')),
      getQueue: vi.fn(async () => [payload('m1'), payload('m2')]),
      addInFlight: vi.fn((id: string) => calls.push(`inflight:${id}`)),
    };
    const executor = {
      execute: vi.fn(async (spec: { mutationId: string }) => {
        calls.push(`apply:${spec.mutationId}`);
        return {};
      }),
    };
    const persistLocalDatabase = vi.fn(async () => {
      calls.push('persist');
      return true;
    });

    await reapplyQueueAfterRestore({
      spaceId: 's1',
      offlineQueue,
      executor,
      persistLocalDatabase,
    });

    expect(calls).toEqual([
      'reset',
      'apply:m1',
      'inflight:m1',
      'apply:m2',
      'inflight:m2',
      'persist',
    ]);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'x.y', mutationId: 'm1', spaceId: 's1' })
    );
  });

  it('skips other-space entries and still marks in-flight when an apply fails', async () => {
    const offlineQueue = {
      resetForRestore: vi.fn(),
      getQueue: vi.fn(async () => [payload('other', 's2'), payload('m1')]),
      addInFlight: vi.fn(),
    };
    const executor = {
      execute: vi.fn(async () => {
        throw new Error('op exploded');
      }),
    };
    const log = vi.fn();

    await reapplyQueueAfterRestore({
      spaceId: 's1',
      offlineQueue,
      executor,
      persistLocalDatabase: async () => true,
      log,
    });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    // Even a failed re-apply is marked in-flight: the catch-up echo must
    // dedup rather than attempt a second apply of a mutation whose op is
    // fundamentally broken against this DB state.
    expect(offlineQueue.addInFlight).toHaveBeenCalledWith('m1');
    expect(offlineQueue.addInFlight).not.toHaveBeenCalledWith('other');
    expect(log).toHaveBeenCalled();
  });
});
