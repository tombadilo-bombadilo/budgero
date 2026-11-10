/**
 * Storage interface for OfflineQueue.
 * Default implementation uses IndexedDB for crash-resilient, async storage.
 * If IndexedDB/device encryption is unavailable, persistence fails explicitly;
 * plaintext localStorage is read only for legacy migration and never written.
 *
 * Queue entries hold decrypted mutation payloads (amounts, payees, memos), so
 * they are persisted AES-GCM-encrypted under a non-extractable device key of
 * their own (`encq1:` token). That key survives unlock in 'memory' mode
 * (the password cache's `enc1:` device key does not); only sign-out / full
 * reset delete it. Older formats are read and re-encrypted on load: `enc1:`
 * tokens (shared device key, while it still exists) and plaintext entries
 * (releases <= 1.5.2). The old copy is only replaced once the new write
 * lands, so a failed encryption can never lose queued mutations.
 *
 * A stored queue that cannot be decrypted is never silently dropped: it is
 * moved aside (`<spaceId>:undecryptable`), reported, and retried on every
 * load, so a transient key-store failure heals and the next write cannot
 * overwrite it.
 */

import type { MutationPayload } from '../types';
import {
  MILLIUNIT_FORMAT_VERSION,
  mutationFormatVersion,
  upgradeLegacyMoneyValues,
} from '../sync-format.js';
import { masterPasswordStore } from '../key-vault/master-password-store';
import { DEVICE_ENCRYPTED_PREFIX, QUEUE_ENCRYPTED_PREFIX } from '../key-vault/device-crypto';
import { IndexedDBStore } from '../key-vault/indexeddb-store';
import { logRuntime } from '../logging';
import { errorMessage } from '../utils/diagnostics';

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
    version < MILLIUNIT_FORMAT_VERSION
      ? (upgradeLegacyMoneyValues(m.args ?? {}) as Record<string, unknown>)
      : ((m.args as Record<string, unknown>) ?? {});
  return {
    ...m,
    v: mutationFormatVersion(String(m.op ?? ''), args),
    args,
    timestamp: new Date(m.timestamp as string | number),
    spaceId: (m.spaceId as string) || spaceId,
  } as MutationPayload;
}

function isEncryptedToken(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    (raw.startsWith(QUEUE_ENCRYPTED_PREFIX) || raw.startsWith(DEVICE_ENCRYPTED_PREFIX))
  );
}

function setAsideKey(spaceId: string): string {
  return `${spaceId}:undecryptable`;
}

const DB_NAME = 'budgero_offline_queue';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';

/**
 * IndexedDB-backed queue storage.
 */
export class IndexedDBQueueStorage implements QueueStorage {
  private readonly store = new IndexedDBStore(DB_NAME, DB_VERSION, STORE_NAME);

  /** Set-aside tokens still undecryptable after a recovery, until it is persisted. */
  private readonly pendingSetAside = new Map<string, string[]>();

  async load(spaceId: string): Promise<MutationPayload[]> {
    try {
      const raw = await this.store.get(spaceId);
      const recovered = await this.recoverSetAside(spaceId);

      if (isEncryptedToken(raw)) {
        const decoded = await this.decryptQueue(raw, spaceId);
        if (decoded === null) {
          await this.setAside(spaceId, raw);
          return this.persistRecovered(spaceId, recovered, []);
        }
        // Older token format: re-encrypt under the queue's own key.
        const needsRewrite = !raw.startsWith(QUEUE_ENCRYPTED_PREFIX);
        return this.persistRecovered(spaceId, recovered, decoded, needsRewrite);
      }

      if (Array.isArray(raw)) {
        // Legacy plaintext array in IndexedDB: re-persist encrypted. save()
        // writes under the same key, so the plaintext copy is replaced only
        // when encryption succeeds — otherwise migration retries next load.
        const mutations = raw.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId));
        if (mutations.length > 0) {
          return this.persistRecovered(spaceId, recovered, mutations, true);
        }
      }

      if (recovered.length > 0) {
        return this.persistRecovered(spaceId, recovered, []);
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
    if (queue.length === 0) {
      return this.store.delete(spaceId);
    }

    const token = await masterPasswordStore.encryptStringForQueue(JSON.stringify(queue));
    if (!token) {
      // Never claim durability when encryption was unavailable. Callers keep
      // their in-memory queue, but can now surface/retry the failed persist.
      throw new Error('Offline queue encryption unavailable; mutation was not persisted');
    }

    return this.store.put(spaceId, token);
  }

  /**
   * Decrypt a stored token into mutations. Null when it cannot be decrypted
   * (key gone, key-store read failed, corrupt data): the caller keeps it.
   */
  private async decryptQueue(token: string, spaceId: string): Promise<MutationPayload[] | null> {
    let decrypted: string | null;
    try {
      decrypted = await masterPasswordStore.decryptQueueToken(token);
    } catch (error) {
      logRuntime('warn', 'OfflineQueue', 'Offline queue key could not be read', {
        spaceId,
        error: errorMessage(error),
        originalError: error,
      });
      return null;
    }
    if (decrypted === null) return null;
    try {
      const parsed = JSON.parse(decrypted);
      return Array.isArray(parsed)
        ? parsed.map((m: Record<string, unknown>) => deserializeMutation(m, spaceId))
        : null;
    } catch {
      return null;
    }
  }

  /** Move an undecryptable stored queue out of the way of the next write. */
  private async setAside(spaceId: string, token: string): Promise<void> {
    const key = setAsideKey(spaceId);
    const kept = await this.readSetAside(spaceId);
    if (!kept.includes(token)) kept.push(token);
    // A recovery in this same load rewrites the set-aside list afterwards.
    const pending = this.pendingSetAside.get(spaceId);
    if (pending && !pending.includes(token)) pending.push(token);
    await this.store.put(key, kept);
    await this.store.delete(spaceId);
    logRuntime('error', 'OfflineQueue', 'Stored offline queue could not be decrypted; kept aside', {
      spaceId,
      setAside: kept.length,
    });
  }

  /** Queues set aside earlier that decrypt now (e.g. the key store was briefly unreadable). */
  private async recoverSetAside(spaceId: string): Promise<MutationPayload[]> {
    const kept = await this.readSetAside(spaceId);
    if (kept.length === 0) return [];
    const recovered: MutationPayload[] = [];
    const still: string[] = [];
    for (const token of kept) {
      const decoded = await this.decryptQueue(token, spaceId);
      if (decoded === null) still.push(token);
      else recovered.push(...decoded);
    }
    if (recovered.length > 0) {
      this.pendingSetAside.set(spaceId, still);
      logRuntime('warn', 'OfflineQueue', 'Recovered an offline queue that was kept aside', {
        spaceId,
        recovered: recovered.length,
        stillSetAside: still.length,
      });
    }
    return recovered;
  }

  private async readSetAside(spaceId: string): Promise<string[]> {
    const kept = await this.store.get(setAsideKey(spaceId));
    return Array.isArray(kept) ? kept.filter((t): t is string => typeof t === 'string') : [];
  }

  /**
   * Merge recovered (older) entries in front of the current queue and, when
   * anything changed, persist the merge before dropping what it replaces.
   */
  private async persistRecovered(
    spaceId: string,
    recovered: MutationPayload[],
    current: MutationPayload[],
    rewrite = false
  ): Promise<MutationPayload[]> {
    const seen = new Set(current.map((m) => m.id));
    const merged = [...recovered.filter((m) => !seen.has(m.id)), ...current];
    const still = this.pendingSetAside.get(spaceId);
    this.pendingSetAside.delete(spaceId);
    if (!rewrite && recovered.length === 0) return merged;
    try {
      if (merged.length > 0) await this.save(spaceId, merged);
      if (still !== undefined) {
        if (still.length > 0) await this.store.put(setAsideKey(spaceId), still);
        else await this.store.delete(setAsideKey(spaceId));
      }
    } catch {
      // Keep the old copies in place; the merge is retried next load.
    }
    return merged;
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
      const persisted = await this.store.get(spaceId);
      if (isEncryptedToken(persisted)) {
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
