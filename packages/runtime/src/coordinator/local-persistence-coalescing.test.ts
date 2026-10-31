import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeContextFactory, type RuntimeContext } from './runtime-context-factory';
import { MutationDispatchService } from './mutation-dispatch-service';
import { LOCAL_PERSIST_DEBOUNCE_MS } from './local-persist-scheduler';
import { SyncTransport } from '../sync-transport';
import { createStorageMock } from '../__tests__/storage-mock';
import { FakeIndexedDBFactory } from '../__tests__/indexeddb-mock';
import { APPLIED_IDS_PREFIX, MUTATION_CURSOR_STORAGE_PREFIX } from '../types/storage-keys';
import { masterPasswordStore } from '../key-vault/master-password-store';

const CURSOR_KEY = `${MUTATION_CURSOR_STORAGE_PREFIX}space_1`;
const APPLIED_KEY = `${APPLIED_IDS_PREFIX}_space_1`;

class FakeWebSocket {
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
}

function controlledDb() {
  const writes: { resolve(): void }[] = [];
  return {
    writes,
    db: {
      exec: vi.fn(),
      backup: vi.fn(async () => new Uint8Array([1])),
      restore: vi.fn(async () => undefined),
      close: vi.fn(),
      saveToOPFSPublic: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            writes.push({ resolve });
          })
      ),
    },
  };
}

function createContext(db: unknown): RuntimeContext {
  const deps = {
    getToken: vi.fn(async () => 'token'),
    executeOp: vi.fn(async () => 1),
    getUndoSpec: vi.fn(() => undefined),
    getInvalidatesForOp: vi.fn(() => undefined),
    getQueryClient: vi.fn(() => undefined),
    getActiveSpaceId: vi.fn(() => 'space_1'),
    getSpaceRole: vi.fn(() => 'owner'),
    getPassphrase: vi.fn(() => 'passphrase'),
    getEncryptionKeyVersion: vi.fn(() => 1),
    setEncryptionKeyVersion: vi.fn(),
    uploadBlob: vi.fn(async () => ({ version: 1 })),
    downloadBlob: vi.fn(async () => null),
    checkApiHealth: vi.fn(async () => true),
    syncTransportPolicy: {
      getWebSocketUrl: () => 'ws://example/ws',
      subscribeNetworkStatus: () => () => undefined,
    },
  };
  return new RuntimeContextFactory(deps as never).createOnlineContext({
    spaceId: 'space_1',
    generation: 1,
    db: db as never,
    encryption: {
      encryptMutation: vi.fn(async () => 'cipher'),
      decryptMutation: vi.fn(async () => ({ op: 'x', args: {} })),
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
}

const processMessage = (ctx: RuntimeContext, msg: unknown) =>
  (ctx.sync as unknown as { processMessage(m: unknown): Promise<void> }).processMessage(msg);

// Real macrotask turns (WebCrypto in the queue storage resolves outside the
// microtask queue); only setTimeout is faked.
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Bounded by real time, not a tick count: on a loaded CI runner the offline
// persist can take more than a few hundred event-loop turns. (Date is faked;
// performance.now is not.)
const until = async (condition: () => boolean) => {
  const deadline = performance.now() + 5_000;
  while (!condition() && performance.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const storedApplied = (storage: ReturnType<typeof createStorageMock>) =>
  JSON.parse(storage.getItem(APPLIED_KEY) ?? '[]') as string[];

describe('local persistence coalescing', () => {
  let storage: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    storage = createStorageMock();
    vi.stubGlobal('localStorage', storage as unknown as Storage);
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('indexedDB', new FakeIndexedDBFactory() as unknown as IDBFactory);
  });

  afterEach(() => {
    // The queue's key store caches the IndexedDB handle across tests.
    (masterPasswordStore as unknown as { indexedDBStore: unknown }).indexedDBStore = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('turns a burst of acks into one persist and writes the cursor after it', async () => {
    const { db, writes } = controlledDb();
    const ctx = createContext(db);

    for (let v = 1; v <= 5; v++) {
      await processMessage(ctx, { type: 'mutation_ack', mutationId: `m${v}`, version: v });
    }
    // Message handling did not wait for the disk; nothing is durable yet.
    expect(ctx.sync.getLocalVersion()).toBe(5);
    expect(db.saveToOPFSPublic).not.toHaveBeenCalled();
    expect(storage.getItem(CURSOR_KEY)).toBe(null);
    // A crash here: the stored cursor and applied ids are still behind the
    // (unchanged) DB file, so catch-up replays m1..m5 after a reload.
    expect(storedApplied(storage)).toEqual([]);

    vi.advanceTimersByTime(LOCAL_PERSIST_DEBOUNCE_MS);
    await settle();
    expect(db.saveToOPFSPublic).toHaveBeenCalledTimes(1);
    expect(storage.getItem(CURSOR_KEY)).toBe(null);

    writes[0]!.resolve();
    await settle();
    expect(storage.getItem(CURSOR_KEY)).toBe('5');
    expect(storedApplied(storage)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    ctx.disposeLocalPersistence?.();
    ctx.sync.destroy();
  });

  it('persists only the applied ids recorded before a write exported the DB', async () => {
    const { db, writes } = controlledDb();
    const ctx = createContext(db);

    const first = await ctx.executor.execute({ op: 'tx.add', payload: {} });
    expect(ctx.offlineQueue.isApplied(first.mutationId)).toBe(true);
    void ctx.persistLocalDatabase();
    await settle();
    expect(db.saveToOPFSPublic).toHaveBeenCalledTimes(1);

    // Applied while the first write is in flight: not in that export.
    const second = await ctx.executor.execute({ op: 'tx.add', payload: {} });
    writes[0]!.resolve();
    await settle();
    expect(storedApplied(storage)).toEqual([first.mutationId]);

    void ctx.persistLocalDatabase();
    await settle();
    writes[1]!.resolve();
    await settle();
    expect(storedApplied(storage)).toEqual([first.mutationId, second.mutationId]);
    ctx.disposeLocalPersistence?.();
    ctx.sync.destroy();
  });

  it('debounces the persist of a sent mutation but not of an unsent one', async () => {
    const { db, writes } = controlledDb();
    const ctx = createContext(db);
    const dispatch = new MutationDispatchService();
    const send = vi.spyOn(ctx.sync, 'send').mockResolvedValue(true);
    vi.spyOn(ctx.sync, 'isConnected').mockReturnValue(true);
    vi.spyOn(ctx.dbSync, 'scheduleUpload').mockImplementation(() => undefined);

    for (let i = 0; i < 3; i++) {
      const out = await dispatch.executeMutation({ op: 'tx.add', payload: {} }, ctx);
      expect(out.synced).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(3);
    expect(db.saveToOPFSPublic).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LOCAL_PERSIST_DEBOUNCE_MS);
    await settle();
    expect(db.saveToOPFSPublic).toHaveBeenCalledTimes(1);
    writes[0]!.resolve();
    await settle();

    // Send fails: the server may never see it, so persist right away.
    send.mockResolvedValue(false);
    const offline = dispatch.executeMutation({ op: 'tx.add', payload: {} }, ctx);
    await until(() => db.saveToOPFSPublic.mock.calls.length > 1);
    expect(db.saveToOPFSPublic).toHaveBeenCalledTimes(2);
    writes[1]!.resolve();
    await expect(offline).resolves.toMatchObject({ queued: true });
    ctx.disposeLocalPersistence?.();
    ctx.sync.destroy();
  });

  it('flushes a pending persist before a snapshot upload', async () => {
    const { db, writes } = controlledDb();
    const ctx = createContext(db);
    // Snapshot uploads wait for the initial catch-up; this test has no server.
    vi.spyOn(ctx.sync, 'hasInitialCatchUpSettled').mockReturnValue(true);
    void ctx.persistLocalDatabaseSoon?.();

    const upload = ctx.dbSync.upload();
    await settle();
    expect(db.saveToOPFSPublic).toHaveBeenCalledTimes(1);
    expect(db.backup).not.toHaveBeenCalled();
    writes[0]!.resolve();
    await upload;
    expect(db.backup).toHaveBeenCalled();
    ctx.disposeLocalPersistence?.();
    ctx.sync.destroy();
  });

  it('drops a pending persist on dispose', async () => {
    const { db } = controlledDb();
    const ctx = createContext(db);
    const pending = ctx.persistLocalDatabaseSoon?.();

    ctx.disposeLocalPersistence?.();
    vi.advanceTimersByTime(LOCAL_PERSIST_DEBOUNCE_MS * 10);
    await settle();

    await expect(pending).resolves.toBe(false);
    expect(db.saveToOPFSPublic).not.toHaveBeenCalled();
    ctx.sync.destroy();
  });
});

describe('SyncTransport debounced cursor', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a deferred cursor write when the cursor was replaced meanwhile', async () => {
    let resolvePersist!: (ok: boolean) => void;
    const transport = new SyncTransport('space_1', {
      getToken: async () => 'token',
      encryptPayload: async () => 'cipher',
      decryptPayload: async () => ({ op: 'x', args: {} }),
      onRemoteMutation: async () => undefined,
      onConnectionChange: () => undefined,
      persistLocalDatabaseSoon: () =>
        new Promise<boolean>((resolve) => {
          resolvePersist = resolve;
        }),
    });
    await (transport as unknown as { processMessage(m: unknown): Promise<void> }).processMessage({
      type: 'mutation_ack',
      mutationId: 'm1',
      version: 1,
    });
    expect(transport.getLocalVersion()).toBe(1);

    // A snapshot restore reseeds the cursor before the save lands.
    transport.setLocalVersion(7);
    resolvePersist(true);
    await settle();

    expect(localStorage.getItem(CURSOR_KEY)).toBe('7');
    transport.destroy();
  });

  it('keeps the stored cursor when the deferred save fails', async () => {
    const transport = new SyncTransport('space_1', {
      getToken: async () => 'token',
      encryptPayload: async () => 'cipher',
      decryptPayload: async () => ({ op: 'x', args: {} }),
      onRemoteMutation: async () => undefined,
      onConnectionChange: () => undefined,
      persistLocalDatabaseSoon: async () => false,
    });
    await (transport as unknown as { processMessage(m: unknown): Promise<void> }).processMessage({
      type: 'mutation_ack',
      mutationId: 'm1',
      version: 1,
    });
    await settle();
    expect(localStorage.getItem(CURSOR_KEY)).toBe(null);
    transport.destroy();
  });
});
