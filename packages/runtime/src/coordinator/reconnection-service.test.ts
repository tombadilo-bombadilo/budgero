import { describe, expect, it, vi } from 'vitest';
import { CancellationError } from '../utils/diagnostics';
import type { ConnectivityState, MutationPayload } from '../types';
import { ReconnectionService } from './reconnection-service';

function createState(overrides: Partial<ConnectivityState> = {}): ConnectivityState {
  return {
    clerkToken: true,
    apiReachable: true,
    wsConnected: true,
    overall: true,
    lastChecked: Date.now(),
    selfHostable: false,
    ...overrides,
  };
}

type RuntimeState =
  | 'Idle'
  | 'Initializing'
  | 'Ready'
  | 'SwitchingSpace'
  | 'Reconnecting'
  | 'Degraded'
  | 'Error'
  | 'Destroyed';

function createQueueItem(id: string, spaceId: string): MutationPayload {
  return {
    id,
    baseVersion: 0,
    op: 'tx.create',
    args: { amount: 1 },
    timestamp: new Date('2024-01-01T00:00:00Z'),
    spaceId,
  };
}

describe('ReconnectionService', () => {
  it('runs full online reconnection workflow and replays queue', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let runtimeState: RuntimeState = 'Ready';
    let connectivityState = createState({ overall: false, wsConnected: false });

    const setState = vi.fn((next: RuntimeState) => {
      runtimeState = next;
    });
    const emitOverlay = vi.fn();
    const downloadLatest = vi.fn(async () => undefined);
    const noteSent = vi.fn();
    const updateSyncStatus = vi.fn();
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ result: null, mutationId: 'm1', isReceiver: true })
      .mockRejectedValueOnce(new Error('already applied'));

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getState() {
          return connectivityState;
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState: setState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest,
      getActiveContext: () => ({
        spaceId: 'space_1',
        executor: { execute },
        offlineQueue: {
          hasQueued: async () => true,
          getQueue: async () => [
            createQueueItem('m1', 'space_1'),
            createQueueItem('m2', 'other'),
            createQueueItem('m3', 'space_1'),
          ],
          getStale: async () => [],
          noteSent,
        },
        sync: {
          isConnected: () => true,
          setBufferMode: vi.fn(),
          flushBuffer: vi.fn(async () => undefined),
          updateSyncStatus,
          send,
        },
        dbSync: {
          upload: vi.fn(async () => undefined),
        },
      }),
      emitOverlay,
      policy: { cooldownMs: 0, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      setTimeout: ((cb: () => void) => {
        cb();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
      log: vi.fn(),
    });

    service.start();
    expect(listener).not.toBeNull();

    await listener!(connectivityState); // first callback ignored
    connectivityState = createState({ overall: false, wsConnected: false });
    await listener!(connectivityState); // establish prevOverall=false
    connectivityState = createState({ overall: true, wsConnected: true });
    await listener!(connectivityState); // trigger reconnection

    expect(setState).toHaveBeenCalledWith('Reconnecting');
    expect(setState).toHaveBeenCalledWith('Ready');
    expect(downloadLatest).toHaveBeenCalled();
    // At-least-once: replay records sends but never removes queue entries —
    // only the server's mutation_ack (via ackMutation) dequeues.
    expect(noteSent).toHaveBeenCalledWith('m1');
    expect(noteSent).not.toHaveBeenCalledWith('m2'); // other space, skipped
    expect(noteSent).not.toHaveBeenCalledWith('m3'); // send returned false
    expect(updateSyncStatus).toHaveBeenCalledWith({ isSyncing: true, syncError: null });
    expect(emitOverlay).toHaveBeenCalledWith('syncing');
    expect(emitOverlay).toHaveBeenCalledWith('success');
    expect(emitOverlay).toHaveBeenCalledWith('hidden');
  });

  it('replays queued mutations on ws-only reconnect path and handles failures', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;

    const setBufferMode = vi.fn();
    const flushBuffer = vi.fn(async () => {
      throw new Error('flush failed');
    });
    const updateSyncStatus = vi.fn();
    const dbUpload = vi.fn(async () => {
      throw new Error('upload failed');
    });

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getState() {
          return createState({ overall: false, wsConnected: true });
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Ready',
      setRuntimeState: vi.fn(),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: Date.now(),
        hasLocalChangesSinceLastDownload: true,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => ({
        spaceId: 'space_1',
        executor: {
          execute: vi.fn(async () => ({ result: null, mutationId: 'm1', isReceiver: true })),
        },
        offlineQueue: {
          hasQueued: async () => true,
          getQueue: async () => [createQueueItem('m1', 'space_1')],
          getStale: async () => [],
          noteSent: vi.fn(),
        },
        sync: {
          isConnected: () => true,
          setBufferMode,
          flushBuffer,
          updateSyncStatus,
          send: vi.fn(async () => true),
        },
        dbSync: {
          upload: dbUpload,
        },
      }),
      emitOverlay: vi.fn(),
      policy: { cooldownMs: 0, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      log: vi.fn(),
    });

    service.start();
    await listener!(createState({ overall: false, wsConnected: true })); // first ignored
    await listener!(createState({ overall: false, wsConnected: true })); // ws-only branch

    expect(setBufferMode).toHaveBeenCalledWith(true);
    // flushBuffer threw, so buffer mode is force-disabled...
    expect(setBufferMode).toHaveBeenCalledWith(false);
    // ...and replay proceeds to the blob upload, whose failure lands in status.
    expect(dbUpload).toHaveBeenCalled();
    expect(updateSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ isSyncing: false, syncError: 'upload failed' })
    );
  });

  it('degrades runtime when online transition fails and respects cooldown', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let runtimeState: RuntimeState = 'Ready';
    let nowValue = 10_000;

    const setState = vi.fn((next: RuntimeState) => {
      runtimeState = next;
    });

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getState() {
          return createState({ overall: false, wsConnected: false });
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState: setState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => {
        throw new CancellationError();
      }),
      getActiveContext: () => null,
      emitOverlay: vi.fn(),
      policy: { cooldownMs: 5000, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      now: () => nowValue,
      log: vi.fn(),
    });

    service.start();
    await listener!(createState({ overall: false, wsConnected: false })); // first ignored
    await listener!(createState({ overall: false, wsConnected: false })); // prevOverall false
    await listener!(createState({ overall: true, wsConnected: true })); // transitions, then state false => degrade

    expect(setState).toHaveBeenCalledWith('Reconnecting');
    expect(setState).toHaveBeenCalledWith('Degraded');

    setState.mockClear();
    nowValue = 10_100; // within cooldown
    await listener!(createState({ overall: false, wsConnected: false }));
    await listener!(createState({ overall: true, wsConnected: true }));
    expect(setState).not.toHaveBeenCalled();
  });

  it('does not force Ready when runtime state changed during reconnect', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let connectivityState = createState({ overall: false });
    let runtimeState: RuntimeState = 'Ready';

    const setStateCalls: string[] = [];

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getState() {
          return connectivityState;
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState: (next) => {
        setStateCalls.push(next);
        runtimeState = next;
        if (next === 'Reconnecting') {
          runtimeState = 'SwitchingSpace';
        }
      },
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: Date.now(),
        hasLocalChangesSinceLastDownload: true,
      }),
      downloadLatest: async () => {},
      getActiveContext: () => ({
        spaceId: 'space_1',
        executor: {
          execute: async () => ({ result: null, mutationId: 'm1', isReceiver: false }),
        },
        offlineQueue: {
          hasQueued: async () => false,
          getQueue: async () => [],
          getStale: async () => [],
          noteSent: () => {},
        },
        sync: {
          isConnected: () => true,
          setBufferMode: () => {},
          flushBuffer: async () => {},
          updateSyncStatus: () => {},
          send: async () => true,
        },
        dbSync: {
          upload: async () => {},
        },
      }),
      emitOverlay: () => {},
      policy: { cooldownMs: 0, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      setTimeout: ((cb: () => void) => {
        cb();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => {}) as unknown as typeof clearTimeout,
      log: () => {},
    });

    service.start();
    expect(listener).not.toBeNull();

    await listener!(connectivityState);
    connectivityState = createState({ overall: false, wsConnected: false });
    await listener!(connectivityState);
    connectivityState = createState({ overall: true, wsConnected: true });
    await listener!(connectivityState);

    expect(setStateCalls).toContain('Reconnecting');
    expect(setStateCalls).not.toContain('Ready');
    expect(runtimeState).toBe('SwitchingSpace');
  });

  it('suppresses workspace-switch connectivity flaps before normal reconnect handling', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let runtimeState: RuntimeState = 'Ready';
    let connectivityState = createState({ overall: false, wsConnected: false });
    const setRuntimeState = vi.fn((next: RuntimeState) => {
      runtimeState = next;
    });
    const emitOverlay = vi.fn();

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getState() {
          return connectivityState;
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: Date.now(),
        hasLocalChangesSinceLastDownload: true,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => null,
      emitOverlay,
      policy: { cooldownMs: 0, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      setTimeout: ((cb: () => void) => {
        cb();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
      log: vi.fn(),
    });

    service.start();
    expect(listener).not.toBeNull();

    await listener!(connectivityState); // first callback ignored

    runtimeState = 'SwitchingSpace';
    connectivityState = createState({ overall: false, wsConnected: false });
    await listener!(connectivityState);

    runtimeState = 'Ready';
    connectivityState = createState({ overall: true, wsConnected: true });
    await listener!(connectivityState);

    expect(setRuntimeState).not.toHaveBeenCalledWith('Reconnecting');
    expect(emitOverlay).not.toHaveBeenCalledWith('syncing');

    connectivityState = createState({ overall: false, wsConnected: false });
    await listener!(connectivityState);
    connectivityState = createState({ overall: true, wsConnected: true });
    await listener!(connectivityState);

    expect(setRuntimeState).toHaveBeenCalledWith('Reconnecting');
    expect(emitOverlay).toHaveBeenCalledWith('syncing');
  });

  it('ignores token-only overall flaps when api+ws stay connected', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let runtimeState: RuntimeState = 'Ready';
    let connectivityState = createState({
      clerkToken: true,
      apiReachable: true,
      wsConnected: true,
      overall: true,
    });

    const setRuntimeState = vi.fn((next: RuntimeState) => {
      runtimeState = next;
    });
    const emitOverlay = vi.fn();

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
          };
        },
        getState() {
          return connectivityState;
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: Date.now(),
        hasLocalChangesSinceLastDownload: true,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => null,
      emitOverlay,
      policy: { cooldownMs: 0, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      setTimeout: ((cb: () => void) => {
        cb();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
      log: vi.fn(),
    });

    service.start();
    expect(listener).not.toBeNull();

    await listener!(connectivityState); // first callback ignored

    // Token probe timeout / Clerk readiness lag: overall drops, but api+ws remain healthy.
    connectivityState = createState({
      clerkToken: false,
      apiReachable: true,
      wsConnected: true,
      overall: false,
    });
    await listener!(connectivityState);

    connectivityState = createState({
      clerkToken: true,
      apiReachable: true,
      wsConnected: true,
      overall: true,
    });
    await listener!(connectivityState);

    expect(setRuntimeState).not.toHaveBeenCalledWith('Reconnecting');
    expect(emitOverlay).not.toHaveBeenCalledWith('syncing');
  });

  it('ignores reconnect workflow when runtime is not Ready/Degraded', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let connectivityState = createState({ overall: false });
    const setState = vi.fn();
    const clearTimeoutSpy = vi.fn();

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => {
            listener = null;
            throw new Error('cleanup fail');
          };
        },
        getState() {
          return connectivityState;
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Error',
      setRuntimeState: setState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: Date.now(),
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: async () => {},
      getActiveContext: () => null,
      emitOverlay: () => {},
      policy: { cooldownMs: 0, successOverlayMs: 0, recentDownloadWindowMs: 0 },
      setTimeout: ((cb: () => void) => {
        cb();
        return 99 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutSpy as unknown as typeof clearTimeout,
      log: () => {},
    });

    service.start();
    await listener!(connectivityState);
    connectivityState = createState({ overall: false, wsConnected: false });
    await listener!(connectivityState);
    connectivityState = createState({ overall: true, wsConnected: true });
    await listener!(connectivityState);

    expect(setState).not.toHaveBeenCalled();

    service.stop();
    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('covers ws-only listener branch with missing context and private helper defaults', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => undefined;
        },
        getState() {
          return createState({ overall: false, wsConnected: true });
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Ready',
      setRuntimeState: vi.fn(),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: true,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => null,
      emitOverlay: vi.fn(),
    });

    service.start();
    await listener!(createState({ overall: false, wsConnected: true }));
    await listener!(createState({ overall: false, wsConnected: true }));

    const timer = (
      service as unknown as {
        scheduleTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
      }
    ).scheduleTimeout(() => undefined, 1);
    (
      service as unknown as {
        hiddenOverlayTimer: ReturnType<typeof setTimeout> | null;
      }
    ).hiddenOverlayTimer = timer;
    (
      service as unknown as {
        clearHiddenOverlayTimer(): void;
      }
    ).clearHiddenOverlayTimer();
    expect(
      (
        service as unknown as {
          getCooldownMs(): number;
          getRecentDownloadWindowMs(): number;
          getSuccessOverlayMs(): number;
        }
      ).getCooldownMs()
    ).toBe(8000);
    expect(
      (
        service as unknown as {
          getCooldownMs(): number;
          getRecentDownloadWindowMs(): number;
          getSuccessOverlayMs(): number;
        }
      ).getRecentDownloadWindowMs()
    ).toBe(5000);
    expect(
      (
        service as unknown as {
          getCooldownMs(): number;
          getRecentDownloadWindowMs(): number;
          getSuccessOverlayMs(): number;
        }
      ).getSuccessOverlayMs()
    ).toBe(1000);
  });

  it('covers reconnection early-return and non-error failure branches', async () => {
    let runtimeState: RuntimeState = 'Degraded';
    const setRuntimeState = vi.fn((next: RuntimeState) => {
      runtimeState = next;
    });
    const emitOverlay = vi.fn();
    const service = new ReconnectionService({
      connectivity: {
        addListener: () => () => undefined,
        getState: () => createState({ overall: false, apiReachable: false, wsConnected: true }),
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => {
        throw 'download failed';
      }),
      getActiveContext: () => null,
      emitOverlay,
      policy: { cooldownMs: 0, recentDownloadWindowMs: 0, successOverlayMs: 0 },
      now: () => 1000,
    });

    await (
      service as unknown as {
        onBecameFullyOnline(): Promise<void>;
      }
    ).onBecameFullyOnline();
    expect(setRuntimeState).toHaveBeenCalledWith('Reconnecting');
    expect(setRuntimeState).toHaveBeenCalledWith('Degraded');
    expect(emitOverlay).toHaveBeenCalledWith('hidden');

    const inProgress = new ReconnectionService({
      connectivity: {
        addListener: () => () => undefined,
        getState: () => createState({ overall: true, wsConnected: true }),
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Ready',
      setRuntimeState: vi.fn(),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => null,
      emitOverlay: vi.fn(),
      policy: { cooldownMs: 0, recentDownloadWindowMs: 0, successOverlayMs: 0 },
      now: () => 1000,
    });
    (
      inProgress as unknown as {
        reconnectionInProgress: boolean;
      }
    ).reconnectionInProgress = true;
    await (
      inProgress as unknown as {
        onBecameFullyOnline(): Promise<void>;
      }
    ).onBecameFullyOnline();
  });

  it('covers replay queue non-error branches and ws-only queued replay path', async () => {
    const service = new ReconnectionService({
      connectivity: {
        addListener: () => () => undefined,
        getState: () => createState({ overall: true, wsConnected: true }),
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Ready',
      setRuntimeState: vi.fn(),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: true,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => null,
      emitOverlay: vi.fn(),
    });

    const failingCtx = {
      spaceId: 's1',
      executor: {
        execute: vi.fn(async () => ({ result: null, mutationId: 'm1', isReceiver: false })),
      },
      offlineQueue: {
        hasQueued: async () => true,
        getQueue: async () => [createQueueItem('m1', 's1')],
        getStale: async () => [],
        noteSent: vi.fn(),
      },
      sync: {
        isConnected: () => true,
        setBufferMode: vi.fn(),
        flushBuffer: vi.fn(async () => {
          throw 'flush failed';
        }),
        updateSyncStatus: vi.fn(),
        send: vi.fn(async () => {
          throw 'send failed';
        }),
      },
      dbSync: { upload: vi.fn(async () => undefined) },
    };

    // Per-mutation send failures are swallowed (the entry simply stays queued
    // for the next sweep/reconnect) — replay itself resolves.
    await expect(
      (
        service as unknown as {
          replayQueueViaSync(ctx: unknown): Promise<void>;
        }
      ).replayQueueViaSync(failingCtx)
    ).resolves.toBeUndefined();
    expect(failingCtx.offlineQueue.noteSent).not.toHaveBeenCalled();
    expect(failingCtx.sync.setBufferMode).toHaveBeenCalledWith(false);

    const uploadFailCtx = {
      ...failingCtx,
      offlineQueue: {
        ...failingCtx.offlineQueue,
        noteSent: vi.fn(),
      },
      sync: {
        ...failingCtx.sync,
        flushBuffer: vi.fn(async () => undefined),
        send: vi.fn(async () => true),
      },
      dbSync: {
        upload: vi.fn(async () => {
          throw 'upload failed';
        }),
      },
    };
    await expect(
      (
        service as unknown as {
          replayQueueViaSync(ctx: unknown): Promise<void>;
        }
      ).replayQueueViaSync(uploadFailCtx)
    ).resolves.toBeUndefined();
    expect(uploadFailCtx.offlineQueue.noteSent).toHaveBeenCalledWith('m1');
  });

  it('covers onBecameFullyOnline branches for ws replay, download failure, and generic failure', async () => {
    let listener: ((state: ConnectivityState) => Promise<void>) | null = null;
    let runtimeState: RuntimeState = 'Ready';
    let connectivityState = createState({ overall: false, wsConnected: true });
    const queuedCtx = {
      spaceId: 's1',
      executor: {
        execute: vi.fn(async () => ({ result: null, mutationId: 'm1', isReceiver: false })),
      },
      offlineQueue: {
        hasQueued: async () => true,
        getQueue: async () => [createQueueItem('m1', 's1')],
        getStale: async () => [],
        noteSent: vi.fn(),
      },
      sync: {
        isConnected: () => true,
        setBufferMode: vi.fn(),
        flushBuffer: vi.fn(async () => undefined),
        updateSyncStatus: vi.fn(),
        send: vi.fn(async () => true),
      },
      dbSync: { upload: vi.fn(async () => undefined) },
    };

    const service = new ReconnectionService({
      connectivity: {
        addListener(cb: (state: ConnectivityState) => Promise<void>) {
          listener = cb;
          return () => undefined;
        },
        getState() {
          return connectivityState;
        },
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState: vi.fn((next: RuntimeState) => {
        runtimeState = next;
      }),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => {
        throw 'download failed';
      }),
      getActiveContext: () => queuedCtx,
      emitOverlay: vi.fn(),
      policy: { cooldownMs: 0, recentDownloadWindowMs: 0, successOverlayMs: 0 },
      now: () => 1000,
    });

    service.start();
    await listener!(connectivityState);
    await listener!(connectivityState);
    expect(queuedCtx.sync.updateSyncStatus).toHaveBeenCalledWith({
      isSyncing: true,
      syncError: null,
    });

    (
      service as unknown as {
        replayQueueViaSync: () => Promise<void>;
      }
    ).replayQueueViaSync = vi.fn(async () => {
      throw 'replay failed';
    });
    connectivityState = createState({ overall: true, wsConnected: true });
    await listener!(connectivityState);
  });

  it('covers reconnection catch branches for CancellationError and Error paths', async () => {
    let runtimeState: RuntimeState = 'Ready';
    const setRuntimeState = vi.fn((next: RuntimeState) => {
      runtimeState = next;
    });

    const service = new ReconnectionService({
      connectivity: {
        addListener: () => () => undefined,
        getState: () => createState({ overall: true, wsConnected: true }),
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => runtimeState,
      setRuntimeState,
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => {
        throw new Error('download failed');
      }),
      getActiveContext: () => ({
        spaceId: 's1',
        executor: {
          execute: vi.fn(async () => ({ result: null, mutationId: 'm1', isReceiver: false })),
        },
        offlineQueue: {
          hasQueued: async () => false,
          getQueue: async () => [],
          getStale: async () => [],
          noteSent: vi.fn(),
        },
        sync: {
          isConnected: () => true,
          setBufferMode: vi.fn(),
          flushBuffer: vi.fn(async () => undefined),
          updateSyncStatus: vi.fn(),
          send: vi.fn(async () => true),
        },
        dbSync: { upload: vi.fn(async () => undefined) },
      }),
      emitOverlay: vi.fn(),
      policy: { cooldownMs: 0, recentDownloadWindowMs: 0, successOverlayMs: 0 },
      now: () => 1000,
    });

    (
      service as unknown as {
        replayQueueViaSync: () => Promise<void>;
      }
    ).replayQueueViaSync = vi.fn(async () => {
      throw new CancellationError();
    });
    await (
      service as unknown as {
        onBecameFullyOnline(): Promise<void>;
      }
    ).onBecameFullyOnline();

    (
      service as unknown as {
        replayQueueViaSync: () => Promise<void>;
      }
    ).replayQueueViaSync = vi.fn(async () => {
      throw new Error('replay failed');
    });
    runtimeState = 'Ready';
    await (
      service as unknown as {
        onBecameFullyOnline(): Promise<void>;
      }
    ).onBecameFullyOnline();
    expect(setRuntimeState).toHaveBeenCalledWith('Degraded');
  });

  it('covers replayQueueViaSync upload error branch for Error instances', async () => {
    const service = new ReconnectionService({
      connectivity: {
        addListener: () => () => undefined,
        getState: () => createState(),
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Ready',
      setRuntimeState: vi.fn(),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => null,
      emitOverlay: vi.fn(),
      log: vi.fn(),
    });

    await expect(
      (
        service as unknown as {
          replayQueueViaSync(ctx: unknown): Promise<void>;
        }
      ).replayQueueViaSync({
        spaceId: 's1',
        executor: {
          execute: vi.fn(async () => ({ result: null, mutationId: 'm1', isReceiver: false })),
        },
        offlineQueue: {
          hasQueued: async () => true,
          getQueue: async () => [createQueueItem('m1', 's1')],
          getStale: async () => [],
          noteSent: vi.fn(),
        },
        sync: {
          isConnected: () => true,
          setBufferMode: vi.fn(),
          flushBuffer: vi.fn(async () => undefined),
          updateSyncStatus: vi.fn(),
          send: vi.fn(async () => true),
        },
        dbSync: {
          upload: vi.fn(async () => {
            throw new Error('upload fail');
          }),
        },
      })
    ).resolves.toBeUndefined();
  });

  it('resend sweep re-sends stale unacked mutations and stops on socket loss', async () => {
    let sweepCb: (() => void) | null = null;
    const clearIntervalSpy = vi.fn();
    const send = vi.fn(async () => true);
    const noteSent = vi.fn();
    let connected = true;

    const service = new ReconnectionService({
      connectivity: {
        addListener: () => () => undefined,
        getState: () => createState(),
      } as unknown as ConstructorParameters<typeof ReconnectionService>[0]['connectivity'],
      getRuntimeState: () => 'Ready',
      setRuntimeState: vi.fn(),
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: 0,
        hasLocalChangesSinceLastDownload: false,
      }),
      downloadLatest: vi.fn(async () => undefined),
      getActiveContext: () => ({
        spaceId: 's1',
        executor: {
          execute: vi.fn(async () => ({ result: null, mutationId: 'm1', isReceiver: false })),
        },
        offlineQueue: {
          hasQueued: async () => true,
          getQueue: async () => [],
          getStale: async () => [createQueueItem('m1', 's1'), createQueueItem('m2', 's1')],
          noteSent,
        },
        sync: {
          isConnected: () => connected,
          setBufferMode: vi.fn(),
          flushBuffer: vi.fn(async () => undefined),
          updateSyncStatus: vi.fn(),
          send,
        },
        dbSync: { upload: vi.fn(async () => undefined) },
      }),
      emitOverlay: vi.fn(),
      setInterval: ((cb: () => void) => {
        sweepCb = cb;
        return 7 as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearInterval: clearIntervalSpy as unknown as typeof clearInterval,
      log: vi.fn(),
    });

    service.start();
    expect(sweepCb).not.toBeNull();

    // Connected: both stale entries are re-sent (send only — no local
    // re-apply, no queue removal; the ack is what dequeues).
    await (service as unknown as { resendSweep(): Promise<void> }).resendSweep();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', spaceId: 's1' }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', spaceId: 's1' }));
    expect(noteSent).toHaveBeenCalledWith('m1');
    expect(noteSent).toHaveBeenCalledWith('m2');

    // Socket write fails mid-sweep: stop early, reconnect path takes over.
    send.mockClear();
    noteSent.mockClear();
    send.mockResolvedValueOnce(false);
    await (service as unknown as { resendSweep(): Promise<void> }).resendSweep();
    expect(send).toHaveBeenCalledTimes(1);
    expect(noteSent).not.toHaveBeenCalled();

    // Disconnected: sweep is a no-op.
    send.mockClear();
    connected = false;
    await (service as unknown as { resendSweep(): Promise<void> }).resendSweep();
    expect(send).not.toHaveBeenCalled();

    service.stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(7);
  });
});
