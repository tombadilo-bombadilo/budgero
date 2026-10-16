import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from './database-sync';
import * as crypto from '../crypto';
import { MutationDispatchService } from '../coordinator/mutation-dispatch-service';
import { RuntimeContextFactory } from '../coordinator/runtime-context-factory';
import { createStorageMock } from '../__tests__/storage-mock';

function createDeps() {
  const db = {
    backup: vi.fn(async () => new Uint8Array([1, 2, 3])),
    restore: vi.fn(async () => undefined),
  };
  const deps = {
    getDatabase: vi.fn(() => db),
    checkApiHealth: vi.fn(async () => true),
    getPassphrase: vi.fn(() => 'secret'),
    getEncryptionKeyVersion: vi.fn(() => 2),
    setEncryptionKeyVersion: vi.fn(),
    getMutationCursor: vi.fn(() => 42),
    hasUnackedMutations: vi.fn(() => false),
    uploadBlob: vi.fn(async () => ({ version: 11 })),
    downloadBlob: vi.fn(async () => null),
    uploadPolicy: { mutationThreshold: 1 },
  };
  return { db, deps };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise with its resolver, to hold an op mid-execution. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('snapshot uploads never capture an operation half-applied', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('holds a flush while an operation runs and uploads once it ends', async () => {
    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });
    const { db, deps } = createDeps();
    const sync = new DatabaseSync('s1', deps as never);

    const release = sync.beginOperation();
    expect(sync.isOperationInProgress()).toBe(true);
    sync.scheduleUpload(); // threshold reached: would upload now
    sync.flushPendingUpload('visibility_hidden');
    await flush();
    expect(db.backup).not.toHaveBeenCalled();

    release();
    release(); // idempotent
    await flush();
    await flush();
    expect(sync.isOperationInProgress()).toBe(false);
    expect(db.backup).toHaveBeenCalledTimes(1);
    expect(deps.uploadBlob).toHaveBeenCalledTimes(1);
    sync.destroy();
  });

  it('an upload already underway waits, then defers if the op is not in the log yet', async () => {
    const { db, deps } = createDeps();
    const health = gate();
    deps.checkApiHealth.mockImplementation(async () => {
      await health.promise;
      return true;
    });
    const sync = new DatabaseSync('s1', deps as never);

    const uploading = sync.upload();
    // An op starts while the upload awaits its health check.
    const release = sync.beginOperation();
    health.open();
    await flush();
    await flush();
    expect(db.backup).not.toHaveBeenCalled();

    // The op finished and is queued but unacked.
    deps.hasUnackedMutations.mockReturnValue(true);
    release();
    await expect(uploading).rejects.toThrow(/Deferred upload/);
    expect(db.backup).not.toHaveBeenCalled();
    expect(deps.uploadBlob).not.toHaveBeenCalled();
    sync.destroy();
  });

  it('captures only after whoever ended the operation recorded it (remote cursor advance)', async () => {
    vi.spyOn(crypto, 'compressAndEncryptDatabase').mockResolvedValue({
      encrypted: new Uint8Array([7]),
      compressed: new Uint8Array([6]),
    });
    const { deps } = createDeps();
    let cursor = 42;
    deps.getMutationCursor.mockImplementation(() => cursor);
    const sync = new DatabaseSync('s1', deps as never);

    const op = gate();
    const applying = (async () => {
      const release = sync.beginOperation();
      try {
        await op.promise; // the remote op runs
      } finally {
        release();
      }
    })();
    const uploading = sync.upload();
    await flush();
    await flush(); // the upload is now waiting for the op
    op.open();
    await applying;
    cursor = 43; // the transport advances its cursor right after the op returns
    await uploading;
    expect(deps.uploadBlob).toHaveBeenCalledWith(
      's1',
      new Uint8Array([7]),
      expect.anything(),
      2,
      43,
      undefined
    );
    sync.destroy();
  });

  it('dispatch holds the guard from execution until the op is durably queued', async () => {
    const events: string[] = [];
    const running = gate();
    const ctx = {
      spaceId: 's1',
      executor: {
        execute: vi.fn(async () => {
          events.push('execute:start');
          await running.promise;
          events.push('execute:end');
          return { result: 1, mutationId: 'm1', isReceiver: false };
        }),
      },
      sync: { isConnected: () => false, send: vi.fn(async () => false) },
      dbSync: {
        scheduleUpload: vi.fn(),
        beginOperation: vi.fn(() => {
          events.push('guard:begin');
          return () => events.push('guard:release');
        }),
      },
      offlineQueue: {
        add: vi.fn(async () => {
          events.push('queue:add');
        }),
        addInFlight: vi.fn(),
        markApplied: vi.fn(),
        noteSent: vi.fn(),
        getUnsent: vi.fn(async () => []),
      },
      db: {} as never,
      persistLocalDatabase: vi.fn(async () => true),
    };

    const done = new MutationDispatchService().executeMutation(
      { op: 'x', payload: {} },
      ctx as never
    );
    await flush();
    expect(events).toEqual(['guard:begin', 'execute:start']);
    running.open();
    await done;
    expect(events).toEqual([
      'guard:begin',
      'execute:start',
      'execute:end',
      'queue:add',
      'guard:release',
    ]);
  });

  it('every op the executor runs (remote ones too) holds the guard', async () => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);
    let inProgressDuringOp: boolean | undefined;
    let ctx: ReturnType<RuntimeContextFactory['createOnlineContext']>;
    const factory = new RuntimeContextFactory({
      getToken: vi.fn(async () => 'token'),
      executeOp: vi.fn(async () => {
        inProgressDuringOp = ctx.dbSync.isOperationInProgress();
        return { ok: true };
      }),
      getUndoSpec: vi.fn(() => undefined),
      getInvalidatesForOp: vi.fn(() => undefined),
      getQueryClient: vi.fn(() => undefined),
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
      },
    } as never);
    ctx = factory.createOnlineContext({
      spaceId: 'space_1',
      generation: 1,
      db: {
        exec: vi.fn(),
        backup: vi.fn(async () => new Uint8Array([1])),
        restore: vi.fn(async () => undefined),
      } as never,
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
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    } as never);

    await ctx.executor.execute({
      op: 'tx.create',
      payload: { budget_id: 1 },
      mutationId: 'remote-1',
      spaceId: 'space_1',
    });
    expect(inProgressDuringOp).toBe(true);
    expect(ctx.dbSync.isOperationInProgress()).toBe(false);
    ctx.sync.destroy();
    ctx.dbSync.destroy();
  });
});
