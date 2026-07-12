import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeCoordinator } from './runtime-coordinator';
import { createStorageMock } from '../__tests__/storage-mock';
import { CancellationError } from '../utils/diagnostics';
import { BLOB_VERSION_STORAGE_PREFIX, MUTATION_CURSOR_STORAGE_PREFIX } from '../types/storage-keys';
import { FakeIndexedDBFactory } from '../__tests__/indexeddb-mock';
import { masterPasswordStore } from '../key-vault/master-password-store';

function createDb() {
  return {
    exec: vi.fn(),
    backup: vi.fn(async () => new Uint8Array([1, 2, 3])),
    restore: vi.fn(async () => undefined),
    close: vi.fn(),
    saveToOPFSPublic: vi.fn(async () => undefined),
    forceSave: vi.fn(async () => undefined),
  };
}

describe('RuntimeCoordinator', () => {
  const localStorageMock = createStorageMock();
  const sessionStorageMock = createStorageMock();

  afterEach(() => {
    (masterPasswordStore as unknown as { indexedDBStore: unknown }).indexedDBStore = null;
    localStorageMock.clear();
    sessionStorageMock.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createCoordinator(
    overrides?: Partial<ConstructorParameters<typeof RuntimeCoordinator>[0]>
  ) {
    const queryClient = {
      invalidateQueries: vi.fn(async () => undefined),
      cancelQueries: vi.fn(),
      removeQueries: vi.fn(),
      clear: vi.fn(),
    };
    const deps = {
      getToken: vi.fn(async () => 'token'),
      checkApiHealth: vi.fn(async () => true),
      uploadBlob: vi.fn(async () => ({ version: 1 })),
      downloadBlob: vi.fn(async () => null),
      getProfile: vi.fn(async () => ({ primary_space_id: 'local-core-space' })),
      listSpaces: vi.fn(async () => [
        {
          space_id: 'local-core-space',
          display_name: 'Test Space',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: '',
          created_at: '2024-01-01',
        },
      ]),
      uploadEncryptedKey: vi.fn(async () => undefined),
      cleanupStaleSpaceDatabases: vi.fn(async () => undefined),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      createDatabase: vi.fn(async () => createDb()),
      executeOp: vi.fn(async () => ({ ok: true })),
      getUndoSpec: vi.fn(() => undefined),
      getInvalidatesForOp: vi.fn(() => undefined),
      getQueryClient: vi.fn(() => queryClient),
      pushUndo: vi.fn(),
      clearUndo: vi.fn(),
      recordHistory: vi.fn(),
      onAnalyticsEvent: vi.fn(),
      isSelfHostable: false,
      // Skips the server snapshot check during activation so tests init from
      // a locally-created database, mirroring the E2E harness.
      isE2E: true,
      opfsSuffix: '_sas',
      runtimeLog: vi.fn(),
      ...overrides,
    };

    return { coordinator: new RuntimeCoordinator(deps), deps, queryClient };
  }

  it('initializes the runtime and exposes accessors', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    vi.stubGlobal('indexedDB', new FakeIndexedDBFactory() as unknown as IDBFactory);

    const { coordinator, queryClient } = createCoordinator();
    const states: string[] = [];
    coordinator.onStateChange((state) => states.push(state));

    await coordinator.init({ masterPassword: 'master', queryClient });

    expect(coordinator.state).toBe('Ready');
    expect(coordinator.isInitialized()).toBe(true);
    expect(coordinator.getDatabase()).not.toBeNull();
    expect(coordinator.getActiveSpaceId()).toBe('local-core-space');
    expect(coordinator.getQueryClient()).toBe(queryClient);
    expect(coordinator.exportSpaceKey()).toBeTruthy();
    expect(states).toContain('Initializing');
    expect(states).toContain('Ready');

    const result = await coordinator.executeMutation({
      op: 'budgets.create',
      payload: { budget_id: 7 },
    });
    expect(result.queued || result.synced).toBe(true);

    expect(await coordinator.hasQueuedMutations()).toBe(true);
    expect(coordinator.hasQueuedMutationsNow()).toBe(true);
    expect(await coordinator.getQueueLength()).toBeGreaterThan(0);
    expect(coordinator.peekQueueLength()).toBeGreaterThan(0);

    await coordinator.save();
    await coordinator.downloadLatest();

    coordinator.scheduleSnapshotUpload();
    coordinator.addToSyncQueue({
      id: 'm2',
      op: 'tx.create',
      args: {},
      baseVersion: 0,
      timestamp: new Date(),
      spaceId: 'desktop',
    });

    await expect(coordinator.incrementEncryptionKeyVersion()).rejects.toThrow(
      'WebSocket not connected'
    );
    await expect(coordinator.sendMutation({ id: 'm3', op: 'tx.update', args: {} })).resolves.toBe(
      false
    );

    const activeSpaceId = coordinator.getActiveSpaceId();
    if (!activeSpaceId) {
      throw new Error('Expected active space id');
    }
    const key = await coordinator.requireSpaceKey(activeSpaceId);
    expect(key).toBeInstanceOf(Uint8Array);

    const overlaySpy = vi.fn();
    const connSpy = vi.fn();
    const syncSpy = vi.fn();
    coordinator.onOverlayChange(overlaySpy);
    coordinator.onConnectionChange(connSpy);
    coordinator.onSyncStatus(syncSpy);

    (coordinator as unknown as { events: { emitOverlay(p: 'syncing'): void } }).events.emitOverlay(
      'syncing'
    );
    expect(overlaySpy).toHaveBeenCalledWith('syncing');

    coordinator.destroy();
    expect(coordinator.state).toBe('Destroyed');
    expect(coordinator.isInitialized()).toBe(false);
  });

  it('downloads the latest blob when an out-of-band version is announced', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator, deps, queryClient } = createCoordinator();
    await coordinator.init({ masterPassword: 'master', queryClient });
    expect(deps.downloadBlob).not.toHaveBeenCalled();

    // init stamps lastSnapshotDownloadAt, which would rate-limit the
    // download this test asserts — reset it, as five real seconds would.
    (coordinator as unknown as { lastSnapshotDownloadAt: number }).lastSnapshotDownloadAt = 0;

    const handler = coordinator as unknown as {
      handleRemoteBlobVersion(spaceId: string, version: number): void;
    };

    // Announcements for other spaces or stale versions are ignored.
    handler.handleRemoteBlobVersion('some-other-space', 99);
    await vi.waitFor(() => expect(deps.downloadBlob).not.toHaveBeenCalled());

    // An out-of-band blob for the active space triggers an actual download —
    // its content is not in the mutation log, so nothing else will ever
    // deliver it to this device.
    handler.handleRemoteBlobVersion('local-core-space', 99);
    await vi.waitFor(() => expect(deps.downloadBlob).toHaveBeenCalledWith('local-core-space'));

    coordinator.destroy();
  });

  it('guards mutation and switching by state', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator } = createCoordinator();

    await expect(coordinator.executeMutation({ op: 'x', payload: {} })).rejects.toThrow(
      'Cannot execute mutations in state: Idle'
    );

    await expect(coordinator.switchSpace('s1')).rejects.toThrow(
      'Cannot switch space in state: Idle'
    );
  });

  it('supports noop init while preserving replacement queryClient', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator } = createCoordinator();
    const qc1 = {
      invalidateQueries: vi.fn(async () => undefined),
      cancelQueries: vi.fn(),
      removeQueries: vi.fn(),
      clear: vi.fn(),
    };
    const qc2 = {
      invalidateQueries: vi.fn(async () => undefined),
      cancelQueries: vi.fn(),
      removeQueries: vi.fn(),
      clear: vi.fn(),
    };

    await coordinator.init({ masterPassword: 'master', queryClient: qc1 });
    await coordinator.init({ queryClient: qc2 });

    expect(coordinator.getQueryClient()).toBe(qc2);

    coordinator.destroy();
  });

  it('reseeds sync state from authoritative server state', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator } = createCoordinator({
      getDatabaseState: vi.fn(async () => ({ version: 12, mutation_version: 77 })),
    });

    await coordinator.init({ masterPassword: 'master' });
    await coordinator.reseedSyncStateFromServer();

    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}local-core-space`)).toBe(
      '77'
    );
    expect(localStorageMock.getItem(`${BLOB_VERSION_STORAGE_PREFIX}local-core-space`)).toBe('12');

    coordinator.destroy();
  });

  it('keeps the mutation cursor when reseed cannot obtain authoritative mutation version', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}local-core-space`, '42');

    const { coordinator } = createCoordinator({
      getDatabaseState: vi.fn(async () => ({ version: 13 })),
    });

    await coordinator.init({ masterPassword: 'master' });
    await coordinator.reseedSyncStateFromServer();

    // An absent mutation_version is indistinguishable from a transient
    // server-side failure — clearing here used to trigger a full-log replay
    // onto a populated DB. The cursor must survive untouched.
    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}local-core-space`)).toBe(
      '42'
    );
    expect(localStorageMock.getItem(`${BLOB_VERSION_STORAGE_PREFIX}local-core-space`)).toBe('13');

    coordinator.destroy();
  });

  it('keeps the mutation cursor when the reseed state fetch throws', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}local-core-space`, '42');

    const { coordinator } = createCoordinator({
      getDatabaseState: vi.fn(async () => {
        throw new Error('network blip');
      }),
    });

    await coordinator.init({ masterPassword: 'master' });
    await coordinator.reseedSyncStateFromServer();

    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}local-core-space`)).toBe(
      '42'
    );

    coordinator.destroy();
  });

  it('deduplicates concurrent init calls while initialization is in progress', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    let releaseDbLoad: (() => void) | null = null;
    const dbGate = new Promise<void>((resolve) => {
      releaseDbLoad = resolve;
    });

    const qc1 = {
      invalidateQueries: vi.fn(async () => undefined),
      cancelQueries: vi.fn(),
      removeQueries: vi.fn(),
      clear: vi.fn(),
    };
    const qc2 = {
      invalidateQueries: vi.fn(async () => undefined),
      cancelQueries: vi.fn(),
      removeQueries: vi.fn(),
      clear: vi.fn(),
    };

    const { coordinator } = createCoordinator({
      createDatabase: vi.fn(async () => {
        await dbGate;
        return createDb();
      }),
    });

    const init1 = coordinator.init({ masterPassword: 'master', queryClient: qc1 });
    await Promise.resolve();
    expect(coordinator.state).toBe('Initializing');

    const init2 = coordinator.init({ queryClient: qc2 });

    releaseDbLoad?.();
    await Promise.all([init1, init2]);

    expect(coordinator.state).toBe('Ready');
    expect(coordinator.getQueryClient()).toBe(qc2);

    coordinator.destroy();
  });

  it('swallows refresh errors and exposes internal transition guard behavior', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator } = createCoordinator({
      listSpaces: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    await coordinator.init({ masterPassword: 'master' }).catch(() => undefined);
    await expect(coordinator.refreshSpaces()).resolves.toBeUndefined();

    expect(
      (
        coordinator as unknown as {
          trySetState: (s: string) => boolean;
        }
      ).trySetState('Ready')
    ).toBe(false);

    coordinator.destroy();
  });

  it('runs init/switch flow and context-dependent coordinator paths', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;

        static CONNECTING = 0;

        readyState = 1;

        onopen: (() => void) | null = null;

        onclose: (() => void) | null = null;

        onerror: (() => void) | null = null;

        onmessage: ((event: { data: string }) => void) | null = null;

        constructor(_url: string) {}

        send(_data: string): void {}

        close(): void {}
      } as unknown as typeof WebSocket
    );

    const spaces = [
      {
        space_id: 's1',
        display_name: 'One',
        owner_user_id: 'u1',
        role: 'owner',
        invitation_status: 'accepted',
        encrypted_space_key: '',
        created_at: '2024-01-01',
      },
      {
        space_id: 's2',
        display_name: 'Two',
        owner_user_id: 'u1',
        role: 'owner',
        invitation_status: 'accepted',
        encrypted_space_key: '',
        created_at: '2024-01-01',
      },
    ];
    const throwingQc = {
      invalidateQueries: vi.fn(async () => undefined),
      cancelQueries: vi.fn(() => {
        throw new Error('cancel');
      }),
      removeQueries: vi.fn(() => {
        throw new Error('remove');
      }),
      clear: vi.fn(() => {
        throw new Error('clear');
      }),
    };

    const { coordinator } = createCoordinator({
      isE2E: false,
      listSpaces: vi.fn(async () => spaces),
      getProfile: vi.fn(async () => ({ primary_space_id: 's1' })),
      getQueryClient: vi.fn(() => throwingQc),
    });

    await coordinator.init({ masterPassword: 'master' });
    expect(coordinator.state).toBe('Ready');
    expect(coordinator.getActiveSpaceId()).toBe('s1');
    expect(coordinator.getEncryption()).not.toBeNull();
    expect(coordinator.getSpacePassphrase('s1')).toBeTruthy();

    // Same space -> no-op branch.
    await coordinator.switchSpace('s1');

    await expect(coordinator.switchSpace('missing')).rejects.toThrow(
      'Requested workspace is not available to this user'
    );

    await coordinator.switchSpace('s2', {
      forceSnapshotDownload: true,
      skipServerDownload: true,
    });
    expect(coordinator.getActiveSpaceId()).toBe('s2');

    expect(
      (
        coordinator as unknown as {
          trySetState(next: 'Degraded'): boolean;
        }
      ).trySetState('Degraded')
    ).toBe(true);

    const ctx = (
      coordinator as unknown as {
        session: {
          getContext(): {
            dbSync: { downloadAndRestore(): Promise<boolean> };
            offlineQueue: { add(m: unknown): Promise<void> };
          } | null;
        };
      }
    ).session.getContext();
    if (!ctx) {
      throw new Error('Expected active context');
    }
    vi.spyOn(ctx.dbSync, 'downloadAndRestore').mockResolvedValue(true);
    (coordinator as unknown as { lastSnapshotDownloadAt: number }).lastSnapshotDownloadAt = 0;
    await coordinator.downloadLatest();
    await coordinator.downloadLatest();

    vi.spyOn(ctx.offlineQueue, 'add').mockRejectedValue(new Error('queue failed'));
    coordinator.addToSyncQueue({
      id: 'q1',
      op: 'tx.create',
      args: {},
      baseVersion: 0,
      timestamp: new Date(),
      spaceId: 's2',
    });
    await Promise.resolve();

    (
      coordinator as unknown as {
        lifecycle: { refreshSpaces(cb: (spaceId: string) => Promise<void>): Promise<void> };
      }
    ).lifecycle.refreshSpaces = vi.fn(async (fallback) => {
      await fallback('s2');
    });
    await coordinator.refreshSpaces();

    coordinator.destroy();

    await expect(coordinator.incrementEncryptionKeyVersion()).rejects.toThrow(
      'SyncTransport not initialized'
    );
    await expect(coordinator.sendMutation({ id: 'x', op: 'tx.update', args: {} })).resolves.toBe(
      false
    );
  });

  it('resets from Destroyed state and exposes init failure state transition', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator } = createCoordinator();
    await coordinator.init({ masterPassword: 'master' });
    coordinator.destroy();
    expect(coordinator.state).toBe('Destroyed');

    await coordinator.init({ masterPassword: 'master' });
    expect(coordinator.state).toBe('Ready');

    localStorageMock.clear();
    const failing = createCoordinator({
      listSpaces: vi.fn(async () => []),
    }).coordinator;

    await expect(failing.init({ masterPassword: 'master' })).rejects.toThrow();
    expect(failing.state).toBe('Error');
    failing.destroy();
  });

  it('covers no-active-context guards and init cancellation path', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);

    const { coordinator } = createCoordinator();
    (coordinator as unknown as { applyIntent(intent: string): void }).applyIntent('unknown:intent');
    expect(coordinator.state).toBe('Idle');
    expect((coordinator as unknown as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);

    (
      coordinator as unknown as {
        stateMachine: { transition(next: 'Initializing' | 'Ready'): void };
      }
    ).stateMachine.transition('Initializing');
    (
      coordinator as unknown as {
        stateMachine: { transition(next: 'Initializing' | 'Ready'): void };
      }
    ).stateMachine.transition('Ready');

    await expect(coordinator.executeMutation({ op: 'tx.create', payload: {} })).rejects.toThrow(
      'No active workspace'
    );
    expect(coordinator.getDatabase()).toBeNull();
    expect(coordinator.getEncryption()).toBeNull();
    // No active space → no key to export.
    expect(coordinator.exportSpaceKey()).toBeFalsy();
    expect(await coordinator.hasQueuedMutations()).toBe(false);
    expect(coordinator.hasQueuedMutationsNow()).toBe(false);
    expect(await coordinator.getQueueLength()).toBe(0);
    expect(coordinator.peekQueueLength()).toBe(0);

    const cancelInit = createCoordinator().coordinator;
    (
      cancelInit as unknown as {
        lifecycle: { initialize(args: unknown): Promise<void> };
      }
    ).lifecycle.initialize = vi.fn(async () => {
      throw new CancellationError();
    });
    await expect(cancelInit.init({ masterPassword: 'master' })).resolves.toBeUndefined();
  });

  it('covers cancellation/non-error fallback branches in switch, queue, refresh and cleanup', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;

        static CONNECTING = 0;

        readyState = 1;

        onopen: (() => void) | null = null;

        onclose: (() => void) | null = null;

        onerror: (() => void) | null = null;

        onmessage: ((event: { data: string }) => void) | null = null;

        constructor(_url: string) {}

        send(_data: string): void {}

        close(): void {}
      } as unknown as typeof WebSocket
    );

    const spaces = [
      {
        space_id: 's1',
        display_name: 'One',
        owner_user_id: 'u1',
        role: 'owner',
        invitation_status: 'accepted',
        encrypted_space_key: '',
        created_at: '2024-01-01',
      },
      {
        space_id: 's2',
        display_name: 'Two',
        owner_user_id: 'u1',
        role: 'owner',
        invitation_status: 'accepted',
        encrypted_space_key: '',
        created_at: '2024-01-01',
      },
    ];
    const runtimeLog = vi.fn();
    const { coordinator } = createCoordinator({
      isE2E: false,
      listSpaces: vi.fn(async () => spaces),
      getProfile: vi.fn(async () => ({ primary_space_id: 's1' })),
      runtimeLog,
    });

    await coordinator.init({ masterPassword: 'master' });
    (
      coordinator as unknown as {
        lifecycle: { switchSpace(args: unknown): Promise<void> };
      }
    ).lifecycle.switchSpace = vi.fn(async () => {
      throw new CancellationError();
    });
    await expect(coordinator.switchSpace('s2')).resolves.toBeUndefined();

    const ctx = (
      coordinator as unknown as {
        session: { getContext(): { offlineQueue: { add(m: unknown): Promise<void> } } | null };
      }
    ).session.getContext();
    if (!ctx) {
      throw new Error('Expected active context');
    }
    vi.spyOn(ctx.offlineQueue, 'add').mockRejectedValue('queue failed');
    coordinator.addToSyncQueue({
      id: 'q3',
      op: 'tx.create',
      args: {},
      baseVersion: 0,
      timestamp: new Date(),
      spaceId: 's1',
    });
    await Promise.resolve();

    (
      coordinator as unknown as {
        lifecycle: { refreshSpaces(cb: (spaceId: string) => Promise<void>): Promise<void> };
      }
    ).lifecycle.refreshSpaces = vi.fn(async () => {
      throw 'refresh failed';
    });
    await expect(coordinator.refreshSpaces()).resolves.toBeUndefined();
    expect(runtimeLog).toHaveBeenCalledWith(
      'warn',
      'RuntimeCoordinator',
      'Failed to refresh spaces',
      expect.any(Object)
    );

    const noQc = createCoordinator({ getQueryClient: undefined }).coordinator;
    expect(
      (
        noQc as unknown as {
          clearQueryClient(): void;
        }
      ).clearQueryClient()
    ).toBeUndefined();
  });

  it('falls back to internal logger when runtimeLog dependency is absent', () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    localStorageMock.setItem('budgero_debug', '1');

    const runtimeLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { coordinator } = createCoordinator({ runtimeLog: undefined });

    (
      coordinator as unknown as {
        log(
          level: 'debug' | 'info' | 'warn' | 'error',
          message: string,
          context?: Record<string, unknown>
        ): void;
      }
    ).log('info', 'fallback-log', { ok: true });
    expect(runtimeLogSpy).toHaveBeenCalled();
  });
});
