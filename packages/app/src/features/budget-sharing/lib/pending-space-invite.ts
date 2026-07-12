// Secure handoff storage for workspace-invite secrets captured from URL
// fragments. Cross-tab persistence lives in IndexedDB encrypted under a
// non-extractable AES-GCM key; web storage is used only as a short-lived,
// same-tab fallback when IndexedDB/WebCrypto is unavailable.

import {
  IndexedDBStore,
  decryptWithDeviceKey,
  encryptWithDeviceKey,
  getOrCreateDeviceKey,
} from '@budgero/runtime';

export const PENDING_SPACE_INVITE_KEY = 'pendingSpaceInviteSecret';
export const PENDING_SPACE_INVITE_DB_NAME = 'budgero_pending_space_invite';

const STORE_NAME = 'vault';
const DEVICE_KEY_RECORD = 'device-key';
const INVITE_RECORD = 'invite';
const RECORD_VERSION = 2;
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

type SessionFallback = { v: 1; secret: string; expiresAt: number };
type EncryptedInviteRecord = { v: 2; iv: Uint8Array; ciphertext: Uint8Array };

const vaultStore = new IndexedDBStore(PENDING_SPACE_INVITE_DB_NAME, 1, STORE_NAME);

function removeWebStorageCopies(): void {
  try {
    sessionStorage.removeItem(PENDING_SPACE_INVITE_KEY);
  } catch {
    /* no-op */
  }
  try {
    localStorage.removeItem(PENDING_SPACE_INVITE_KEY);
  } catch {
    /* no-op */
  }
}

function parseFallback(raw: string | null): SessionFallback | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionFallback>;
    if (
      parsed?.v === 1 &&
      typeof parsed.secret === 'string' &&
      typeof parsed.expiresAt === 'number'
    ) {
      return { v: 1, secret: parsed.secret.trim(), expiresAt: parsed.expiresAt };
    }
  } catch {
    // Legacy records were the raw secret. Give them one bounded migration
    // window instead of retaining them indefinitely.
    return { v: 1, secret: raw.trim(), expiresAt: Date.now() + MAX_PENDING_AGE_MS };
  }
  return null;
}

function writeSessionFallback(secret: string, expiresAt: number): void {
  try {
    sessionStorage.setItem(
      PENDING_SPACE_INVITE_KEY,
      JSON.stringify({ v: 1, secret, expiresAt } satisfies SessionFallback)
    );
  } catch {
    /* no-op */
  }
}

export async function writePendingSpaceInvite(
  value: string,
  expiresAt = Date.now() + MAX_PENDING_AGE_MS
): Promise<boolean> {
  const secret = value.trim();
  if (!secret) return false;
  const boundedExpiry = Math.min(expiresAt, Date.now() + MAX_PENDING_AGE_MS);

  // Calling an async function executes through this point synchronously, so a
  // redirect in the same tick still has a same-tab recovery record.
  writeSessionFallback(secret, boundedExpiry);

  const key = await getOrCreateDeviceKey(vaultStore, DEVICE_KEY_RECORD);
  if (!key) return false;

  try {
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ secret, expiresAt: boundedExpiry })
    );
    const encrypted = await encryptWithDeviceKey(key, plaintext);
    if (!encrypted) return false;
    await vaultStore.put(INVITE_RECORD, {
      v: RECORD_VERSION,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    });
    removeWebStorageCopies();
    return true;
  } catch {
    return false;
  }
}

async function readEncryptedInvite(): Promise<SessionFallback | null> {
  const raw = await vaultStore.get(INVITE_RECORD).catch(() => null);
  if (
    !raw ||
    typeof raw !== 'object' ||
    (raw as EncryptedInviteRecord).v !== RECORD_VERSION ||
    !((raw as EncryptedInviteRecord).iv instanceof Uint8Array) ||
    !((raw as EncryptedInviteRecord).ciphertext instanceof Uint8Array)
  ) {
    return null;
  }
  const key = await getOrCreateDeviceKey(vaultStore, DEVICE_KEY_RECORD);
  if (!key) return null;
  try {
    const record = raw as EncryptedInviteRecord;
    const plaintext = await decryptWithDeviceKey(key, record);
    if (!plaintext) return null;
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (typeof parsed?.secret !== 'string' || typeof parsed?.expiresAt !== 'number') return null;
    return { v: 1, secret: parsed.secret.trim(), expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export async function readPendingSpaceInvite(): Promise<string | null> {
  const encrypted = await readEncryptedInvite();
  if (encrypted) {
    if (encrypted.secret && encrypted.expiresAt > Date.now()) return encrypted.secret;
    await clearPendingSpaceInvite();
    return null;
  }

  let fallback: SessionFallback | null = null;
  try {
    fallback = parseFallback(sessionStorage.getItem(PENDING_SPACE_INVITE_KEY));
  } catch {
    /* no-op */
  }
  if (!fallback) {
    try {
      fallback = parseFallback(localStorage.getItem(PENDING_SPACE_INVITE_KEY));
    } catch {
      /* no-op */
    }
  }
  if (!fallback?.secret || fallback.expiresAt <= Date.now()) {
    removeWebStorageCopies();
    return null;
  }

  // Migrate legacy/plain fallback records. They are removed only after the
  // secret has at least moved into the bounded, same-tab fallback. This keeps
  // an unavailable IndexedDB from extending a legacy localStorage secret on
  // every read.
  await writePendingSpaceInvite(fallback.secret, fallback.expiresAt);
  try {
    localStorage.removeItem(PENDING_SPACE_INVITE_KEY);
  } catch {
    /* no-op */
  }
  return fallback.secret;
}

export async function clearPendingSpaceInvite(): Promise<void> {
  removeWebStorageCopies();
  await vaultStore.delete(INVITE_RECORD, DEVICE_KEY_RECORD).catch(() => undefined);
}
