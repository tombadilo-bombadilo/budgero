import { describe, expect, it, vi } from 'vitest';
import { RuntimeLifecycleService } from './runtime-lifecycle-service';

function createAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

function createBaseContext() {
  return {
    spaceId: 'space_1',
    generation: 1,
    db: { close: vi.fn() },
    sync: { destroy: vi.fn() },
    dbSync: { destroy: vi.fn() },
  };
}

describe('RuntimeLifecycleService', () => {
  it('initializes online flow and starts monitors', async () => {
    const context = createBaseContext();
    const keyVault = {
      get: vi.fn(async () => null),
      store: vi.fn(async () => {}),
      resolveMasterPassword: vi.fn(async () => 'master'),
      getMasterPassword: vi.fn(() => 'master'),
    };
    const spaceCatalog = {
      prepareInitialSpace: vi.fn(async () => 'space_1'),
      refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
    };
    const activation = {
      activateSpace: vi.fn(async () => context),
    };
    const session = {
      getContext: vi.fn(() => null),
      dispose: vi.fn(),
      replace: vi.fn(),
    };
    const connectivity = { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() };
    const reconnection = { start: vi.fn(), stop: vi.fn() };

    const service = new RuntimeLifecycleService({
      keyVault: keyVault as never,
      spaceRegistry: {} as never,
      connectivity: connectivity as never,
      spaceCatalog: spaceCatalog as never,
      activation: activation as never,
      session: session as never,
      reconnection,
    });

    const onSnapshotReset = vi.fn();
    await service.initialize({
      masterPassword: 'master',
      skipServerDownload: false,
      signal: createAbortSignal(),
      onSnapshotReset,
    });

    expect(keyVault.store).toHaveBeenCalledWith('master');
    expect(spaceCatalog.prepareInitialSpace).toHaveBeenCalledWith('master', expect.any(Object));
    expect(activation.activateSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space_1',
        forceServerDownload: true,
      })
    );
    expect(session.replace).toHaveBeenCalledWith(context);
    expect(onSnapshotReset).toHaveBeenCalledTimes(1);
    expect(connectivity.start).toHaveBeenCalledTimes(1);
    expect(reconnection.start).toHaveBeenCalledTimes(1);
  });

  it('switches space with force snapshot download option', async () => {
    const context = createBaseContext();
    const activation = {
      activateSpace: vi.fn(async () => context),
    };
    const keyVault = {
      get: vi.fn(async () => null),
      store: vi.fn(async () => {}),
      resolveMasterPassword: vi.fn(async () => 'master'),
      getMasterPassword: vi.fn(() => 'master'),
    };
    const session = {
      getContext: vi.fn(() => ({ spaceId: 'space_0' })),
      dispose: vi.fn(),
      replace: vi.fn(),
    };

    const service = new RuntimeLifecycleService({
      keyVault: keyVault as never,
      spaceRegistry: {} as never,
      connectivity: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
      } as never,
      activation: activation as never,
      session: session as never,
      reconnection: { start: vi.fn(), stop: vi.fn() },
    });

    await service.switchSpace({
      spaceId: 'space_2',
      skipServerDownload: false,
      forceSnapshotDownload: true,
      signal: createAbortSignal(),
    });

    expect(keyVault.resolveMasterPassword).toHaveBeenCalledTimes(1);
    expect(activation.activateSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space_2',
        forceServerDownload: true,
      })
    );
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.replace).toHaveBeenCalledWith(context);
  });

  it('tears down reconnection, session, and connectivity', () => {
    const reconnectionStop = vi.fn();
    const sessionDispose = vi.fn();
    const connectivityStop = vi.fn();

    const service = new RuntimeLifecycleService({
      keyVault: {
        get: vi.fn(async () => null),
        store: vi.fn(async () => {}),
        resolveMasterPassword: vi.fn(async () => 'master'),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {} as never,
      connectivity: { start: vi.fn(), stop: connectivityStop, refresh: vi.fn() } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
      } as never,
      activation: {
        activateSpace: vi.fn(async () => createBaseContext()),
      } as never,
      session: {
        getContext: vi.fn(() => null),
        dispose: sessionDispose,
        replace: vi.fn(),
      } as never,
      reconnection: { start: vi.fn(), stop: reconnectionStop },
    });

    service.teardown();

    expect(reconnectionStop).toHaveBeenCalledTimes(1);
    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(connectivityStop).toHaveBeenCalledTimes(1);
  });

  it('requires master password when none provided or cached', async () => {
    const service = new RuntimeLifecycleService({
      keyVault: {
        get: vi.fn(async () => null),
        store: vi.fn(async () => {}),
        resolveMasterPassword: vi.fn(async () => 'master'),
        getMasterPassword: vi.fn(() => null),
      } as never,
      spaceRegistry: {} as never,
      connectivity: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
      } as never,
      activation: {
        activateSpace: vi.fn(async () => createBaseContext()),
      } as never,
      session: {
        getContext: vi.fn(() => null),
        dispose: vi.fn(),
        replace: vi.fn(),
      } as never,
      reconnection: { start: vi.fn(), stop: vi.fn() },
    });

    await expect(
      service.initialize({
        signal: createAbortSignal(),
        onSnapshotReset: vi.fn(),
      })
    ).rejects.toThrow('Master password required');
  });

  it('refreshes spaces and triggers fallback switch when needed', async () => {
    const fallbackSwitch = vi.fn(async () => {});
    const sessionDispose = vi.fn();

    const service = new RuntimeLifecycleService({
      keyVault: {
        get: vi.fn(async () => null),
        store: vi.fn(async () => {}),
        resolveMasterPassword: vi.fn(async () => 'master'),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {
        setAvailableSpaces: vi.fn(),
        notifyActiveSpaceChange: vi.fn(),
        getActiveSpaceId: vi.fn(() => 'space_1'),
      } as never,
      connectivity: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({
          fallbackSpaceId: 'space_2',
          activeStillAvailable: false,
          activeSpaceId: 'space_1',
        })),
      } as never,
      activation: {
        activateSpace: vi.fn(async () => createBaseContext()),
      } as never,
      session: {
        getContext: vi.fn(() => null),
        dispose: sessionDispose,
        replace: vi.fn(),
      } as never,
      reconnection: { start: vi.fn(), stop: vi.fn() },
    });

    await service.refreshSpaces(fallbackSwitch);
    expect(sessionDispose).toHaveBeenCalledTimes(1);
    expect(fallbackSwitch).toHaveBeenCalledWith('space_2');
  });

  it('handles remote mutation callback dedupe/inflight and stale generation guards', async () => {
    const context = createBaseContext();
    const connectivityRefresh = vi.fn();
    const activateCalls: {
      onRemoteMutation: (
        op: string,
        args: Record<string, unknown>,
        id: string,
        offlineQueue: {
          isApplied(id: string): boolean;
          isInFlight(id: string): boolean;
          markApplied(id: string): void;
          addInFlight(id: string): void;
          removeInFlight(id: string): void;
        },
        executor: {
          execute(spec: Record<string, unknown>): Promise<unknown>;
        }
      ) => Promise<void>;
      onSyncConnectionChange: () => void;
    }[] = [];

    const service = new RuntimeLifecycleService({
      keyVault: {
        get: vi.fn(async () => null),
        store: vi.fn(async () => {}),
        resolveMasterPassword: vi.fn(async () => 'master'),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {} as never,
      connectivity: { start: vi.fn(), stop: vi.fn(), refresh: connectivityRefresh } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
      } as never,
      activation: {
        activateSpace: vi.fn(async (params) => {
          activateCalls.push({
            onRemoteMutation: params.onRemoteMutation,
            onSyncConnectionChange: params.onSyncConnectionChange,
          });
          return context;
        }),
      } as never,
      session: {
        getContext: vi.fn(() => ({ spaceId: 'space_prev' })),
        dispose: vi.fn(),
        replace: vi.fn(),
      } as never,
      reconnection: { start: vi.fn(), stop: vi.fn() },
      log: vi.fn(),
    });

    await service.initialize({
      masterPassword: 'master',
      signal: createAbortSignal(),
      onSnapshotReset: vi.fn(),
    });

    const first = activateCalls[0]!;
    const offlineQueue = {
      isApplied: vi.fn((id: string) => id === 'dup'),
      isInFlight: vi.fn(() => false),
      markApplied: vi.fn(),
      ackMutation: vi.fn(async () => undefined),
      addInFlight: vi.fn(),
      removeInFlight: vi.fn(),
    };
    const executor = {
      execute: vi.fn(async () => ({ ok: true })),
    };

    await first.onRemoteMutation('tx.create', { a: 1 }, 'dup', offlineQueue, executor);
    // An echo of an already-known mutation is an implicit ack: dequeue it.
    expect(offlineQueue.ackMutation).toHaveBeenCalledWith('dup');
    expect(executor.execute).not.toHaveBeenCalled();

    await first.onRemoteMutation('tx.create', { a: 2 }, 'id-1', offlineQueue, executor);
    expect(offlineQueue.addInFlight).toHaveBeenCalledWith('id-1');
    expect(executor.execute).toHaveBeenCalledWith({
      op: 'tx.create',
      payload: { a: 2 },
      mutationId: 'id-1',
      spaceId: 'space_1',
    });
    expect(offlineQueue.removeInFlight).toHaveBeenCalledWith('id-1');

    first.onSyncConnectionChange();
    expect(connectivityRefresh).toHaveBeenCalledTimes(1);

    await service.switchSpace({
      spaceId: 'space_2',
      signal: createAbortSignal(),
    });

    // Stale callback from generation 1 should no-op after generation increment.
    first.onSyncConnectionChange();
    expect(connectivityRefresh).toHaveBeenCalledTimes(1);
  });

  it('cleans up activation context when signal is aborted after activation', async () => {
    const context = {
      ...createBaseContext(),
      sync: {
        destroy: vi.fn(() => {
          throw new Error('sync');
        }),
      },
      dbSync: {
        destroy: vi.fn(() => {
          throw new Error('dbsync');
        }),
      },
      db: {
        close: vi.fn(() => {
          throw new Error('db');
        }),
      },
    };
    const abortController = new AbortController();

    const service = new RuntimeLifecycleService({
      keyVault: {
        get: vi.fn(async () => null),
        store: vi.fn(async () => {}),
        resolveMasterPassword: vi.fn(async () => 'master'),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {} as never,
      connectivity: { start: vi.fn(), stop: vi.fn(), refresh: vi.fn() } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
      } as never,
      activation: {
        activateSpace: vi.fn(async () => {
          abortController.abort();
          return context;
        }),
      } as never,
      session: {
        getContext: vi.fn(() => null),
        dispose: vi.fn(),
        replace: vi.fn(),
      } as never,
      reconnection: { start: vi.fn(), stop: vi.fn() },
    });

    await expect(
      service.switchSpace({
        spaceId: 'space_1',
        signal: abortController.signal,
      })
    ).rejects.toThrow();

    expect(context.sync.destroy).toHaveBeenCalled();
    expect(context.dbSync.destroy).toHaveBeenCalled();
    expect(context.db.close).toHaveBeenCalled();
  });

  it('swallows connectivity stop errors during teardown', () => {
    const service = new RuntimeLifecycleService({
      keyVault: {
        get: vi.fn(async () => null),
        store: vi.fn(async () => {}),
        resolveMasterPassword: vi.fn(async () => 'master'),
        getMasterPassword: vi.fn(() => 'master'),
      } as never,
      spaceRegistry: {} as never,
      connectivity: {
        start: vi.fn(),
        stop: vi.fn(() => {
          throw new Error('stop failed');
        }),
        refresh: vi.fn(),
      } as never,
      spaceCatalog: {
        prepareInitialSpace: vi.fn(async () => 'space_1'),
        refreshSpaces: vi.fn(async () => ({ fallbackSpaceId: null, activeStillAvailable: true })),
      } as never,
      activation: {
        activateSpace: vi.fn(async () => createBaseContext()),
      } as never,
      session: {
        getContext: vi.fn(() => null),
        dispose: vi.fn(),
        replace: vi.fn(),
      } as never,
      reconnection: { start: vi.fn(), stop: vi.fn() },
    });

    expect(() => service.teardown()).not.toThrow();
  });
});
