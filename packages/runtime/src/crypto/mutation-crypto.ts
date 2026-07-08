/**
 * Mutation encryption/decryption for real-time sync.
 *
 * This module handles encrypting and decrypting mutation payloads
 * that are sent over WebSocket for real-time collaboration.
 */

import { toBase64, fromBase64 } from './base64';
import { getSubtleCrypto } from './subtle';

/**
 * Mutation encryptor/decryptor for real-time sync payloads.
 */
export class MutationEncryption {
  private key: CryptoKey;

  private salt: Uint8Array;

  private constructor(key: CryptoKey, salt: Uint8Array) {
    this.key = key;
    this.salt = salt;
  }

  /**
   * Create from a space key (raw 32-byte AES key).
   * Salt is derived as SHA-256(spaceKey) to match the original encryption scheme.
   */
  static async fromSpaceKey(spaceKey: Uint8Array): Promise<MutationEncryption> {
    const subtle = getSubtleCrypto();
    const key = await subtle.importKey(
      'raw',
      spaceKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    // Derive salt from space key (SHA-256) - matches original EncryptionService
    const saltBuffer = await subtle.digest('SHA-256', spaceKey);
    const salt = new Uint8Array(saltBuffer);
    return new MutationEncryption(key, salt);
  }

  /**
   * Create from a master password with deterministic key derivation.
   */
  static async fromPassword(
    masterPassword: string,
    salt?: Uint8Array
  ): Promise<MutationEncryption> {
    const subtle = getSubtleCrypto();
    const actualSalt = salt || crypto.getRandomValues(new Uint8Array(32));

    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(masterPassword),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const key = await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: actualSalt,
        iterations: 600_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return new MutationEncryption(key, actualSalt);
  }

  /**
   * Encrypt a mutation payload (JSON object) to base64 string.
   * Format: salt (32 bytes) + IV (12 bytes) + ciphertext (includes GCM tag)
   */
  async encryptMutation(payload: {
    v?: number;
    op: string;
    args: Record<string, unknown>;
  }): Promise<string> {
    const subtle = getSubtleCrypto();
    const jsonString = JSON.stringify(payload);
    const data = new TextEncoder().encode(jsonString);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      data
    );

    const result = new Uint8Array(this.salt.length + iv.length + encrypted.byteLength);
    result.set(this.salt, 0);
    result.set(iv, this.salt.length);
    result.set(new Uint8Array(encrypted), this.salt.length + iv.length);

    return toBase64(result);
  }

  /**
   * Decrypt a mutation payload from base64 string.
   * Expects format: salt (32 bytes) + IV (12 bytes) + ciphertext (includes GCM tag)
   */
  async decryptMutation(
    encryptedPayload: string
  ): Promise<{ v?: number; op: string; args: Record<string, unknown> }> {
    const subtle = getSubtleCrypto();

    const data = fromBase64(encryptedPayload);

    // Validate minimum length: salt (32) + IV (12) + at least some ciphertext
    if (data.length < 32 + 12 + 16) {
      throw new Error('Invalid encrypted data: too short');
    }

    const salt = data.slice(0, 32);
    const iv = data.slice(32, 32 + 12);
    const ciphertext = data.slice(32 + 12);

    // Verify salt matches (security check)
    if (!this.constantTimeEqual(salt, this.salt)) {
      throw new Error('Invalid salt: this data was encrypted with a different key');
    }

    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.key,
      ciphertext
    );
    const jsonString = new TextDecoder().decode(decrypted);

    return JSON.parse(jsonString);
  }

  /**
   * Get the salt for this encryption instance.
   */
  getSalt(): Uint8Array {
    return this.salt;
  }

  /**
   * Constant-time comparison to prevent timing attacks
   */
  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }
}
