/**
 * MasterPasswordStore — single owner of master-password state.
 *
 * Owns the in-memory password, the persistence setting, the device status
 * marker, the session cache (IndexedDB primary, sessionStorage legacy), and
 * the encryption-key-version markers. Both the runtime's KeyVault and the
 * app's MasterPasswordManager facade delegate to the shared singleton, so the
 * lifecycle fallback and the app always see the same state.
 *
 * Storage keys and on-disk formats are frozen — existing users' persisted
 * state must keep working.
 */

import {
  SPACE_KEY_STORAGE_PREFIX,
  ENCRYPTION_KEY_VERSION_PREFIX,
  MASTER_PASSWORD_STATUS_KEY,
  MASTER_PASSWORD_PERSISTENCE_KEY,
  MASTER_PASSWORD_SESSION_CACHE_KEY,
  MASTER_PASSWORD_INDEXEDDB_NAME,
  MASTER_PASSWORD_INDEXEDDB_STORE,
  MASTER_PASSWORD_INDEXEDDB_RECORD_KEY,
} from '../types/storage-keys';
import { readStoredVersion, writeStoredVersion } from '../utils/stored-version';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type MasterPasswordPersistenceSetting =
  | { mode: 'memory' }
  | { mode: 'session'; days: number };

const DEFAULT_PERSISTENCE_SETTING: MasterPasswordPersistenceSetting = { mode: 'memory' };

type SessionCachePayload = {
  password: string;
  expiresAt: number;
};

export class MasterPasswordStore {
  private inMemoryPassword: string | null = null;

  private indexedDBPromise: Promise<IDBDatabase | null> | null = null;

  // ---- Master Password ----

  getInMemoryPassword(): string | null {
    return this.inMemoryPassword;
  }

  /** Store master password state without persisting secrets outside opted-in session cache. */
  async store(masterPassword: string): Promise<void> {
    try {
      localStorage.setItem(MASTER_PASSWORD_STATUS_KEY, 'true');
    } catch {
      /* no-op */
    }
    this.inMemoryPassword = masterPassword;
    await this.syncPersistenceState(masterPassword);
  }

  /** Get master password from memory, falling back to the session cache. */
  async get(): Promise<string | null> {
    if (this.inMemoryPassword) {
      return this.inMemoryPassword;
    }

    if (!this.hasPassword()) {
      await this.clearPersistedPassword();
      return null;
    }

    const cached = await this.readSessionCache();
    if (cached) {
      this.inMemoryPassword = cached;
      await this.syncPersistenceState(cached);
      return cached;
    }

    return null;
  }

  /** Check if user has set up a master password on this device. */
  hasPassword(): boolean {
    try {
      return localStorage.getItem(MASTER_PASSWORD_STATUS_KEY) === 'true';
    } catch {
      return false;
    }
  }

  /** Verify a password against the in-memory cache (best effort). */
  async verify(masterPassword: string): Promise<boolean> {
    if (!this.inMemoryPassword) {
      return false;
    }
    return this.inMemoryPassword === masterPassword;
  }

  canVerifyLocally(): boolean {
    return this.inMemoryPassword !== null;
  }

  /** Clear master password (only on logout / full reset). */
  clear(): void {
    this.inMemoryPassword = null;
    try {
      localStorage.removeItem(MASTER_PASSWORD_STATUS_KEY);
    } catch {
      /* no-op */
    }
    void this.clearPersistedPassword().catch(() => {
      /* no-op */
    });
  }

  /** Clear cached/session master password but keep device marker (to force re-prompt). */
  clearSessionOnly(): void {
    this.inMemoryPassword = null;
    void this.clearPersistedPassword().catch(() => {
      /* no-op */
    });
  }

  // ---- Persistence Setting ----

  getPersistenceSetting(): MasterPasswordPersistenceSetting {
    return this.loadPersistenceSetting();
  }

  setPersistenceSetting(setting: MasterPasswordPersistenceSetting): void {
    const normalized: MasterPasswordPersistenceSetting =
      setting.mode === 'session'
        ? { mode: 'session', days: this.normalizeSessionDays(setting.days) }
        : DEFAULT_PERSISTENCE_SETTING;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MASTER_PASSWORD_PERSISTENCE_KEY, JSON.stringify(normalized));
      }
    } catch {
      /* no-op */
    }

    void this.syncPersistenceState().catch(() => {
      /* no-op */
    });
  }

  // ---- Encryption Key Version ----

  getEncryptionKeyVersion(spaceId: string): number {
    return readStoredVersion(`${ENCRYPTION_KEY_VERSION_PREFIX}${spaceId}`, 1);
  }

  setEncryptionKeyVersion(spaceId: string, version: number): void {
    writeStoredVersion(`${ENCRYPTION_KEY_VERSION_PREFIX}${spaceId}`, version);
  }

  // ---- Internals: Persistence Setting ----

  private loadPersistenceSetting(): MasterPasswordPersistenceSetting {
    try {
      if (typeof localStorage === 'undefined') {
        return DEFAULT_PERSISTENCE_SETTING;
      }
      const raw = localStorage.getItem(MASTER_PASSWORD_PERSISTENCE_KEY);
      if (!raw) {
        return DEFAULT_PERSISTENCE_SETTING;
      }
      const parsed = JSON.parse(raw);
      if (parsed && parsed.mode === 'session' && typeof parsed.days === 'number') {
        return { mode: 'session', days: this.normalizeSessionDays(parsed.days) };
      }
    } catch {
      /* no-op */
    }

    return DEFAULT_PERSISTENCE_SETTING;
  }

  private normalizeSessionDays(days: number): number {
    const coerced = Number.isFinite(days) ? Math.round(days) : 0;
    return Math.min(Math.max(coerced, 1), 30);
  }

  private async syncPersistenceState(
    password: string | null = this.inMemoryPassword
  ): Promise<void> {
    const setting = this.loadPersistenceSetting();
    if (setting.mode === 'session') {
      if (password) {
        await this.writeSessionCache(password, setting.days);
      }
      // No password to write: leave any existing cache alone. This matters
      // when we hydrate the setting from the server (e.g. via UserPreferencesSync
      // or MasterPasswordGuard) before the user has unlocked the app — we don't
      // want to destroy a valid cache just because there's no in-memory password
      // at this moment.
      return;
    }
    await this.clearPersistedPassword();
  }

  // ---- Internals: Session Cache (IndexedDB primary, sessionStorage legacy) ----

  private isValidSessionCachePayload(value: unknown): value is SessionCachePayload {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const record = value as Partial<SessionCachePayload>;
    return typeof record.password === 'string' && typeof record.expiresAt === 'number';
  }

  private isIndexedDBAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private openIndexedDB(): Promise<IDBDatabase | null> {
    if (!this.isIndexedDBAvailable()) {
      return Promise.resolve(null);
    }

    if (this.indexedDBPromise) {
      return this.indexedDBPromise;
    }

    this.indexedDBPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = indexedDB.open(MASTER_PASSWORD_INDEXEDDB_NAME, 1);
        request.onupgradeneeded = () => {
          try {
            const db = request.result;
            if (!db.objectStoreNames.contains(MASTER_PASSWORD_INDEXEDDB_STORE)) {
              db.createObjectStore(MASTER_PASSWORD_INDEXEDDB_STORE);
            }
          } catch {
            /* no-op */
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }).then((db) => {
      if (!db) {
        this.indexedDBPromise = null;
      }
      return db;
    });

    return this.indexedDBPromise;
  }

  private async readSessionCacheFromIndexedDB(): Promise<SessionCachePayload | null> {
    const db = await this.openIndexedDB();
    if (!db) {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readonly');
        const store = tx.objectStore(MASTER_PASSWORD_INDEXEDDB_STORE);
        const request = store.get(MASTER_PASSWORD_INDEXEDDB_RECORD_KEY);
        request.onsuccess = () => {
          const value = request.result;
          if (!this.isValidSessionCachePayload(value)) {
            resolve(null);
            return;
          }
          resolve(value);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async writeSessionCacheToIndexedDB(payload: SessionCachePayload): Promise<boolean> {
    const db = await this.openIndexedDB();
    if (!db) {
      return false;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readwrite');
        const store = tx.objectStore(MASTER_PASSWORD_INDEXEDDB_STORE);
        store.put(payload, MASTER_PASSWORD_INDEXEDDB_RECORD_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  private async clearSessionCacheFromIndexedDB(): Promise<void> {
    const db = await this.openIndexedDB();
    if (!db) {
      return;
    }

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readwrite');
        const store = tx.objectStore(MASTER_PASSWORD_INDEXEDDB_STORE);
        store.delete(MASTER_PASSWORD_INDEXEDDB_RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private writeLegacySessionCache(payload: SessionCachePayload): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(MASTER_PASSWORD_SESSION_CACHE_KEY, JSON.stringify(payload));
      }
    } catch {
      /* no-op */
    }
  }

  private readLegacySessionCache(): SessionCachePayload | null {
    try {
      if (typeof sessionStorage === 'undefined') {
        return null;
      }
      const raw = sessionStorage.getItem(MASTER_PASSWORD_SESSION_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!this.isValidSessionCachePayload(parsed)) {
        this.clearLegacySessionCache();
        return null;
      }
      return parsed;
    } catch {
      this.clearLegacySessionCache();
      return null;
    }
  }

  private clearLegacySessionCache(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(MASTER_PASSWORD_SESSION_CACHE_KEY);
      }
    } catch {
      /* no-op */
    }
  }

  private async writeSessionCache(password: string, days: number): Promise<void> {
    const payload: SessionCachePayload = {
      password,
      expiresAt: Date.now() + this.normalizeSessionDays(days) * DAY_IN_MS,
    };

    const persisted = await this.writeSessionCacheToIndexedDB(payload);
    if (persisted) {
      this.clearLegacySessionCache();
      return;
    }

    this.writeLegacySessionCache(payload);
  }

  private async readSessionCache(): Promise<string | null> {
    // NOTE: we intentionally do NOT gate reads on the local "mode" setting.
    // The cache is only ever written when the user opts into session mode, and
    // it is cleared whenever the user explicitly switches back to memory mode.
    // Reading it unconditionally means we survive the case where localStorage
    // is temporarily out of sync with the server preference (e.g. on a fresh
    // device that just hydrated its setting from the profile).
    const indexedDBPayload = await this.readSessionCacheFromIndexedDB();
    if (indexedDBPayload) {
      if (Date.now() > indexedDBPayload.expiresAt) {
        await this.clearPersistedPassword();
        return null;
      }
      return indexedDBPayload.password;
    }

    // Backward compatibility: migrate existing sessionStorage cache to IndexedDB.
    const legacyPayload = this.readLegacySessionCache();
    if (!legacyPayload) {
      return null;
    }

    if (Date.now() > legacyPayload.expiresAt) {
      this.clearLegacySessionCache();
      return null;
    }

    const migrated = await this.writeSessionCacheToIndexedDB(legacyPayload);
    if (migrated) {
      this.clearLegacySessionCache();
    }
    return legacyPayload.password;
  }

  private async clearPersistedPassword(): Promise<void> {
    await this.clearSessionCacheFromIndexedDB();
    this.clearLegacySessionCache();
    this.clearSpaceKeyCaches();
  }

  private clearSpaceKeyCaches(): void {
    const clearPrefixedKeys = (storageType: 'session' | 'local'): void => {
      try {
        const storage = storageType === 'session' ? sessionStorage : localStorage;
        if (typeof storage === 'undefined' || !storage) {
          return;
        }
        const keysToRemove: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key && key.startsWith(SPACE_KEY_STORAGE_PREFIX)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => storage.removeItem(key));
      } catch {
        /* no-op */
      }
    };

    clearPrefixedKeys('session');
    clearPrefixedKeys('local');
  }
}

/**
 * Shared singleton — the ONE owner of master-password state. The
 * RuntimeCoordinator's KeyVault and the app's MasterPasswordManager facade
 * both delegate here.
 */
export const masterPasswordStore = new MasterPasswordStore();
