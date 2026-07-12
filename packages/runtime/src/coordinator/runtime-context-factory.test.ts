import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeContextFactory } from './runtime-context-factory';
import { createStorageMock } from '../__tests__/storage-mock';
import { FakeIndexedDBFactory } from '../__tests__/indexeddb-mock';
import { masterPasswordStore } from '../key-vault/master-password-store';

function createDeps() {
  return {
    getToken: vi.fn(async () => 'token'),
    executeOp: vi.fn(async () => ({ ok: true })),
    getUndoSpec: vi.fn(() => undefined),
    getInvalidatesForOp: vi.fn(() => undefined),
    getQueryClient: vi.fn(() => undefined),
    pushUndo: vi.fn(),
    recordHistory: vi.fn(),
    onAnalyticsEvent: vi.fn(),
    getActiveSpaceId: vi.fn(() => 'space_1'),
    getSpaceRole: vi.fn(() => 'owner'),
    getPassphrase: vi.fn(() => 'passphrase'),
    getEncryptionKeyVersion: vi.fn(() => 2),
    setEncryptionKeyVersion: vi.fn(),
    uploadBlob: vi.fn(async () => ({ version: 5 })),
    downloadBlob: vi.fn(async () => null),
    checkApiHealth: vi.fn(async () => true),
    syncTransportPolicy: {
      getWebSocketUrl: vi.fn(() => 'ws://example/ws'),
      subscribeNetworkStatus: vi.fn(() => () => undefined),
      getReconnectDelayMs: vi.fn(() => 0),
      onEncryptionKeyChanged: vi.fn(),
      setPasswordChangedReason: vi.fn(),
      reloadApp: vi.fn(),
    },
    log: vi.fn(),
  };
}

function createDb() {
  return {
    exec: vi.fn(),
    backup: vi.fn(async () => new Uint8Array([1])),
    restore: vi.fn(async () => undefined),
    close: vi.fn(),
    saveToOPFSPublic: vi.fn(async () => undefined),
    forceSave: vi.fn(async () => undefined),
  };
}

describe('RuntimeContextFactory', () => {
  afterEach(() => {
    (masterPasswordStore as unknown as { indexedDBStore: unknown }).indexedDBStore = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates online context with wired components and initial versions', async () => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
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

    const deps = createDeps();
    const factory = new RuntimeContextFactory(deps as never);
    const db = createDb();
    const onRemoteMutation = vi.fn(async () => undefined);

    const ctx = factory.createOnlineContext({
      spaceId: 'space_1',
      generation: 3,
      db: db as never,
      encryption: {
        encryptMutation: vi.fn(async () => 'cipher'),
        decryptMutation: vi.fn(async () => ({ op: 'x', args: {} })),
      },
      passphrase: 'passphrase',
      hydratedFromServer: true,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      initialBlobVersion: 9,
      onRemoteMutation,
      onSyncConnectionChange: vi.fn(),
    });

    expect(ctx.spaceId).toBe('space_1');
    expect(ctx.generation).toBe(3);
    expect(ctx.sync.getLocalVersion()).toBe(0);
    expect(ctx.dbSync.getBlobVersion()).toBe(9);

    await ctx.executor.execute({ op: 'tx.create', payload: { budget_id: 1 } });
    expect(deps.executeOp).toHaveBeenCalledWith('tx.create', { budget_id: 1 });

    ctx.sync.destroy();
  });

  it('routes remote mutation callback through sync transport dependency', async () => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
    const FakeWS = class {
      static OPEN = 1;

      static CONNECTING = 0;

      readyState = 1;

      onopen: (() => void) | null = null;

      onclose: (() => void) | null = null;

      onerror: (() => void) | null = null;

      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        setTimeout(() => {
          this.onopen?.();
        }, 0);
      }

      send(_data: string): void {}

      close(): void {}
    };
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const deps = createDeps();
    const factory = new RuntimeContextFactory(deps as never);
    const onRemoteMutation = vi.fn(async () => undefined);

    const ctx = factory.createOnlineContext({
      spaceId: 'space_1',
      generation: 1,
      db: createDb() as never,
      encryption: {
        encryptMutation: vi.fn(async () => 'cipher'),
        decryptMutation: vi.fn(async () => ({ op: 'remote', args: { a: 1 } })),
      },
      passphrase: 'pass',
      hydratedFromServer: false,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      onRemoteMutation,
      onSyncConnectionChange: vi.fn(),
    });

    await ctx.sync.connect();
    await (
      ctx.sync as unknown as {
        processMessage: (msg: unknown) => Promise<void>;
      }
    ).processMessage({
      type: 'mutation_applied',
      mutationId: 'm1',
      payload: { encryptedPayload: 'x' },
      spaceId: 'space_1',
    });

    expect(onRemoteMutation).toHaveBeenCalled();
    ctx.sync.destroy();
  });

  it('routes out-of-band blob announcements to onRemoteBlobVersion without bumping the version', async () => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
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

    const deps = createDeps();
    const factory = new RuntimeContextFactory(deps as never);
    const onRemoteBlobVersion = vi.fn();

    const ctx = factory.createOnlineContext({
      spaceId: 'space_1',
      generation: 1,
      db: createDb() as never,
      encryption: {
        encryptMutation: vi.fn(async () => 'cipher'),
        decryptMutation: vi.fn(async () => ({ op: 'x', args: {} })),
      },
      passphrase: 'pass',
      hydratedFromServer: false,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      initialBlobVersion: 9,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
      onRemoteBlobVersion,
    });

    const processMessage = (msg: unknown) =>
      (
        ctx.sync as unknown as {
          processMessage: (m: unknown) => Promise<void>;
        }
      ).processMessage(msg);

    // Out-of-band blob (import/restore): hand off for download; the version
    // must NOT be recorded — a version this device never downloaded would
    // let its next stale upload pass the server's compare-and-swap.
    await processMessage({
      type: 'sync_state_changed',
      spaceId: 'space_1',
      version: 12,
      out_of_band: true,
    });
    expect(onRemoteBlobVersion).toHaveBeenCalledWith('space_1', 12);
    expect(ctx.dbSync.getBlobVersion()).toBe(9);

    // Normal debounced upload from another device: log-covered content, so
    // only the version is tracked and no download is requested.
    await processMessage({ type: 'sync_state_changed', spaceId: 'space_1', version: 11 });
    expect(ctx.dbSync.getBlobVersion()).toBe(11);
    expect(onRemoteBlobVersion).toHaveBeenCalledTimes(1);

    ctx.sync.destroy();
  });

  it('recovers from unsafe catch-up by restoring snapshot and reseeding versions from server state', async () => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
    const FakeWS = class {
      static OPEN = 1;

      static CONNECTING = 0;

      static CLOSED = 3;

      static instances: {
        emitOpen(): void;
        emitMessage(payload: unknown): void;
      }[] = [];

      readyState = 0;

      onopen: (() => void) | null = null;

      onclose: (() => void) | null = null;

      onerror: (() => void) | null = null;

      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        FakeWS.instances.push(this);
      }

      send(_data: string): void {}

      close(): void {
        this.readyState = 3;
        this.onclose?.();
      }

      emitOpen(): void {
        this.readyState = 1;
        this.onopen?.();
      }

      emitMessage(payload: unknown): void {
        this.onmessage?.({ data: JSON.stringify(payload) });
      }
    };
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const deps = createDeps();
    deps.syncTransportPolicy.getReconnectDelayMs = vi.fn(() => 60_000);
    deps.getDatabaseState = vi.fn(async () => ({ version: 44, mutation_version: 120 }));
    const factory = new RuntimeContextFactory(deps as never);
    const db = createDb();

    const ctx = factory.createOnlineContext({
      spaceId: 'space_1',
      generation: 11,
      db: db as never,
      encryption: {
        encryptMutation: vi.fn(async () => 'cipher'),
        decryptMutation: vi.fn(async () => ({ op: 'remote', args: { a: 1 } })),
      },
      passphrase: 'passphrase',
      hydratedFromServer: false,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    const restoreSpy = vi.spyOn(ctx.dbSync, 'downloadAndRestore').mockResolvedValue(true);
    const migrationSpy = vi
      .spyOn(ctx.dbLoader, 'runMigrations')
      .mockImplementation(() => undefined);

    ctx.sync.setLocalVersion(100);
    await ctx.sync.connect();
    const ws = FakeWS.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({ type: 'catch_up_response', mutations: { bad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(restoreSpy).toHaveBeenCalled();
    expect(migrationSpy).toHaveBeenCalledWith(db as never);
    expect(ctx.dbSync.getBlobVersion()).toBe(44);
    expect(ctx.sync.getLocalVersion()).toBe(120);
    ctx.sync.destroy();
  });

  it('preserves offline queue entries across unsafe catch-up recovery', async () => {
    vi.stubGlobal('indexedDB', new FakeIndexedDBFactory() as unknown as IDBFactory);
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
    const FakeWS = class {
      static OPEN = 1;

      static CONNECTING = 0;

      static CLOSED = 3;

      static instances: {
        emitOpen(): void;
        emitMessage(payload: unknown): void;
      }[] = [];

      readyState = 0;

      onopen: (() => void) | null = null;

      onclose: (() => void) | null = null;

      onerror: (() => void) | null = null;

      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(_url: string) {
        FakeWS.instances.push(this);
      }

      send(_data: string): void {}

      close(): void {
        this.readyState = 3;
        this.onclose?.();
      }

      emitOpen(): void {
        this.readyState = 1;
        this.onopen?.();
      }

      emitMessage(payload: unknown): void {
        this.onmessage?.({ data: JSON.stringify(payload) });
      }
    };
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);

    const deps = createDeps();
    deps.syncTransportPolicy.getReconnectDelayMs = vi.fn(() => 60_000);
    deps.getDatabaseState = vi.fn(async () => ({ version: 44, mutation_version: 120 }));
    const factory = new RuntimeContextFactory(deps as never);
    const db = createDb();

    const ctx = factory.createOnlineContext({
      spaceId: 'space_1',
      generation: 11,
      db: db as never,
      encryption: {
        encryptMutation: vi.fn(async () => 'cipher'),
        decryptMutation: vi.fn(async () => ({ op: 'remote', args: { a: 1 } })),
      },
      passphrase: 'passphrase',
      hydratedFromServer: false,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    const restoreSpy = vi.spyOn(ctx.dbSync, 'downloadAndRestore').mockResolvedValue(true);
    await ctx.offlineQueue.add({
      id: 'q1',
      op: 'tx.create',
      args: { amount: 10 },
      baseVersion: 0,
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      spaceId: 'space_1',
    });

    ctx.sync.setLocalVersion(100);
    await ctx.sync.connect();
    const ws = FakeWS.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({ type: 'catch_up_response', mutations: { bad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const queue = await ctx.offlineQueue.getQueue();
    expect(restoreSpy).toHaveBeenCalled();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.id).toBe('q1');
    ctx.sync.destroy();
  });
});
