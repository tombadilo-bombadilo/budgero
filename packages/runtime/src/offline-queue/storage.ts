/**
 * Storage interface for OfflineQueue.
 * Default implementation uses IndexedDB for crash-resilient, async storage.
 * Falls back to localStorage if IndexedDB is unavailable.
 */

import type { MutationPayload } from '../types';
import { MUTATION_FORMAT_VERSION, upgradeLegacyMoneyValues } from '../sync-format.js';

export interface QueueStorage {
  load(spaceId: string): Promise<MutationPayload[]>;
  save(spaceId: string, queue: MutationPayload[]): Promise<void>;
  clear(spaceId: string): Promise<void>;
}

function deserializeMutation(m: Record<string, unknown>, spaceId: string): MutationPayload {
  const version = typeof m.v === 'number' ? m.v : 1;
  // Entries queued by a pre-milliunit build hold decimal-money args; upgrade
  // them at load so replay after an app update writes the current format.
  const args =
    version < MUTATION_FORMAT_VERSION
      ? (upgradeLegacyMoneyValues(m.args ?? {}) as Record<string, unknown>)
      : ((m.args as Record<string, unknown>) ?? {});
  return {
    ...m,
    v: MUTATION_FORMAT_VERSION,
    args,
    timestamp: new Date(m.timestamp as string | number),
    spaceId: (m.spaceId as string) || spaceId,
  } as MutationPayload;
}

const DB_NAME = 'budgero_offline_queue';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB-backed queue storage.
 */
export class IndexedDBQueueStorage implements QueueStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb();
    }
    return this.dbPromise;
  }

  async load(spaceId: string): Promise<MutationPayload[]> {
    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(spaceId);
        request.onsuccess = () => {
          const raw = request.result;
          if (!raw || !Array.isArray(raw)) {
            resolve([]);
            return;
          }
          resolve(raw.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId)));
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return this.loadFromLocalStorage(spaceId);
    }
  }

  async save(spaceId: string, queue: MutationPayload[]): Promise<void> {
    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        if (queue.length === 0) {
          store.delete(spaceId);
        } else {
          store.put(queue, spaceId);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      this.saveToLocalStorage(spaceId, queue);
    }
  }

  async clear(spaceId: string): Promise<void> {
    return this.save(spaceId, []);
  }

  private loadFromLocalStorage(spaceId: string): MutationPayload[] {
    try {
      const key = `budgero_offline_mutation_queue_${spaceId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId))
        : [];
    } catch {
      return [];
    }
  }

  private saveToLocalStorage(spaceId: string, queue: MutationPayload[]): void {
    try {
      const key = `budgero_offline_mutation_queue_${spaceId}`;
      if (queue.length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(queue));
      }
    } catch {
      /* no-op */
    }
  }
}

/**
 * In-memory queue storage for testing.
 */
export class InMemoryQueueStorage implements QueueStorage {
  private store = new Map<string, MutationPayload[]>();

  async load(spaceId: string): Promise<MutationPayload[]> {
    return [...(this.store.get(spaceId) ?? [])];
  }

  async save(spaceId: string, queue: MutationPayload[]): Promise<void> {
    if (queue.length === 0) {
      this.store.delete(spaceId);
    } else {
      this.store.set(spaceId, [...queue]);
    }
  }

  async clear(spaceId: string): Promise<void> {
    this.store.delete(spaceId);
  }
}
