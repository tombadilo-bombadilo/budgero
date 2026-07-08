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
    const persisted = this.loadPersistedSpaceKey(spaceId);
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
        this.persistSpaceKey(spaceId, spaceKey);
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
      this.persistSpaceKey(spaceId, newKey);
      return newKey;
    }

    throw new Error('Workspace owner has not shared access yet.');
  }

  // ---- Internals: Space Key Storage ----

  private loadPersistedSpaceKey(spaceId: string): Uint8Array | null {
    return this.loadStoredSpaceKeyByKey(`${SPACE_KEY_STORAGE_PREFIX}${spaceId}`);
  }

  private persistSpaceKey(spaceId: string, spaceKey: Uint8Array): void {
    this.persistStoredSpaceKeyByKey(`${SPACE_KEY_STORAGE_PREFIX}${spaceId}`, spaceKey);
  }

  private loadStoredSpaceKeyByKey(storageKey: string): Uint8Array | null {
    const isSharedSpaceKey = storageKey.startsWith(SPACE_KEY_STORAGE_PREFIX);
    const persistence = this.masterPassword.getPersistenceSetting();

    if (isSharedSpaceKey && persistence.mode !== 'session') {
      this.removeStoredSpaceKeyByKey(storageKey);
      return null;
    }

    const fromSession = this.readSpaceKeyFromStorage('session', storageKey);
    if (fromSession) return fromSession;

    const legacy = this.readSpaceKeyFromStorage('local', storageKey);
    if (legacy) {
      this.removeSpaceKeyFromStorage('local', storageKey);
      if (isSharedSpaceKey && persistence.mode === 'session') {
        this.writeSpaceKeyToStorage('session', storageKey, encodeSpaceKey(legacy));
      }
      return legacy;
    }

    return null;
  }

  private persistStoredSpaceKeyByKey(storageKey: string, spaceKey: Uint8Array): void {
    const encoded = encodeSpaceKey(spaceKey);
    const isSharedSpaceKey = storageKey.startsWith(SPACE_KEY_STORAGE_PREFIX);

    if (isSharedSpaceKey) {
      const persistence = this.masterPassword.getPersistenceSetting();
      this.removeSpaceKeyFromStorage('local', storageKey);

      if (persistence.mode !== 'session') {
        this.removeSpaceKeyFromStorage('session', storageKey);
        return;
      }

      this.writeSpaceKeyToStorage('session', storageKey, encoded);
      return;
    }

    this.writeSpaceKeyToStorage('local', storageKey, encoded);
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

  private readSpaceKeyFromStorage(
    storageType: 'session' | 'local',
    storageKey: string
  ): Uint8Array | null {
    try {
      const storage = this.getStorage(storageType);
      if (!storage) return null;
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      return this.decodeStoredSpaceKey(raw);
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
