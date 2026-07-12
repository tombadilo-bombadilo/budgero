import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { masterPasswordStore } from '@budgero/runtime';
import { FakeIndexedDBFactory } from '@/test/indexeddb-mock';

import { MasterPasswordManager } from './master-password';

const MASTER_PASSWORD_STATUS_KEY = 'master_password_status';
const MASTER_PASSWORD_SESSION_CACHE_KEY = 'master_password_session_cache_v1';
const MASTER_PASSWORD_INDEXEDDB_STORE = 'master_password';
const MASTER_PASSWORD_INDEXEDDB_RECORD_KEY = 'session_cache';

type SessionPayload = {
  password: string;
  expiresAt: number;
};

type StorageState = Map<string, string>;

function createStorageMock(state: StorageState): Storage {
  return {
    get length() {
      return state.size;
    },
    clear: () => {
      state.clear();
    },
    getItem: (key: string) => state.get(key) ?? null,
    key: (index: number) => Array.from(state.keys())[index] ?? null,
    removeItem: (key: string) => {
      state.delete(key);
    },
    setItem: (key: string, value: string) => {
      state.set(key, String(value));
    },
  };
}

function setGlobalIndexedDB(value: IDBFactory | undefined): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value,
  });
}

function setGlobalStorage(key: 'localStorage' | 'sessionStorage', value: Storage): void {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

function setManagerInternal(key: string, value: unknown): void {
  // The facade delegates to the runtime's shared MasterPasswordStore
  // singleton; reset its private state directly.
  (masterPasswordStore as unknown as Record<string, unknown>)[key] = value;
}

async function flushAsyncStorageWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('MasterPasswordManager IndexedDB persistence', () => {
  const fakeIndexedDB = new FakeIndexedDBFactory();
  const originalIndexedDB = globalThis.indexedDB;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const localStorageState = new Map<string, string>();
  const sessionStorageState = new Map<string, string>();
  const getSessionPayload = () =>
    fakeIndexedDB.read(MASTER_PASSWORD_INDEXEDDB_STORE, MASTER_PASSWORD_INDEXEDDB_RECORD_KEY) as
      | SessionPayload
      | undefined;

  beforeAll(() => {
    setGlobalStorage('localStorage', createStorageMock(localStorageState));
    setGlobalStorage('sessionStorage', createStorageMock(sessionStorageState));
    setGlobalIndexedDB(fakeIndexedDB as unknown as IDBFactory);
  });

  beforeEach(() => {
    localStorageState.clear();
    sessionStorageState.clear();
    fakeIndexedDB.reset();
    setManagerInternal('inMemoryPassword', null);
    setManagerInternal('indexedDBStore', null);
    setGlobalIndexedDB(fakeIndexedDB as unknown as IDBFactory);
  });

  afterAll(() => {
    setGlobalStorage('localStorage', originalLocalStorage);
    setGlobalStorage('sessionStorage', originalSessionStorage);
    setGlobalIndexedDB(originalIndexedDB);
  });

  it('stores session-mode cache in IndexedDB and restores it after restart', async () => {
    MasterPasswordManager.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();

    await MasterPasswordManager.store('secret-123');
    const payload = getSessionPayload();

    // Hardened at-rest format: encrypted under the non-extractable device
    // key — never a readable password field.
    expect(payload?.password).toBeUndefined();
    expect((payload as { v?: number } | undefined)?.v).toBe(2);
    expect(typeof payload?.expiresAt).toBe('number');
    expect(sessionStorage.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toBeNull();

    setManagerInternal('inMemoryPassword', null);
    const cached = await MasterPasswordManager.get();
    expect(cached).toBe('secret-123');
  });

  it('destroys the pre-IndexedDB sessionStorage cache without using it', async () => {
    MasterPasswordManager.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();

    localStorage.setItem(MASTER_PASSWORD_STATUS_KEY, 'true');
    sessionStorage.setItem(
      MASTER_PASSWORD_SESSION_CACHE_KEY,
      JSON.stringify({
        password: 'legacy-secret',
        expiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
      })
    );

    setManagerInternal('inMemoryPassword', null);
    const cached = await MasterPasswordManager.get();

    // The legacy migration path was removed: the stray plaintext entry is
    // deleted, never read back.
    expect(cached).toBeNull();
    expect(sessionStorage.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toBeNull();
    expect(getSessionPayload()).toBeUndefined();
  });

  it('degrades to memory-only (never plaintext) when IndexedDB is unavailable', async () => {
    setGlobalIndexedDB(undefined);
    setManagerInternal('indexedDBStore', null);

    MasterPasswordManager.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();
    await MasterPasswordManager.store('fallback-secret');

    // Hardened behavior: without device-key crypto nothing is persisted;
    // the old code wrote the password to sessionStorage in plaintext.
    expect(sessionStorage.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY)).toBeNull();
    expect(await MasterPasswordManager.get()).toBe('fallback-secret');

    setManagerInternal('inMemoryPassword', null);
    const cached = await MasterPasswordManager.get();
    expect(cached).toBeNull();
  });

  it('clears IndexedDB cache on clear()', async () => {
    MasterPasswordManager.setPersistenceSetting({ mode: 'session', days: 7 });
    await flushAsyncStorageWork();
    await MasterPasswordManager.store('to-clear');

    expect(getSessionPayload()?.password).toBeUndefined();
    expect(getSessionPayload()).toBeDefined();

    MasterPasswordManager.clear();
    await flushAsyncStorageWork();

    expect(localStorage.getItem(MASTER_PASSWORD_STATUS_KEY)).toBeNull();
    expect(getSessionPayload()).toBeUndefined();

    setManagerInternal('inMemoryPassword', null);
    const cached = await MasterPasswordManager.get();
    expect(cached).toBeNull();
  });
});
