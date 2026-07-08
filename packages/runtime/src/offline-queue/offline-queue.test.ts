import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueue } from './offline-queue';
import { InMemoryQueueStorage } from './storage';
import { createStorageMock } from '../__tests__/storage-mock';

function mutation(id: string) {
  return {
    id,
    baseVersion: 0,
    op: 'x.y',
    args: { a: 1 },
    timestamp: new Date('2024-01-01T00:00:00Z'),
    spaceId: 's1',
  };
}

describe('OfflineQueue', () => {
  const localStorageMock = createStorageMock();

  afterEach(() => {
    localStorageMock.clear();
    vi.unstubAllGlobals();
  });

  it('adds, reads, and clears queued mutations', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());

    await q.add(mutation('m1'));
    expect(await q.hasQueued()).toBe(true);
    expect(await q.getLength()).toBe(1);
    expect(q.hasQueuedNow()).toBe(true);

    await q.clear();
    expect(await q.getQueue()).toEqual([]);
  });

  it('tracks applied and in-flight ids', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    await q.add(mutation('m1'));
    await q.add(mutation('m2'));

    q.addInFlight('m1');
    expect(q.isInFlight('m1')).toBe(true);

    q.markApplied('m1');
    expect(q.isApplied('m1')).toBe(true);
    expect(q.isInFlight('m1')).toBe(false);

    await q.ackMutation('m1');
    await q.ackMutation('m2');
    expect(await q.getLength()).toBe(0);
  });

  it('dequeues on ack only, and marks the id applied', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    await q.add(mutation('m1'));
    await q.add(mutation('m2'));

    q.noteSent('m1');
    // A send never removes anything — only the server ack does.
    expect(await q.getLength()).toBe(2);

    await q.ackMutation('m1');
    expect(await q.getLength()).toBe(1);
    expect(q.isApplied('m1')).toBe(true);
    expect((await q.getQueue())[0]?.id).toBe('m2');

    // Acking an unknown id is a safe no-op.
    await q.ackMutation('missing');
    expect(await q.getLength()).toBe(1);
  });

  it('reports never-sent and stale-sent mutations for the resend sweep', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    await q.add(mutation('m1'));
    await q.add(mutation('m2'));
    await q.add(mutation('m3'));

    const t0 = 1_000_000;
    q.noteSent('m1', t0); // stale by t0 + 15s
    q.noteSent('m2', t0 + 14_000); // fresh at t0 + 15s
    // m3 never sent — always a candidate

    const stale = await q.getStale(15_000, t0 + 15_000);
    expect(stale.map((m) => m.id)).toEqual(['m1', 'm3']);

    await q.ackMutation('m1');
    const after = await q.getStale(15_000, t0 + 15_000);
    expect(after.map((m) => m.id)).toEqual(['m3']);
  });

  it('sets queue and auto-fills missing spaceId', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    const m = mutation('m1');
    // emulate malformed payload
    delete (m as { spaceId?: string }).spaceId;

    await q.add(m);
    const items = await q.getQueue();
    expect(items[0]?.spaceId).toBe('s1');

    await q.setQueue([mutation('m2')]);
    expect(await q.getLength()).toBe(1);
  });

  it('trims stored applied ids', () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    for (let i = 0; i < 2100; i += 1) {
      q.markApplied(`m-${i}`);
    }
    // markApplied is memory-only; the durable write happens on flush (which
    // rides on successful DB persists in production).
    expect(localStorageMock.getItem('budgero_applied_mutations_v1_s1')).toBe(null);
    q.flushAppliedIds();
    const raw = localStorageMock.getItem('budgero_applied_mutations_v1_s1');
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    expect(parsed.length).toBeLessThanOrEqual(2000);
    expect(parsed[parsed.length - 1]).toBe('m-2099');
  });

  it('resetForRestore clears applied and in-flight dedup durably', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    q.markApplied('m1');
    q.addInFlight('m2');
    q.flushAppliedIds();
    expect(q.isApplied('m1')).toBe(true);

    q.resetForRestore();
    expect(q.isApplied('m1')).toBe(false);
    expect(q.isInFlight('m2')).toBe(false);
    const raw = localStorageMock.getItem('budgero_applied_mutations_v1_s1');
    expect(raw ? (JSON.parse(raw) as string[]) : []).toEqual([]);
  });

  it('resetSendState makes every queued entry a resend candidate again', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    await q.add(mutation('m1'));
    q.noteSent('m1');
    expect((await q.getUnsent()).map((m) => m.id)).toEqual([]);

    q.resetSendState();
    expect((await q.getUnsent()).map((m) => m.id)).toEqual(['m1']);
  });

  it('memoizes the first storage load so concurrent adds cannot drop entries', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    let resolveLoad!: (value: never[]) => void;
    const slowStorage = {
      load: vi.fn(
        () =>
          new Promise<never[]>((resolve) => {
            resolveLoad = resolve;
          })
      ),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const q = new OfflineQueue('s1', slowStorage as never);

    // Two adds race the initial load; both must share ONE load and neither
    // may be wiped by a late-resolving second load.
    const p1 = q.add(mutation('m1'));
    const p2 = q.add(mutation('m2'));
    resolveLoad([]);
    await Promise.all([p1, p2]);

    expect(slowStorage.load).toHaveBeenCalledTimes(1);
    expect((await q.getQueue()).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('covers removeInFlight and applied-id load branches', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem('budgero_applied_mutations_v1_s1', JSON.stringify({ nope: true }));
    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    expect(q.isApplied('m1')).toBe(false);
    q.addInFlight('m1');
    q.removeInFlight('m1');
    expect(q.isInFlight('m1')).toBe(false);
    expect(q.hasQueuedNow()).toBe(false);
    expect(q.peekQueueLength()).toBe(0);
    await q.getQueue();
    expect(q.peekQueueLength()).toBe(0);
  });

  it('handles malformed and failing localStorage during applied-id persistence', () => {
    const failingStorage = {
      getItem: vi
        .fn()
        .mockReturnValueOnce('not-json')
        .mockImplementation(() => JSON.stringify(['x'])),
      setItem: vi.fn(() => {
        throw new Error('set failed');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      get length() {
        return 0;
      },
    };
    vi.stubGlobal('localStorage', failingStorage as unknown as Storage);

    const q = new OfflineQueue('s1', new InMemoryQueueStorage());
    expect(() => q.markApplied('m1')).not.toThrow();
    expect(() => q.markApplied('m2')).not.toThrow();
  });
});
