/**
 * Space key encryption utilities.
 * Handles generation, wrapping/unwrapping with master password,
 * and invite-based encryption for space sharing.
 */

import { encryptEnvelope, decryptEnvelope } from './envelope';
import { toBase64, fromBase64, toBase64Url, fromBase64Url } from './base64';

const INVITE_BUNDLE_VERSION = 1;

async function deriveInviteKey(inviteSecret: string): Promise<CryptoKey> {
  const secretBytes = fromBase64Url(inviteSecret);
  return crypto.subtle.importKey('raw', secretBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function generateInviteSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export async function hashInviteSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSpaceKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function encodeSpaceKey(spaceKey: Uint8Array): string {
  return toBase64(spaceKey);
}

export function decodeSpaceKey(encoded: string): Uint8Array {
  return fromBase64(encoded);
}

export async function wrapSpaceKeyWithMaster(
  spaceKey: Uint8Array,
  masterPassword: string
): Promise<string> {
  const encrypted = await encryptEnvelope(spaceKey, masterPassword);
  return toBase64(encrypted);
}

export async function unwrapSpaceKeyWithMaster(
  encryptedSpaceKey: string,
  masterPassword: string
): Promise<Uint8Array> {
  const encryptedBytes = fromBase64(encryptedSpaceKey);
  const { decrypted } = await decryptEnvelope(encryptedBytes, masterPassword);
  return decrypted;
}

export async function encryptSpaceKeyForInvite(
  spaceKey: Uint8Array,
  inviteSecret: string
): Promise<string> {
  const key = await deriveInviteKey(inviteSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    spaceKey
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  return JSON.stringify({
    version: INVITE_BUNDLE_VERSION,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  });
}

export async function decryptSpaceKeyFromInvite(
  bundle: string,
  inviteSecret: string
): Promise<Uint8Array> {
  let payload: { version: number; iv: string; ciphertext: string };
  try {
    payload = JSON.parse(bundle);
  } catch {
    throw new Error('Invalid invite bundle payload');
  }
  if (!payload || payload.version !== INVITE_BUNDLE_VERSION) {
    throw new Error('Unsupported invite bundle version');
  }
  const key = await deriveInviteKey(inviteSecret);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new Uint8Array(decryptedBuffer);
}
