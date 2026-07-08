import { describe, expect, it, vi } from 'vitest';
import { MutationDispatchService } from './mutation-dispatch-service';

type QueuedMutation = { id: string; op: string; args: Record<string, unknown>; spaceId?: string };

function createCtx() {
  // getUnsent mirrors the real queue: everything ever add()ed minus noteSent
  // ids, in insertion order. Derived from add.mock.calls so tests that
  // override add's implementation keep working.
  const sentIds = new Set<string>();
  const add = vi.fn(async (_m: QueuedMutation) => undefined);
  const noteSent = vi.fn((id: string) => {
    sentIds.add(id);
  });
  const getUnsent = vi.fn(async () =>
    add.mock.calls.map(([m]) => m as QueuedMutation).filter((m) => !sentIds.has(m.id))
  );
  const markApplied = vi.fn();
  return {
    markAppliedMock: markApplied,
    spaceId: 's1',
    executor: {
      execute: vi.fn(async () => ({ result: { ok: true }, mutationId: 'm1', isReceiver: false })),
    },
    sync: {
      isConnected: vi.fn(() => true),
      send: vi.fn(async () => true),
    },
    dbSync: {
      scheduleUpload: vi.fn(),
    },
    offlineQueue: {
      add,
      addInFlight: vi.fn(),
      markApplied,
      noteSent,
      getUnsent,
    },
    db: {
      saveToOPFSPublic: vi.fn(async () => undefined),
    },
  };
}

describe('MutationDispatchService', () => {
  it('returns receiver result without sync/queue', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    ctx.executor.execute.mockResolvedValue({
      result: { ok: true },
      mutationId: 'm1',
      isReceiver: true,
    });

    const out = await service.executeMutation({ op: 'x', payload: {} }, ctx as never);
    expect(out).toEqual({ result: { ok: true }, synced: false, queued: false });
    expect(ctx.sync.send).not.toHaveBeenCalled();
  });

  it('sends online and schedules upload', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();

    const out = await service.executeMutation({ op: 'x', payload: { a: 1 } }, ctx as never);

    expect(out).toEqual({ result: { ok: true }, synced: true, queued: false });
    expect(ctx.sync.send).toHaveBeenCalledWith({
      id: 'm1',
      op: 'x',
      args: { a: 1 },
      spaceId: 's1',
    });
    expect(ctx.dbSync.scheduleUpload).toHaveBeenCalled();
    expect(ctx.db.saveToOPFSPublic).toHaveBeenCalled();
  });

  it('queues durably before sending and records the send (at-least-once)', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    const order: string[] = [];
    ctx.offlineQueue.add.mockImplementation(async () => {
      order.push('add');
    });
    ctx.sync.send.mockImplementation(async () => {
      order.push('send');
      return true;
    });

    await service.executeMutation({ op: 'x', payload: { a: 1 } }, ctx as never);

    // Queued BEFORE the send attempt — removal happens only on server ack.
    expect(order).toEqual(['add', 'send']);
    expect(ctx.offlineQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', op: 'x', spaceId: 's1' })
    );
    // Durable own-mutation dedup: recorded as applied so a catch-up echo
    // after a reload can't double-apply it.
    expect(ctx.offlineQueue.markApplied).toHaveBeenCalledWith('m1');
    expect(ctx.offlineQueue.noteSent).toHaveBeenCalledWith('m1');
  });

  it('does not record a send when the socket write fails', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    ctx.sync.send.mockResolvedValue(false);

    await service.executeMutation({ op: 'x', payload: { a: 1 } }, ctx as never);

    expect(ctx.offlineQueue.add).toHaveBeenCalled();
    expect(ctx.offlineQueue.noteSent).not.toHaveBeenCalled();
  });

  it('uses shared local persistence callback when provided', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    const persistLocalDatabase = vi.fn(async () => true);
    const out = await service.executeMutation({ op: 'x', payload: { a: 1 } }, {
      ...ctx,
      persistLocalDatabase,
    } as never);

    expect(out.synced).toBe(true);
    expect(persistLocalDatabase).toHaveBeenCalled();
    expect(ctx.db.saveToOPFSPublic).not.toHaveBeenCalled();
  });

  it('queues offline/send-failed mutation and persists db best-effort', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    ctx.sync.send.mockResolvedValue(false);

    const out = await service.executeMutation({ op: 'x', payload: { a: 1 } }, ctx as never);

    expect(out).toEqual({ result: { ok: true }, synced: false, queued: true });
    expect(ctx.offlineQueue.add).toHaveBeenCalled();
    expect(ctx.db.saveToOPFSPublic).toHaveBeenCalled();
  });

  it('queues when disconnected and ignores save errors', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    ctx.sync.isConnected.mockReturnValue(false);
    ctx.db.saveToOPFSPublic = vi.fn(async () => {
      throw new Error('disk');
    });

    const out = await service.executeMutation({ op: 'x', payload: {} }, ctx as never);

    expect(out.queued).toBe(true);
    expect(ctx.offlineQueue.add).toHaveBeenCalled();
  });

  it('sends older unsent queue entries before the new mutation (causal order)', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    // An older mutation that raced a connecting socket: queued, never sent.
    await ctx.offlineQueue.add({ id: 'm0', op: 'budgets.create', args: {}, spaceId: 's1' });

    const out = await service.executeMutation({ op: 'accounts.create', payload: {} }, ctx as never);

    expect(out.synced).toBe(true);
    const sentIds = ctx.sync.send.mock.calls.map(([p]) => (p as { id: string }).id);
    expect(sentIds).toEqual(['m0', 'm1']);
    expect(ctx.offlineQueue.noteSent).toHaveBeenCalledWith('m0');
    expect(ctx.offlineQueue.noteSent).toHaveBeenCalledWith('m1');
  });

  it('does not report synced when an older unsent entry fails to send', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    await ctx.offlineQueue.add({ id: 'm0', op: 'budgets.create', args: {}, spaceId: 's1' });
    ctx.sync.send.mockResolvedValue(false);

    const out = await service.executeMutation({ op: 'accounts.create', payload: {} }, ctx as never);

    // The chain stops at m0; m1 was never sent and must stay queued.
    expect(out).toEqual({ result: { ok: true }, synced: false, queued: true });
    expect(ctx.sync.send).toHaveBeenCalledTimes(1);
    expect(ctx.offlineQueue.noteSent).not.toHaveBeenCalled();
  });

  it('skips queued entries that belong to another space', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    await ctx.offlineQueue.add({ id: 'other', op: 'x', args: {}, spaceId: 's2' });

    const out = await service.executeMutation({ op: 'x', payload: {} }, ctx as never);

    expect(out.synced).toBe(true);
    const sentIds = ctx.sync.send.mock.calls.map(([p]) => (p as { id: string }).id);
    expect(sentIds).toEqual(['m1']);
  });

  it('falls back to forceSave when saveToOPFSPublic is unavailable', async () => {
    const service = new MutationDispatchService();
    const ctx = createCtx();
    ctx.db = {
      forceSave: vi.fn(async () => undefined),
    };

    const out = await service.executeMutation({ op: 'x', payload: { a: 1 } }, ctx as never);

    expect(out.synced).toBe(true);
    expect((ctx.db as { forceSave: ReturnType<typeof vi.fn> }).forceSave).toHaveBeenCalled();
  });
});
