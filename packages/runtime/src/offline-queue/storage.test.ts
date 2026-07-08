import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDBQueueStorage, InMemoryQueueStorage } from './storage';
import { createStorageMock } from '../__tests__/storage-mock';

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

  it('indexeddb storage falls back to localStorage when idb fails', async () => {
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

    const storage = new IndexedDBQueueStorage();
    await storage.save('s1', [sample('s1')]);

    const raw = localStorageMock.getItem('budgero_offline_mutation_queue_s1');
    expect(raw).toContain('budgets.create');

    const loaded = await storage.load('s1');
    expect(loaded[0]?.timestamp).toBeInstanceOf(Date);

    await storage.clear('s1');
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

    const storage = new IndexedDBQueueStorage();
    await storage.save('s1', [sample('s1')]);
    const loaded = await storage.load('s1');

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.timestamp).toBeInstanceOf(Date);
    expect(db.createObjectStore).toHaveBeenCalledWith('mutations');

    await storage.clear('s1');
    expect(await storage.load('s1')).toEqual([]);
  });
});
