import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressAndEncryptDatabase } from '../crypto';
import * as cryptoModule from '../crypto';
import { BLOB_VERSION_STORAGE_PREFIX, MUTATION_CURSOR_STORAGE_PREFIX } from '../types/storage-keys';
import { SpaceActivationService } from './space-activation-service';
import { createStorageMock } from '../__tests__/storage-mock';

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

function createOnlineContext(db = createDb()) {
  return {
    spaceId: 's1',
    generation: 1,
    db,
    sync: {
      connect: vi.fn(async () => undefined),
      destroy: vi.fn(),
      isConnected: vi.fn(() => true),
      onConnectionChange: vi.fn(() => vi.fn()),
      addSyncStatusListener: vi.fn(() => vi.fn()),
    },
    dbSync: { destroy: vi.fn(), setBlobVersion: vi.fn() },
    dbLoader: { runMigrations: vi.fn() },
    executor: {} as never,
    offlineQueue: {} as never,
    encryption: null,
    passphrase: 'passphrase',
    hydratedFromServer: true,
    localPersistenceCipher: {
      encrypt: vi.fn(async (d: Uint8Array) => d),
      decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
    },
  };
}

describe('SpaceActivationService', () => {
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no-op */
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads server snapshot, hydrates db, and creates context', async () => {
    vi.stubGlobal('localStorage', createStorageMock() as unknown as Storage);

    const keyVault = {
      ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
      getSpacePassphrase: vi.fn(() => 'passphrase'),
      setEncryptionKeyVersion: vi.fn(),
    };

    const plaintext = new Uint8Array([1, 2, 3, 4]);
    const { encrypted } = await compressAndEncryptDatabase(plaintext, 'passphrase');

    const db = createDb();
    const context = createOnlineContext(db);

    const service = new SpaceActivationService({
      keyVault: keyVault as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => db),
      downloadBlob: vi.fn(async () => ({
        data: encrypted,
        headers: new Headers({
          'X-Encryption-Key-Version': '5',
          'X-Database-Version': '7',
        }),
      })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    const out = await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      skipServerDownload: false,
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(out).toBe(context);
    expect(keyVault.setEncryptionKeyVersion).toHaveBeenCalledWith('s1', 5);
    expect(context.sync.connect).toHaveBeenCalled();
    expect(context.dbLoader.runMigrations).toHaveBeenCalledWith(db);
  });

  it('uses local database startup on legacy server when blob gap is within replay threshold and cursor exists', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}s1`, '8');

    const db = createDb();
    const context = createOnlineContext(db);
    const downloadBlob = vi.fn(async () => null);
    const createDatabase = vi.fn(async () => db);
    const createOnlineContextSpy = vi.fn(() => context);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: createOnlineContextSpy,
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob,
      getDatabaseState: vi.fn(async () => ({ version: 15 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(createDatabase).toHaveBeenCalledWith(undefined, {
      localPersistence: expect.any(Object),
      path: 'space_s1_sas.db',
    });
    expect(createOnlineContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hydratedFromServer: false,
        initialBlobVersion: 10,
      })
    );
  });

  it('forces full snapshot on legacy server when mutation cursor is missing', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');

    const plaintext = new Uint8Array([8, 8, 8]);
    const { encrypted } = await compressAndEncryptDatabase(plaintext, 'passphrase');
    const db = createDb();
    const context = createOnlineContext(db);
    const downloadBlob = vi.fn(async () => ({
      data: encrypted,
      headers: new Headers({ 'X-Database-Version': '15' }),
    }));
    const createDatabase = vi.fn(async () => db);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob,
      getDatabaseState: vi.fn(async () => ({ version: 15 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(createDatabase).toHaveBeenCalledWith(expect.any(Uint8Array), {
      forceServerData: true,
      localPersistence: expect.any(Object),
      path: 'space_s1_sas.db',
    });
  });

  it('uses local database startup when authoritative mutation gap is within replay threshold', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}s1`, '100');

    const db = createDb();
    const context = createOnlineContext(db);
    const downloadBlob = vi.fn(async () => null);
    const createDatabase = vi.fn(async () => db);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob,
      getDatabaseState: vi.fn(async () => ({ version: 15, mutation_version: 108 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(createDatabase).toHaveBeenCalledWith(undefined, {
      localPersistence: expect.any(Object),
      path: 'space_s1_sas.db',
    });
  });

  it('forces snapshot download when cursor suggests catch-up but local OPFS snapshot is missing', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}s1`, '491');

    const plaintext = new Uint8Array([4, 9, 1]);
    const { encrypted } = await compressAndEncryptDatabase(plaintext, 'passphrase');
    const db = createDb();
    const context = createOnlineContext(db);
    const downloadBlob = vi.fn(async () => ({
      data: encrypted,
      headers: new Headers({ 'X-Database-Version': '491' }),
    }));
    const createDatabase = vi.fn(async () => db);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob,
      hasLocalDatabase: vi.fn(async () => false),
      getDatabaseState: vi.fn(async () => ({ version: 491, mutation_version: 491 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(createDatabase).toHaveBeenCalledWith(expect.any(Uint8Array), {
      forceServerData: true,
      localPersistence: expect.any(Object),
      path: 'space_s1_sas.db',
    });
  });

  it('seeds the mutation cursor from server state when restoring a fresh snapshot', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');

    const plaintext = new Uint8Array([9, 9, 9]);
    const { encrypted } = await compressAndEncryptDatabase(plaintext, 'passphrase');
    const db = createDb();
    const context = createOnlineContext(db);
    const downloadBlob = vi.fn(async () => ({
      data: encrypted,
      headers: new Headers({ 'X-Database-Version': '19' }),
    }));
    const createDatabase = vi.fn(async () => db);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob,
      getDatabaseState: vi.fn(async () => ({ version: 19, mutation_version: 130 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(createDatabase).toHaveBeenCalledWith(expect.any(Uint8Array), {
      forceServerData: true,
      localPersistence: expect.any(Object),
      path: 'space_s1_sas.db',
    });
    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}s1`)).toBe('130');
  });

  it('seeds the mutation cursor from the blob-bound version, not the server-current one', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');

    const plaintext = new Uint8Array([9, 9, 9]);
    const { encrypted } = await compressAndEncryptDatabase(plaintext, 'passphrase');
    const db = createDb();
    const context = createOnlineContext(db);
    // The blob was uploaded at log position 87; the log has since advanced
    // to 130. Seeding must use 87 so catch-up replays 88..130 — seeding 130
    // would silently skip the tail the blob doesn't contain.
    const downloadBlob = vi.fn(async () => ({
      data: encrypted,
      headers: new Headers({ 'X-Database-Version': '19', 'X-Mutation-Version': '87' }),
    }));

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => db),
      downloadBlob,
      getDatabaseState: vi.fn(async () => ({ version: 19, mutation_version: 130 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}s1`)).toBe('87');
  });

  it('forces full snapshot when authoritative mutation gap exceeds replay threshold', async () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    localStorageMock.setItem(`${BLOB_VERSION_STORAGE_PREFIX}s1`, '10');
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}s1`, '100');

    const plaintext = new Uint8Array([7, 7, 7]);
    const { encrypted } = await compressAndEncryptDatabase(plaintext, 'passphrase');
    const db = createDb();
    const context = createOnlineContext(db);
    const downloadBlob = vi.fn(async () => ({
      data: encrypted,
      headers: new Headers({ 'X-Database-Version': '40' }),
    }));

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => db),
      downloadBlob,
      getDatabaseState: vi.fn(async () => ({ version: 40, mutation_version: 500 })),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it('falls back to local database when remote download fails for non-decryption error', async () => {
    const db = createDb();
    const context = createOnlineContext(db);
    const createDatabase = vi.fn(async () => db);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob: vi.fn(async () => {
        throw 'network failed';
      }),
      cleanupDatabaseFile: vi.fn(async () => undefined),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      skipServerDownload: false,
      forceServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(createDatabase).toHaveBeenCalled();
  });

  it('resets local database file when decryption error occurs during local open', async () => {
    const db = createDb();
    const createDatabase = vi
      .fn()
      .mockRejectedValueOnce(new Error('wrong key or password'))
      .mockResolvedValueOnce(db);
    const cleanup = vi.fn(async () => undefined);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => createOnlineContext(db)),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob: vi.fn(async () => null),
      cleanupDatabaseFile: cleanup,
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      skipServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(cleanup).toHaveBeenCalled();
    expect(createDatabase).toHaveBeenCalledTimes(2);
  });

  it('throws normalized decryption error when local reset cannot recover', async () => {
    const createDatabase = vi.fn(async () => {
      throw 'wrong key or password';
    });

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => createOnlineContext()),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      downloadBlob: vi.fn(async () => null),
      cleanupDatabaseFile: vi.fn(async () => {
        throw 'cleanup failed';
      }),
      isE2E: false,
      opfsSuffix: '_sas',
    });

    await expect(
      service.activateSpace({
        spaceId: 's1',
        generation: 1,
        masterPassword: 'master',
        signal: new AbortController().signal,
        localPersistenceCipher: {
          encrypt: vi.fn(async (d: Uint8Array) => d),
          decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
        },
        skipServerDownload: true,
        onRemoteMutation: vi.fn(async () => undefined),
        onSyncConnectionChange: vi.fn(),
      })
    ).rejects.toThrow('Decryption failed');
  });

  it('throws when passphrase is unavailable after key provisioning', async () => {
    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => null),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => createDb()),
      downloadBlob: vi.fn(async () => null),
      isE2E: false,
    });

    await expect(
      service.activateSpace({
        spaceId: 's1',
        generation: 1,
        masterPassword: 'master',
        signal: new AbortController().signal,
        localPersistenceCipher: {
          encrypt: vi.fn(async (d: Uint8Array) => d),
          decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
        },
        skipServerDownload: true,
        onRemoteMutation: vi.fn(async () => undefined),
        onSyncConnectionChange: vi.fn(),
      })
    ).rejects.toThrow('Workspace encryption key unavailable');
  });

  it('normalizes decryption errors from remote snapshots and forwards callback params', async () => {
    const createOnlineContextSpy = vi.fn((_params) => createOnlineContext());
    const onRemoteMutation = vi.fn(async () => undefined);
    const onSyncConnectionChange = vi.fn();
    vi.spyOn(cryptoModule, 'decryptAndDecompressDatabase').mockRejectedValueOnce(
      new Error('wrong key or password')
    );

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: createOnlineContextSpy,
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => createDb()),
      downloadBlob: vi.fn(async () => ({
        data: new Uint8Array([1, 2, 3]),
        headers: new Headers(),
      })),
      isE2E: false,
    });

    await expect(
      service.activateSpace({
        spaceId: 's1',
        generation: 1,
        masterPassword: 'master',
        signal: new AbortController().signal,
        localPersistenceCipher: {
          encrypt: vi.fn(async (d: Uint8Array) => d),
          decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
        },
        forceServerDownload: true,
        onRemoteMutation,
        onSyncConnectionChange,
      })
    ).rejects.toThrow('Decryption failed');

    const service2 = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: createOnlineContextSpy,
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => createDb()),
      downloadBlob: vi.fn(async () => null),
      isE2E: false,
    });
    await service2.activateSpace({
      spaceId: 's1',
      generation: 2,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      skipServerDownload: true,
      onRemoteMutation,
      onSyncConnectionChange,
    });
    const params = createOnlineContextSpy.mock.calls.at(-1)?.[0] as {
      onRemoteMutation: (
        op: string,
        args: Record<string, unknown>,
        id: string,
        offlineQueue: unknown,
        executor: unknown
      ) => Promise<void>;
      onSyncConnectionChange: (connected: boolean) => void;
    };
    await params.onRemoteMutation('x', { a: 1 }, 'm1', {}, {});
    params.onSyncConnectionChange(true);
    expect(onRemoteMutation).toHaveBeenCalledWith('x', { a: 1 }, 'm1', {}, {});
    expect(onSyncConnectionChange).toHaveBeenCalledWith(true);
  });

  it('swallows migration/connect failures and uses injected logger', async () => {
    const db = createDb();
    const context = createOnlineContext(db);
    context.dbLoader.runMigrations = vi.fn(() => {
      throw 'migration failed';
    });
    context.sync.connect = vi.fn(async () => {
      throw new Error('connect failed');
    });
    const log = vi.fn();

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => context),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase: vi.fn(async () => db),
      downloadBlob: vi.fn(async () => null),
      isE2E: false,
      log,
    });

    await expect(
      service.activateSpace({
        spaceId: 's1',
        generation: 1,
        masterPassword: 'master',
        signal: new AbortController().signal,
        localPersistenceCipher: {
          encrypt: vi.fn(async (d: Uint8Array) => d),
          decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
        },
        skipServerDownload: true,
        onRemoteMutation: vi.fn(async () => undefined),
        onSyncConnectionChange: vi.fn(),
      })
    ).resolves.toBe(context);
    expect(log).toHaveBeenCalledWith('warn', 'Initial migrations failed', expect.any(Object));
  });

  it('falls back by cleaning local db on non-decryption create failures', async () => {
    const db = createDb();
    const createDatabase = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk corrupted'))
      .mockResolvedValueOnce(db);
    const cleanupDatabaseFile = vi.fn(async () => undefined);

    const service = new SpaceActivationService({
      keyVault: {
        ensureSpaceKey: vi.fn(async () => crypto.getRandomValues(new Uint8Array(32))),
        getSpacePassphrase: vi.fn(() => 'passphrase'),
        setEncryptionKeyVersion: vi.fn(),
      } as never,
      contextFactory: {
        createOnlineContext: vi.fn(() => createOnlineContext(db)),
      } as never,
      listAvailableSpaces: () => [
        {
          space_id: 's1',
          display_name: 'One',
          owner_user_id: 'u1',
          role: 'owner',
          invitation_status: 'accepted',
          encrypted_space_key: 'k',
          created_at: '2024-01-01',
        },
      ],
      createDatabase,
      cleanupDatabaseFile,
      downloadBlob: vi.fn(async () => null),
      isE2E: false,
    });

    await service.activateSpace({
      spaceId: 's1',
      generation: 1,
      masterPassword: 'master',
      signal: new AbortController().signal,
      localPersistenceCipher: {
        encrypt: vi.fn(async (d: Uint8Array) => d),
        decrypt: vi.fn(async (d: Uint8Array) => ({ decrypted: d, wasEncrypted: true })),
      },
      skipServerDownload: true,
      onRemoteMutation: vi.fn(async () => undefined),
      onSyncConnectionChange: vi.fn(),
    });

    expect(cleanupDatabaseFile).toHaveBeenCalled();
    expect(createDatabase).toHaveBeenCalledTimes(2);
  });
});
