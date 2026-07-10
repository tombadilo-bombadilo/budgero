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
import {
  MASTER_PASSWORD_INDEXEDDB_STORE,
  MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY,
} from '../types/storage-keys';

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

function readDeviceKeyRecord(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readonly');
      const request = tx
        .objectStore(MASTER_PASSWORD_INDEXEDDB_STORE)
        .get(MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY);
      request.onsuccess = () => {
        resolve(isCryptoKeyLike(request.result) ? request.result : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** add() so a concurrent tab's key wins; returns whether OUR write landed. */
function addDeviceKeyRecord(db: IDBDatabase, key: CryptoKey): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readwrite');
      tx.objectStore(MASTER_PASSWORD_INDEXEDDB_STORE).add(
        key,
        MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY
      );
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Load the device key, creating it on first use. Races between tabs resolve
 * to a single winner via add(); the loser re-reads the stored key.
 */
export async function getOrCreateDeviceKey(db: IDBDatabase | null): Promise<CryptoKey | null> {
  if (!db) return null;

  const existing = await readDeviceKeyRecord(db);
  if (existing) return existing;

  let generated: CryptoKey;
  try {
    generated = await generateDeviceKey();
  } catch {
    return null;
  }

  const won = await addDeviceKeyRecord(db, generated);
  if (won) return generated;
  return readDeviceKeyRecord(db);
}

export function deleteDeviceKeyRecord(db: IDBDatabase | null): Promise<void> {
  if (!db) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MASTER_PASSWORD_INDEXEDDB_STORE, 'readwrite');
      tx.objectStore(MASTER_PASSWORD_INDEXEDDB_STORE).delete(MASTER_PASSWORD_DEVICE_KEY_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
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
