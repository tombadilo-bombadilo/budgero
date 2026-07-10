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
import { toBase64, fromBase64 } from '../crypto/base64';
import {
  DEVICE_ENCRYPTED_PREFIX,
  getOrCreateDeviceKey,
  deleteDeviceKeyRecord,
  encryptWithDeviceKey,
  decryptWithDeviceKey,
} from './device-crypto';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type MasterPasswordPersistenceSetting =
  | { mode: 'memory' }
  | { mode: 'session'; days: number };

const DEFAULT_PERSISTENCE_SETTING: MasterPasswordPersistenceSetting = { mode: 'memory' };

/**
 * Legacy (v1) session cache record — the password sat in IndexedDB (or
 * sessionStorage) in plaintext. Still READ for migration; never written.
 */
type SessionCachePayload = {
  password: string;
  expiresAt: number;
};

/**
 * v2 session cache record — password encrypted under the non-extractable
 * device key. `expiresAt` stays outside the ciphertext: it gates cheap expiry
 * checks and has no confidentiality value.
 */
type EncryptedSessionCachePayload = {
  v: 2;
  iv: Uint8Array;
  ciphertext: Uint8Array;
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

  private isEncryptedSessionCachePayload(value: unknown): value is EncryptedSessionCachePayload {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const record = value as Partial<EncryptedSessionCachePayload>;
    return (
      record.v === 2 &&
      record.iv instanceof Uint8Array &&
      record.ciphertext instanceof Uint8Array &&
      typeof record.expiresAt === 'number'
    );
  }

  // ---- Internals: Device Key Crypto ----

  private async getDeviceKey(): Promise<CryptoKey | null> {
    const db = await this.openIndexedDB();
    return getOrCreateDeviceKey(db);
  }

  /**
   * Encrypt a string under the device key into an `enc1:` token for string
   * storage (used by KeyVault for cached space keys). Null when device-key
   * crypto is unavailable — callers must NOT fall back to plaintext.
   */
  async encryptStringForDevice(value: string): Promise<string | null> {
    const key = await this.getDeviceKey();
    if (!key) return null;
    const record = await encryptWithDeviceKey(key, new TextEncoder().encode(value));
    if (!record) return null;
    return `${DEVICE_ENCRYPTED_PREFIX}${toBase64(record.iv)}.${toBase64(record.ciphertext)}`;
  }

  /** Decrypt an `enc1:` token produced by encryptStringForDevice. */
  async decryptStringForDevice(token: string): Promise<string | null> {
    if (!token.startsWith(DEVICE_ENCRYPTED_PREFIX)) return null;
    const body = token.slice(DEVICE_ENCRYPTED_PREFIX.length);
    const dot = body.indexOf('.');
    if (dot <= 0) return null;

    let iv: Uint8Array;
    let ciphertext: Uint8Array;
    try {
      iv = fromBase64(body.slice(0, dot));
      ciphertext = fromBase64(body.slice(dot + 1));
    } catch {
      return null;
    }

    const key = await this.getDeviceKey();
    if (!key) return null;
    const plaintext = await decryptWithDeviceKey(key, { iv, ciphertext });
    if (!plaintext) return null;
    return new TextDecoder().decode(plaintext);
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

  private async readRawSessionRecord(): Promise<unknown> {
    const db = await this.openIndexedDB();
    if (!db) {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readonly');
        const store = tx.objectStore(MASTER_PASSWORD_INDEXEDDB_STORE);
        const request = store.get(MASTER_PASSWORD_INDEXEDDB_RECORD_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async putSessionRecord(payload: EncryptedSessionCachePayload): Promise<boolean> {
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

  /**
   * Encrypt the password under the device key and persist as a v2 record.
   * When device-key crypto is unavailable the password is NOT persisted —
   * degrading to memory-only beats writing plaintext anywhere.
   */
  private async writeEncryptedSessionRecord(password: string, expiresAt: number): Promise<boolean> {
    const key = await this.getDeviceKey();
    if (!key) return false;

    const record = await encryptWithDeviceKey(
      key,
      new TextEncoder().encode(JSON.stringify({ password }))
    );
    if (!record) return false;

    return this.putSessionRecord({
      v: 2,
      iv: record.iv,
      ciphertext: record.ciphertext,
      expiresAt,
    });
  }

  private async decryptSessionRecord(
    payload: EncryptedSessionCachePayload
  ): Promise<string | null> {
    const key = await this.getDeviceKey();
    if (!key) return null;
    const plaintext = await decryptWithDeviceKey(key, {
      iv: payload.iv,
      ciphertext: payload.ciphertext,
    });
    if (!plaintext) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      return typeof parsed?.password === 'string' ? parsed.password : null;
    } catch {
      return null;
    }
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

  /**
   * Delete the pre-IndexedDB plaintext sessionStorage cache. The read/migrate
   * path for it was removed (no clients that old remain) — this is pure
   * hygiene so any stray plaintext copy gets destroyed, never used.
   */
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
    const expiresAt = Date.now() + this.normalizeSessionDays(days) * DAY_IN_MS;
    const persisted = await this.writeEncryptedSessionRecord(password, expiresAt);
    if (persisted) {
      this.clearLegacySessionCache();
    }
    // No plaintext fallback: environments without IndexedDB/WebCrypto degrade
    // to memory-only persistence rather than writing the password readable.
  }

  private async readSessionCache(): Promise<string | null> {
    // NOTE: we intentionally do NOT gate reads on the local "mode" setting.
    // The cache is only ever written when the user opts into session mode, and
    // it is cleared whenever the user explicitly switches back to memory mode.
    // Reading it unconditionally means we survive the case where localStorage
    // is temporarily out of sync with the server preference (e.g. on a fresh
    // device that just hydrated its setting from the profile).
    const raw = await this.readRawSessionRecord();

    if (this.isEncryptedSessionCachePayload(raw)) {
      if (Date.now() > raw.expiresAt) {
        await this.clearPersistedPassword();
        return null;
      }
      return this.decryptSessionRecord(raw);
    }

    // Migration: v1 record stored the password in plaintext. Re-persist
    // encrypted (preserving the original expiry), overwriting the plaintext.
    // v1 is what releases <= 1.5.2 wrote — keep this path until all active
    // installs have opened the app once on a hardened release, then remove.
    if (this.isValidSessionCachePayload(raw)) {
      if (Date.now() > raw.expiresAt) {
        await this.clearPersistedPassword();
        return null;
      }
      const migrated = await this.writeEncryptedSessionRecord(raw.password, raw.expiresAt);
      if (!migrated) {
        // Could not encrypt: remove the plaintext record rather than leave it.
        await this.clearSessionCacheFromIndexedDB();
      }
      return raw.password;
    }

    // Destroy any stray pre-IndexedDB plaintext cache without reading it.
    this.clearLegacySessionCache();
    return null;
  }

  private async clearPersistedPassword(): Promise<void> {
    await this.clearSessionCacheFromIndexedDB();
    this.clearLegacySessionCache();
    this.clearSpaceKeyCaches();
    const db = await this.openIndexedDB();
    await deleteDeviceKeyRecord(db);
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
