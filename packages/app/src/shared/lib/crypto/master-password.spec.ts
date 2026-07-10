import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { masterPasswordStore } from '@budgero/runtime';

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

class FakeIndexedDBDatabase {
  private stores = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  } as unknown as DOMStringList;

  createObjectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map<string, unknown>());
    }
    return {} as IDBObjectStore;
  }

  transaction(name: string, _mode: IDBTransactionMode): IDBTransaction {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`missing object store: ${name}`);
    }

    const tx: Partial<IDBTransaction> & { objectStore: (storeName: string) => IDBObjectStore } = {
      objectStore: () => {
        const objectStore: Partial<IDBObjectStore> = {
          get: (key: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              Object.defineProperty(request, 'result', {
                configurable: true,
                value: store.get(String(key)),
              });
              const cb = request.onsuccess;
              if (cb) {
                cb.call(
                  request as IDBRequest,
                  new Event('success') as Event & { target: IDBRequest }
                );
              }
            });
            return request as IDBRequest;
          },
          add: (value: unknown, key?: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              if (store.has(String(key))) {
                request.onerror?.call(
                  request as IDBRequest,
                  new Event('error') as Event & { target: IDBRequest }
                );
                tx.onabort?.call(tx as IDBTransaction, new Event('abort') as Event);
                return;
              }
              store.set(String(key), value);
              request.onsuccess?.call(
                request as IDBRequest,
                new Event('success') as Event & { target: IDBRequest }
              );
              tx.oncomplete?.call(tx as IDBTransaction, new Event('complete') as Event);
            });
            return request as IDBRequest;
          },
          put: (value: unknown, key?: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              store.set(String(key), value);
              const reqCb = request.onsuccess;
              if (reqCb) {
                reqCb.call(
                  request as IDBRequest,
                  new Event('success') as Event & { target: IDBRequest }
                );
              }
              const txCb = tx.oncomplete;
              if (txCb) {
                txCb.call(tx as IDBTransaction, new Event('complete') as Event);
              }
            });
            return request as IDBRequest;
          },
          delete: (key: IDBValidKey) => {
            const request: Partial<IDBRequest> = {};
            queueMicrotask(() => {
              store.delete(String(key));
              const reqCb = request.onsuccess;
              if (reqCb) {
                reqCb.call(
                  request as IDBRequest,
                  new Event('success') as Event & { target: IDBRequest }
                );
              }
              const txCb = tx.oncomplete;
              if (txCb) {
                txCb.call(tx as IDBTransaction, new Event('complete') as Event);
              }
            });
            return request as IDBRequest;
          },
        };
        return objectStore as IDBObjectStore;
      },
    };

    return tx as IDBTransaction;
  }

  read(storeName: string, key: string): unknown {
    return this.stores.get(storeName)?.get(key);
  }
}

class FakeIndexedDBFactory {
  private initialized = false;

  private db = new FakeIndexedDBDatabase();

  open(_name: string, _version?: number): IDBOpenDBRequest {
    const request: Partial<IDBOpenDBRequest> = {};
    queueMicrotask(() => {
      Object.defineProperty(request, 'result', {
        configurable: true,
        value: this.db as unknown as IDBDatabase,
      });
      if (!this.initialized) {
        this.initialized = true;
        const upgradeCb = request.onupgradeneeded;
        if (upgradeCb) {
          upgradeCb.call(
            request as IDBOpenDBRequest,
            new Event('upgradeneeded') as IDBVersionChangeEvent
          );
        }
      }
      const successCb = request.onsuccess;
      if (successCb) {
        successCb.call(request as IDBOpenDBRequest, new Event('success') as Event);
      }
    });
    return request as IDBOpenDBRequest;
  }

  reset(): void {
    this.initialized = false;
    this.db = new FakeIndexedDBDatabase();
  }

  getSessionPayload(): SessionPayload | undefined {
    return this.db.read(MASTER_PASSWORD_INDEXEDDB_STORE, MASTER_PASSWORD_INDEXEDDB_RECORD_KEY) as
      | SessionPayload
      | undefined;
  }
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
    setManagerInternal('indexedDBPromise', null);
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
    const payload = fakeIndexedDB.getSessionPayload();

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
    expect(fakeIndexedDB.getSessionPayload()).toBeUndefined();
  });

  it('degrades to memory-only (never plaintext) when IndexedDB is unavailable', async () => {
    setGlobalIndexedDB(undefined);
    setManagerInternal('indexedDBPromise', null);

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

    expect(fakeIndexedDB.getSessionPayload()?.password).toBeUndefined();
    expect(fakeIndexedDB.getSessionPayload()).toBeDefined();

    MasterPasswordManager.clear();
    await flushAsyncStorageWork();

    expect(localStorage.getItem(MASTER_PASSWORD_STATUS_KEY)).toBeNull();
    expect(fakeIndexedDB.getSessionPayload()).toBeUndefined();

    setManagerInternal('inMemoryPassword', null);
    const cached = await MasterPasswordManager.get();
    expect(cached).toBeNull();
  });
});
