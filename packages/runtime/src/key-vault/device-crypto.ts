/**
 * Device-key crypto for at-rest hardening of remembered secrets.
 *
 * A random, NON-EXTRACTABLE AES-GCM key is generated per device and stored as
 * a CryptoKey object in IndexedDB (structured clone preserves the
 * non-extractable flag). Secrets that previously sat in storage as plaintext
 * (session-cached master password, cached space keys) are encrypted under it.
 *
 * Threat model — what this does and does not defend against:
 * - DEFEATS one-shot storage exfiltration (an XSS that dumps IndexedDB /
 *   web storage and phones home gets ciphertext plus a key handle that is
 *   unusable outside this origin and cannot be exported).
 * - Does NOT stop a script resident in the page from *using* the key to
 *   decrypt — same power the app itself has. It can never *extract* the key
 *   or reuse anything after the XSS is cleaned up.
 * - Does NOT bind to hardware: browsers persist the raw key bytes in the
 *   profile directory. Disk-level attackers are out of scope here.
 */

import { getGlobalCrypto, getSubtleCrypto } from '../crypto/subtle';
import { MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY } from '../types/storage-keys';
import { IndexedDBStore } from './indexeddb-store';

/** Prefix marking a device-key-encrypted value in string storage. */
export const DEVICE_ENCRYPTED_PREFIX = 'enc1:';

export interface DeviceEncryptedRecord {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function isCryptoKeyLike(value: unknown): value is CryptoKey {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as CryptoKey).type === 'secret'
  );
}

async function generateDeviceKey(): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, /* extractable */ false, [
    'encrypt',
    'decrypt',
  ]) as Promise<CryptoKey>;
}

/**
 * Load the device key, creating it on first use. Races between tabs resolve
 * to a single winner via add(); the loser re-reads the stored key.
 */
export async function getOrCreateDeviceKey(
  store: IndexedDBStore | null,
  recordKey = MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY
): Promise<CryptoKey | null> {
  if (!store) return null;

  const existing = await store.get(recordKey).catch(() => null);
  if (isCryptoKeyLike(existing)) return existing;

  let generated: CryptoKey;
  try {
    generated = await generateDeviceKey();
  } catch {
    return null;
  }

  try {
    await store.add(recordKey, generated);
    return generated;
  } catch {
    const winner = await store.get(recordKey).catch(() => null);
    return isCryptoKeyLike(winner) ? winner : null;
  }
}

export async function deleteDeviceKeyRecord(
  store: IndexedDBStore | null,
  recordKey = MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY
): Promise<void> {
  await store?.delete(recordKey).catch(() => undefined);
}

export async function encryptWithDeviceKey(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<DeviceEncryptedRecord | null> {
  try {
    const cryptoObj = getGlobalCrypto();
    const subtle = getSubtleCrypto();
    const iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return { iv, ciphertext: new Uint8Array(ciphertext) };
  } catch {
    return null;
  }
}

export async function decryptWithDeviceKey(
  key: CryptoKey,
  record: DeviceEncryptedRecord
): Promise<Uint8Array | null> {
  try {
    const subtle = getSubtleCrypto();
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      key,
      record.ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}
