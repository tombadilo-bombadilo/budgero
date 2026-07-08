import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MASTER_PASSWORD_INDEXEDDB_STORE,
  MASTER_PASSWORD_INDEXEDDB_RECORD_KEY,
  MASTER_PASSWORD_SESSION_CACHE_KEY,
  MASTER_PASSWORD_STATUS_KEY,
} from '../types/storage-keys';
import { createStorageMock } from '../__tests__/storage-mock';
import { FakeIndexedDBFactory } from '../__tests__/indexeddb-mock';
import { MasterPasswordStore } from './master-password-store';
import { KeyVault } from './key-vault';

type SessionPayload = { password: string; expiresAt: number };

async function flushAsyncStorageWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('MasterPasswordStore', () => {
  const localStorageMock = createStorageMock();
  const sessionStorageMock = createStorageMock();
  const fakeIndexedDB = new FakeIndexedDBFactory();

  function stubEnvironment(options: { indexedDB?: boolean } = {}): void {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    vi.stubGlobal('sessionStorage', sessionStorageMock as unknown as Storage);
    vi.stubGlobal(
      'indexedDB',
      options.indexedDB === false ? undefined : (fakeIndexedDB as unknown as IDBFactory)
    );
  }

  function readIndexedDBPayload(): SessionPayload | undefined {
    return fakeIndexedDB.read(
      MASTER_PASSWORD_INDEXEDDB_STORE,
      MASTER_PASSWORD_INDEXEDDB_RECORD_KEY
    ) as SessionPayload | undefined;
  }

  afterEach(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
    fakeIndexedDB.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores session-mode cache in IndexedDB and restores it in a fresh context', async () => {
    stubEnvironment();
    const store = new MasterPasswordStore();
    store.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();

    await store.store('secret-123');

    const payload = readIndexedDBPayload();
    expect(payload?.password).toBe('secret-123');
    expect(typeof payload?.expiresAt).toBe('number');
    expect(sessionStorageMock.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toBeNull();

    // Fresh store instance = new page load / runtime context. This is the
    // lifecycle-fallback regression: the cache written above must be visible.
    const restored = new MasterPasswordStore();
    expect(await restored.get()).toBe('secret-123');
    expect(restored.canVerifyLocally()).toBe(true);
  });

  it('makes the app-written cache visible to the KeyVault lifecycle fallback', async () => {
    stubEnvironment();

    // App facade side: user unlocked with session persistence enabled.
    const facadeStore = new MasterPasswordStore();
    facadeStore.setPersistenceSetting({ mode: 'session', days: 3 });
    await flushAsyncStorageWork();
    await facadeStore.store('unlock-me');

    // Runtime side: RuntimeLifecycleService.initialize falls back to
    // keyVault.get() when no password is passed. Before unification the
    // KeyVault only read sessionStorage and missed the IndexedDB cache.
    const keyVault = new KeyVault({ masterPasswordStore: new MasterPasswordStore() });
    expect(await keyVault.get()).toBe('unlock-me');
    expect(await keyVault.resolveMasterPassword()).toBe('unlock-me');
  });

  it('shares one owner of in-memory state across KeyVault and store', async () => {
    stubEnvironment();
    const shared = new MasterPasswordStore();
    const vault = new KeyVault({ masterPasswordStore: shared });

    await shared.store('master');
    expect(vault.getMasterPassword()).toBe('master');
    expect(await vault.verify('master')).toBe(true);

    vault.clear();
    expect(shared.getInMemoryPassword()).toBeNull();
    expect(shared.hasPassword()).toBe(false);
  });

  it('migrates legacy sessionStorage cache into IndexedDB', async () => {
    stubEnvironment();
    localStorageMock.setItem(MASTER_PASSWORD_STATUS_KEY, 'true');
    localStorageMock.setItem(
      'master_password_persistence_v1',
      JSON.stringify({ mode: 'session', days: 7 })
    );
    sessionStorageMock.setItem(
      MASTER_PASSWORD_SESSION_CACHE_KEY,
      JSON.stringify({ password: 'legacy-secret', expiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000 })
    );

    const store = new MasterPasswordStore();
    expect(await store.get()).toBe('legacy-secret');
    expect(sessionStorageMock.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toBeNull();
    expect(readIndexedDBPayload()?.password).toBe('legacy-secret');
  });

  it('falls back to sessionStorage when IndexedDB is unavailable', async () => {
    stubEnvironment({ indexedDB: false });
    const store = new MasterPasswordStore();
    store.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();

    await store.store('fallback-secret');
    expect(sessionStorageMock.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toContain(
      'fallback-secret'
    );

    const restored = new MasterPasswordStore();
    expect(await restored.get()).toBe('fallback-secret');
  });

  it('clears status marker and IndexedDB cache on clear()', async () => {
    stubEnvironment();
    const store = new MasterPasswordStore();
    store.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();
    await store.store('to-clear');
    expect(readIndexedDBPayload()?.password).toBe('to-clear');

    store.clear();
    await flushAsyncStorageWork();

    expect(localStorageMock.getItem(MASTER_PASSWORD_STATUS_KEY)).toBeNull();
    expect(readIndexedDBPayload()).toBeUndefined();
    expect(await new MasterPasswordStore().get()).toBeNull();
  });

  it('drops an expired IndexedDB payload and returns null', async () => {
    stubEnvironment();
    const writer = new MasterPasswordStore();
    writer.setPersistenceSetting({ mode: 'session', days: 1 });
    await flushAsyncStorageWork();
    await writer.store('will-expire');

    const payload = readIndexedDBPayload();
    expect(payload?.password).toBe('will-expire');

    const dateSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue((payload?.expiresAt ?? 0) + 1);

    const reader = new MasterPasswordStore();
    expect(await reader.get()).toBeNull();

    dateSpy.mockRestore();
    expect(readIndexedDBPayload()).toBeUndefined();
  });

  it('does not persist any cache in memory mode', async () => {
    stubEnvironment();
    const store = new MasterPasswordStore();
    await store.store('memory-only');

    expect(readIndexedDBPayload()).toBeUndefined();
    expect(sessionStorageMock.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toBeNull();
    expect(await store.get()).toBe('memory-only');
    expect(await new MasterPasswordStore().get()).toBeNull();
  });

  it('keeps an existing cache when the setting is hydrated before unlock', async () => {
    stubEnvironment();
    const writer = new MasterPasswordStore();
    writer.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();
    await writer.store('keep-me');

    // Fresh context hydrates the same setting from the server before the
    // user has unlocked: the valid cache must survive.
    const hydrated = new MasterPasswordStore();
    hydrated.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();

    expect(await hydrated.get()).toBe('keep-me');
  });
});
