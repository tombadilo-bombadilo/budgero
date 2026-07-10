import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBQueueStorage, InMemoryQueueStorage } from './storage';
import { masterPasswordStore } from '../key-vault/master-password-store';
import { createStorageMock } from '../__tests__/storage-mock';

/** The device-key store caches its IndexedDB handle; reset between tests. */
function resetDeviceKeyDbCache(): void {
  (masterPasswordStore as unknown as { indexedDBPromise: unknown }).indexedDBPromise = null;
}

function sample(spaceId: string) {
  return {
    id: 'm1',
    baseVersion: 1,
    op: 'budgets.create',
    args: { n: 1 },
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    spaceId,
  };
}

describe('queue storage', () => {
  const localStorageMock = createStorageMock();

  afterEach(() => {
    localStorageMock.clear();
    resetDeviceKeyDbCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('in-memory storage round-trip', async () => {
    const storage = new InMemoryQueueStorage();

    await storage.save('s1', [sample('s1')]);
    const loaded = await storage.load('s1');
    expect(loaded).toHaveLength(1);

    await storage.clear('s1');
    expect(await storage.load('s1')).toEqual([]);
  });

  it('reads legacy plaintext localStorage when idb fails, but never writes it', async () => {
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    const orig = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open: () => {
          throw new Error('idb disabled');
        },
      },
    });
    resetDeviceKeyDbCache();

    // Legacy plaintext entry written by an old build is still readable.
    localStorageMock.setItem('budgero_offline_mutation_queue_s1', JSON.stringify([sample('s1')]));
    const storage = new IndexedDBQueueStorage();
    const loaded = await storage.load('s1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.timestamp).toBeInstanceOf(Date);

    // With IndexedDB down the device key is unavailable, so save() persists
    // nothing — and in particular never writes plaintext to localStorage.
    localStorageMock.clear();
    await storage.save('s1', [sample('s1')]);
    expect(localStorageMock.getItem('budgero_offline_mutation_queue_s1')).toBeNull();

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: orig,
    });
  });

  it('uses indexeddb path when available', async () => {
    const dbStore = new Map<string, unknown>();
    const db = {
      objectStoreNames: {
        contains: vi.fn(() => false),
      },
      createObjectStore: vi.fn(),
      transaction: vi.fn((_store: string, mode: string) => {
        const tx = {
          error: null,
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          objectStore: () => ({
            get: (key: string) => {
              const req = {
                result: dbStore.get(key),
                error: null,
                onsuccess: null as null | (() => void),
                onerror: null as null | (() => void),
              };
              queueMicrotask(() => req.onsuccess?.());
              return req;
            },
            put: (value: unknown, key: string) => {
              dbStore.set(key, value);
            },
            add: (value: unknown, key: string) => {
              const req = {
                error: null,
                onsuccess: null as null | (() => void),
                onerror: null as null | (() => void),
              };
              if (!dbStore.has(key)) {
                dbStore.set(key, value);
                queueMicrotask(() => req.onsuccess?.());
              } else {
                queueMicrotask(() => req.onerror?.());
              }
              return req;
            },
            delete: (key: string) => {
              dbStore.delete(key);
            },
          }),
        };
        if (mode === 'readwrite') {
          queueMicrotask(() => tx.oncomplete?.());
        }
        return tx;
      }),
    };

    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const request = {
          result: db,
          error: null,
          onupgradeneeded: null as null | (() => void),
          onsuccess: null as null | (() => void),
          onerror: null as null | (() => void),
        };
        queueMicrotask(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      }),
    });

    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    resetDeviceKeyDbCache();
    const storage = new IndexedDBQueueStorage();
    await storage.save('s1', [sample('s1')]);

    // Persisted value is an encrypted token, not readable mutation data.
    const persisted = dbStore.get('s1');
    expect(typeof persisted).toBe('string');
    expect(persisted as string).toMatch(/^enc1:/);
    expect(persisted as string).not.toContain('budgets.create');

    const loaded = await storage.load('s1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.timestamp).toBeInstanceOf(Date);
    expect(db.createObjectStore).toHaveBeenCalledWith('mutations');

    await storage.clear('s1');
    expect(await storage.load('s1')).toEqual([]);

    // Legacy plaintext localStorage entry drains into the encrypted store:
    // readable data comes back, the plaintext copy is deleted, and the
    // IndexedDB copy is an enc1: token.
    localStorageMock.setItem('budgero_offline_mutation_queue_s2', JSON.stringify([sample('s2')]));
    const drained = await storage.load('s2');
    expect(drained).toHaveLength(1);
    expect(localStorageMock.getItem('budgero_offline_mutation_queue_s2')).toBeNull();
    expect(dbStore.get('s2') as string).toMatch(/^enc1:/);
  });
});
