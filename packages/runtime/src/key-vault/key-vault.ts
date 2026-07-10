/**
 * KeyVault — owns ALL key material.
 *
 * Space keys are per-instance; master-password state is delegated to the
 * shared MasterPasswordStore singleton (one owner across the runtime
 * coordinator and the app's MasterPasswordManager facade).
 * Instance-based (not static). Uses crypto module for key operations.
 */

import {
  encodeSpaceKey,
  decodeSpaceKey,
  generateSpaceKey,
  wrapSpaceKeyWithMaster,
  unwrapSpaceKeyWithMaster,
} from '../crypto';
import { SPACE_KEY_STORAGE_PREFIX } from '../types/storage-keys';
import { errorMessage, isDecryptionError } from '../utils/diagnostics';
import { logRuntime } from '../logging';
import type { SpaceSummary } from '../types';
import {
  MasterPasswordStore,
  masterPasswordStore,
  type MasterPasswordPersistenceSetting,
} from './master-password-store';

export type { MasterPasswordPersistenceSetting };

/**
 * Callbacks for space key provisioning that require network access.
 */
export interface KeyVaultDeps {
  /** Upload a newly generated encrypted space key to the server. */
  uploadEncryptedKey?(spaceId: string, wrappedKey: string): Promise<void>;
  /** Master-password state owner. Defaults to the shared singleton. */
  masterPasswordStore?: MasterPasswordStore;
}

export class KeyVault {
  private spaceKeys = new Map<string, Uint8Array>();

  private provisioningLocks = new Set<string>();

  private deps: KeyVaultDeps;

  private readonly masterPassword: MasterPasswordStore;

  constructor(deps: KeyVaultDeps = {}) {
    this.deps = deps;
    this.masterPassword = deps.masterPasswordStore ?? masterPasswordStore;
  }

  // ---- Master Password (delegated to MasterPasswordStore) ----

  getMasterPassword(): string | null {
    return this.masterPassword.getInMemoryPassword();
  }

  async resolveMasterPassword(): Promise<string> {
    const cached = await this.get();
    if (cached) {
      return cached;
    }
    throw new Error('Master password is required to access shared workspaces');
  }

  getPersistenceSetting(): MasterPasswordPersistenceSetting {
    return this.masterPassword.getPersistenceSetting();
  }

  setPersistenceSetting(setting: MasterPasswordPersistenceSetting): void {
    this.masterPassword.setPersistenceSetting(setting);
  }

  async store(masterPassword: string): Promise<void> {
    await this.masterPassword.store(masterPassword);
  }

  async get(): Promise<string | null> {
    return this.masterPassword.get();
  }

  hasPassword(): boolean {
    return this.masterPassword.hasPassword();
  }

  async verify(masterPassword: string): Promise<boolean> {
    return this.masterPassword.verify(masterPassword);
  }

  canVerifyLocally(): boolean {
    return this.masterPassword.canVerifyLocally();
  }

  clear(): void {
    this.masterPassword.clear();
    this.spaceKeys.clear();
  }

  clearSessionOnly(): void {
    this.masterPassword.clearSessionOnly();
  }

  // ---- Encryption Key Version ----

  getEncryptionKeyVersion(spaceId: string): number {
    return this.masterPassword.getEncryptionKeyVersion(spaceId);
  }

  setEncryptionKeyVersion(spaceId: string, version: number): void {
    this.masterPassword.setEncryptionKeyVersion(spaceId, version);
  }

  // ---- Space Keys ----

  getSpaceKey(spaceId: string): Uint8Array | null {
    return this.spaceKeys.get(spaceId) ?? null;
  }

  getSpacePassphrase(spaceId: string): string | null {
    return this.exportSpaceKey(spaceId);
  }

  exportSpaceKey(spaceId: string): string | null {
    const key = this.spaceKeys.get(spaceId);
    if (!key) return null;
    return encodeSpaceKey(key);
  }

  /**
   * Ensure a space key is available for the given space.
   * If not cached, attempts to: load from persistence → unwrap from server → generate new.
   * Double-provision guard prevents concurrent key generation for same space.
   */
  async ensureSpaceKey(
    spaceId: string,
    masterPassword: string,
    spaces: SpaceSummary[]
  ): Promise<Uint8Array> {
    const cached = this.spaceKeys.get(spaceId);
    if (cached) {
      return cached;
    }

    // Double-provision guard
    if (this.provisioningLocks.has(spaceId)) {
      // Wait for the other provisioning to complete
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!this.provisioningLocks.has(spaceId)) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
      const result = this.spaceKeys.get(spaceId);
      if (result) return result;
    }

    this.provisioningLocks.add(spaceId);
    try {
      return await this.provisionSpaceKey(spaceId, masterPassword, spaces);
    } finally {
      this.provisioningLocks.delete(spaceId);
    }
  }

  /**
   * Prune keys for spaces no longer in the available set.
   */
  pruneKeys(validSpaceIds: string[]): void {
    const retainedKeys = new Map<string, Uint8Array>();

    for (const id of validSpaceIds) {
      const key = this.spaceKeys.get(id);
      if (key) retainedKeys.set(id, key);
    }

    this.spaceKeys = retainedKeys;
  }

  // ---- Internals: Space Key Provision ----

  private async provisionSpaceKey(
    spaceId: string,
    masterPassword: string,
    spaces: SpaceSummary[]
  ): Promise<Uint8Array> {
    // 1. Check persisted storage
    const persisted = await this.loadPersistedSpaceKey(spaceId);
    if (persisted) {
      this.spaceKeys.set(spaceId, persisted);
      return persisted;
    }

    // 2. Unwrap from server-provided encrypted key
    const summary = spaces.find((s) => s.space_id === spaceId);
    if (!summary) {
      throw new Error('Workspace not available');
    }

    const encryptedKey = summary.encrypted_space_key?.trim();
    if (encryptedKey) {
      try {
        const spaceKey = await unwrapSpaceKeyWithMaster(encryptedKey, masterPassword);
        this.spaceKeys.set(spaceId, spaceKey);
        await this.persistSpaceKey(spaceId, spaceKey);
        return spaceKey;
      } catch (error) {
        if (isDecryptionError(error)) {
          throw new Error('Decryption failed: invalid master password or corrupted data', {
            cause: error,
          });
        }
        throw error;
      }
    }

    // 3. Generate new key (owner only)
    if (summary.role === 'owner') {
      const newKey = generateSpaceKey();
      const wrapped = await wrapSpaceKeyWithMaster(newKey, masterPassword);

      try {
        await this.deps.uploadEncryptedKey?.(spaceId, wrapped);
      } catch (error) {
        logRuntime(
          'warn',
          'KeyVault',
          'Failed to upload encrypted workspace key; will retry later',
          {
            spaceId,
            error: errorMessage(error),
          }
        );
      }

      this.spaceKeys.set(spaceId, newKey);
      await this.persistSpaceKey(spaceId, newKey);
      return newKey;
    }

    throw new Error('Workspace owner has not shared access yet.');
  }

  // ---- Internals: Space Key Storage ----

  private async loadPersistedSpaceKey(spaceId: string): Promise<Uint8Array | null> {
    return this.loadStoredSpaceKeyByKey(`${SPACE_KEY_STORAGE_PREFIX}${spaceId}`);
  }

  private async persistSpaceKey(spaceId: string, spaceKey: Uint8Array): Promise<void> {
    await this.persistStoredSpaceKeyByKey(`${SPACE_KEY_STORAGE_PREFIX}${spaceId}`, spaceKey);
  }

  private async loadStoredSpaceKeyByKey(storageKey: string): Promise<Uint8Array | null> {
    const isSharedSpaceKey = storageKey.startsWith(SPACE_KEY_STORAGE_PREFIX);
    const persistence = this.masterPassword.getPersistenceSetting();

    if (isSharedSpaceKey && persistence.mode !== 'session') {
      this.removeStoredSpaceKeyByKey(storageKey);
      return null;
    }

    const fromSession = await this.readSpaceKeyFromStorage('session', storageKey);
    if (fromSession) return fromSession;

    const legacy = await this.readSpaceKeyFromStorage('local', storageKey);
    if (legacy) {
      this.removeSpaceKeyFromStorage('local', storageKey);
      if (isSharedSpaceKey && persistence.mode === 'session') {
        await this.writeEncryptedSpaceKeyToStorage('session', storageKey, legacy);
      }
      return legacy;
    }

    return null;
  }

  private async persistStoredSpaceKeyByKey(
    storageKey: string,
    spaceKey: Uint8Array
  ): Promise<void> {
    const isSharedSpaceKey = storageKey.startsWith(SPACE_KEY_STORAGE_PREFIX);

    if (isSharedSpaceKey) {
      const persistence = this.masterPassword.getPersistenceSetting();
      this.removeSpaceKeyFromStorage('local', storageKey);

      if (persistence.mode !== 'session') {
        this.removeSpaceKeyFromStorage('session', storageKey);
        return;
      }

      await this.writeEncryptedSpaceKeyToStorage('session', storageKey, spaceKey);
      return;
    }

    await this.writeEncryptedSpaceKeyToStorage('local', storageKey, spaceKey);
  }

  /**
   * Persist a space key encrypted under the device key (`enc1:` token).
   * If device-key crypto is unavailable, the key is NOT persisted — the
   * in-memory copy still serves this session, and the next session
   * re-provisions from the server. Never writes plaintext key material.
   */
  private async writeEncryptedSpaceKeyToStorage(
    storageType: 'session' | 'local',
    storageKey: string,
    spaceKey: Uint8Array
  ): Promise<void> {
    const token = await this.masterPassword.encryptStringForDevice(encodeSpaceKey(spaceKey));
    if (!token) {
      this.removeSpaceKeyFromStorage(storageType, storageKey);
      return;
    }
    this.writeSpaceKeyToStorage(storageType, storageKey, token);
  }

  private getStorage(storageType: 'session' | 'local'): Storage | null {
    try {
      return storageType === 'session'
        ? typeof sessionStorage !== 'undefined'
          ? sessionStorage
          : null
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null;
    } catch {
      return null;
    }
  }

  private async readSpaceKeyFromStorage(
    storageType: 'session' | 'local',
    storageKey: string
  ): Promise<Uint8Array | null> {
    try {
      const storage = this.getStorage(storageType);
      if (!storage) return null;
      const raw = storage.getItem(storageKey);
      if (!raw) return null;

      // Device-key-encrypted value (enc1: token).
      if (raw.startsWith('enc1:')) {
        const decrypted = await this.masterPassword.decryptStringForDevice(raw);
        if (!decrypted) {
          // Undecryptable (device key rotated/cleared): drop the stale token.
          this.removeSpaceKeyFromStorage(storageType, storageKey);
          return null;
        }
        return this.decodeStoredSpaceKey(decrypted);
      }

      // Legacy plaintext base64 value (written by releases <= 1.5.2): use it,
      // then re-persist encrypted. Keep until all active installs have opened
      // the app once on a hardened release, then remove.
      const legacy = this.decodeStoredSpaceKey(raw);
      if (legacy) {
        await this.writeEncryptedSpaceKeyToStorage(storageType, storageKey, legacy);
      }
      return legacy;
    } catch {
      return null;
    }
  }

  private writeSpaceKeyToStorage(
    storageType: 'session' | 'local',
    storageKey: string,
    encoded: string
  ): void {
    try {
      this.getStorage(storageType)?.setItem(storageKey, encoded);
    } catch {
      /* no-op */
    }
  }

  private removeSpaceKeyFromStorage(storageType: 'session' | 'local', storageKey: string): void {
    try {
      this.getStorage(storageType)?.removeItem(storageKey);
    } catch {
      /* no-op */
    }
  }

  private removeStoredSpaceKeyByKey(storageKey: string): void {
    this.removeSpaceKeyFromStorage('session', storageKey);
    this.removeSpaceKeyFromStorage('local', storageKey);
  }

  private decodeStoredSpaceKey(encoded: string): Uint8Array | null {
    try {
      return decodeSpaceKey(encoded);
    } catch {
      return null;
    }
  }
}
