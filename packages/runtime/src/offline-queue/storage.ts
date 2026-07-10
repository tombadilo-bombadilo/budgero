/**
 * Storage interface for OfflineQueue.
 * Default implementation uses IndexedDB for crash-resilient, async storage.
 * Falls back to localStorage if IndexedDB is unavailable.
 *
 * Queue entries hold decrypted mutation payloads (amounts, payees, memos), so
 * they are persisted AES-GCM-encrypted under the non-extractable device key
 * (`enc1:` token — same format as the key-vault caches). Legacy plaintext
 * entries (written by releases <= 1.5.2) are readable and re-encrypted on
 * load; the plaintext copy is only replaced once the encrypted write lands,
 * so a failed encryption can never lose queued mutations.
 */

import type { MutationPayload } from '../types';
import { MUTATION_FORMAT_VERSION, upgradeLegacyMoneyValues } from '../sync-format.js';
import { masterPasswordStore } from '../key-vault/master-password-store';
import { DEVICE_ENCRYPTED_PREFIX } from '../key-vault/device-crypto';

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
      const raw = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(spaceId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const mutations = await this.decodeStoredQueue(raw, spaceId);

      // Legacy plaintext array in IndexedDB: re-persist encrypted. save()
      // writes under the same key, so the plaintext copy is replaced only
      // when encryption succeeds — otherwise migration retries next load.
      if (Array.isArray(raw) && mutations.length > 0) {
        await this.save(spaceId, mutations);
        return mutations;
      }

      if (mutations.length > 0) {
        return mutations;
      }

      // Nothing in IndexedDB: drain any legacy plaintext localStorage entry
      // (old builds wrote there when IndexedDB was unavailable).
      return this.drainLegacyLocalStorage(spaceId);
    } catch {
      // IndexedDB unavailable: nothing can be persisted (the device key needs
      // IndexedDB too) — the queue lives in memory for this session. Legacy
      // plaintext localStorage entries are still readable so no data is lost.
      return this.readLegacyLocalStorage(spaceId);
    }
  }

  async save(spaceId: string, queue: MutationPayload[]): Promise<void> {
    try {
      const db = await this.getDb();
      if (queue.length === 0) {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(spaceId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }

      const token = await masterPasswordStore.encryptStringForDevice(JSON.stringify(queue));
      if (!token) {
        // Never write plaintext. The in-memory queue still serves this
        // session; only crash-resilience is degraded until encryption works.
        return;
      }

      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(token, spaceId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // No localStorage fallback: it could only ever hold plaintext (the
      // device key lives in IndexedDB), and plaintext is never written.
    }
  }

  /** Decode a stored value: `enc1:` token, legacy plaintext array, or empty. */
  private async decodeStoredQueue(raw: unknown, spaceId: string): Promise<MutationPayload[]> {
    if (typeof raw === 'string' && raw.startsWith(DEVICE_ENCRYPTED_PREFIX)) {
      const decrypted = await masterPasswordStore.decryptStringForDevice(raw);
      if (!decrypted) return [];
      try {
        const parsed = JSON.parse(decrypted);
        return Array.isArray(parsed)
          ? parsed.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId))
          : [];
      } catch {
        return [];
      }
    }

    if (Array.isArray(raw)) {
      return raw.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId));
    }

    return [];
  }

  async clear(spaceId: string): Promise<void> {
    return this.save(spaceId, []);
  }

  /** Read a legacy plaintext localStorage queue entry (written by old builds). */
  private readLegacyLocalStorage(spaceId: string): MutationPayload[] {
    try {
      const raw = localStorage.getItem(`budgero_offline_mutation_queue_${spaceId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId))
        : [];
    } catch {
      return [];
    }
  }

  /**
   * Migrate a legacy plaintext localStorage entry into the encrypted
   * IndexedDB store, deleting the plaintext copy only once the encrypted
   * write succeeded.
   */
  private async drainLegacyLocalStorage(spaceId: string): Promise<MutationPayload[]> {
    const mutations = this.readLegacyLocalStorage(spaceId);
    if (mutations.length === 0) return mutations;

    try {
      await this.save(spaceId, mutations);
      const db = await this.getDb();
      const persisted = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(spaceId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (typeof persisted === 'string' && persisted.startsWith(DEVICE_ENCRYPTED_PREFIX)) {
        localStorage.removeItem(`budgero_offline_mutation_queue_${spaceId}`);
      }
    } catch {
      /* keep the plaintext copy; migration retries next load */
    }

    return mutations;
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
