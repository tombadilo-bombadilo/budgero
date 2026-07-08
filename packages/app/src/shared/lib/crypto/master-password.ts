/**
 * Master password management for zero-knowledge architecture.
 *
 * Thin static facade over the runtime's shared MasterPasswordStore singleton —
 * the single owner of master-password state (in-memory password, persistence
 * setting, IndexedDB/sessionStorage session cache, encryption-key versions).
 * The RuntimeCoordinator's KeyVault delegates to the same singleton, so the
 * runtime lifecycle and the app always observe identical state.
 */

import { masterPasswordStore, type MasterPasswordPersistenceSetting } from '@budgero/runtime';

export type { MasterPasswordPersistenceSetting };

export class MasterPasswordManager {
  static getPersistenceSetting(): MasterPasswordPersistenceSetting {
    return masterPasswordStore.getPersistenceSetting();
  }

  static setPersistenceSetting(setting: MasterPasswordPersistenceSetting): void {
    masterPasswordStore.setPersistenceSetting(setting);
  }

  /**
   * Store master password state without persisting secrets
   */
  static async store(masterPassword: string): Promise<void> {
    await masterPasswordStore.store(masterPassword);
  }

  /**
   * Get master password for the current runtime
   */
  static async get(): Promise<string | null> {
    return masterPasswordStore.get();
  }

  /**
   * Check if user has set up a master password
   */
  static hasPassword(): boolean {
    return masterPasswordStore.hasPassword();
  }

  /**
   * Verify a password against in-memory cache (best effort)
   */
  static async verify(masterPassword: string): Promise<boolean> {
    return masterPasswordStore.verify(masterPassword);
  }

  static canVerifyLocally(): boolean {
    return masterPasswordStore.canVerifyLocally();
  }

  /**
   * Clear master password (only on logout)
   */
  static clear(): void {
    masterPasswordStore.clear();
  }

  /**
   * Clear cached/session master password but keep device marker (to force re-prompt)
   */
  static clearSessionOnly(): void {
    masterPasswordStore.clearSessionOnly();
  }

  /**
   * Get the encryption key version for a space.
   * Returns 1 if not set (default version).
   */
  static getEncryptionKeyVersion(spaceId: string): number {
    return masterPasswordStore.getEncryptionKeyVersion(spaceId);
  }

  /**
   * Set the encryption key version for a space.
   */
  static setEncryptionKeyVersion(spaceId: string, version: number): void {
    masterPasswordStore.setEncryptionKeyVersion(spaceId, version);
  }
}
