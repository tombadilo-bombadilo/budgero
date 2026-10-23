/**
 * Shared snapshot-download bootstrap: fetch the encrypted database blob,
 * parse the version headers, and decrypt. Used by both DatabaseSync (steady
 * state) and SpaceActivationService (startup), so the header contract lives
 * in exactly one place.
 */

import { decryptAndDecompressDatabase } from '../crypto';
import { getSubtleCrypto } from '../crypto/subtle';
import { logRuntime } from '../logging';

export interface SnapshotVersions {
  blobVersion?: number;
  keyVersion?: number;
  /**
   * Mutation-log position the blob contents correspond to (the uploader's
   * cursor at upload time). Seeding the local cursor from this and replaying
   * the log tail is what makes debounced blob uploads safe. Absent on legacy
   * blobs — callers fall back to the server's current mutation version.
   */
  mutationVersion?: number;
}

export interface DownloadSnapshotDeps {
  downloadBlob(spaceId: string): Promise<{ data: Uint8Array; headers: Headers } | null>;
}

export interface DownloadedSnapshot extends SnapshotVersions {
  decrypted: Uint8Array;
}

function parsePositiveIntHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = parseInt(raw, 10);
  return !isNaN(value) && value > 0 ? value : undefined;
}

/** Parse the snapshot version headers from a blob-download response. */
export function readSnapshotVersions(headers: Headers): SnapshotVersions {
  return {
    blobVersion: parsePositiveIntHeader(headers.get('X-Database-Version')),
    keyVersion: parsePositiveIntHeader(headers.get('X-Encryption-Key-Version')),
    mutationVersion: parsePositiveIntHeader(headers.get('X-Mutation-Version')),
  };
}

/** Re-downloads allowed when the blob bytes don't match X-Database-Hash. */
const HASH_MISMATCH_RETRIES = 2;

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await getSubtleCrypto().digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch the blob, re-fetching while its bytes don't match the server's
 * X-Database-Hash. The version headers (notably X-Mutation-Version, which
 * seeds the mutation cursor) are only trustworthy for the bytes they were
 * recorded with; trusting them on a mismatched blob would skip mutations.
 * Responses without the header (legacy servers) are accepted as-is.
 */
async function downloadVerifiedBlob(
  deps: DownloadSnapshotDeps,
  spaceId: string
): Promise<{ data: Uint8Array; headers: Headers } | null> {
  for (let attempt = 0; ; attempt++) {
    const blobResult = await deps.downloadBlob(spaceId);
    if (!blobResult) return null;

    const expected = blobResult.headers.get('X-Database-Hash')?.trim().toLowerCase();
    if (!expected) return blobResult;

    const actual = await sha256Hex(blobResult.data);
    if (actual === expected) return blobResult;

    logRuntime('warn', 'SnapshotDownload', 'Snapshot blob does not match X-Database-Hash', {
      spaceId,
      attempt,
      size: blobResult.data.length,
      blobVersion: blobResult.headers.get('X-Database-Version'),
    });
    if (attempt >= HASH_MISMATCH_RETRIES) {
      throw new Error('Snapshot integrity check failed: blob does not match X-Database-Hash');
    }
  }
}

/**
 * Download and decrypt the latest server snapshot for a space.
 * Returns null when the server has no snapshot; persistence of the returned
 * versions is the caller's responsibility. Decryption errors propagate, as
 * does an integrity error when the blob keeps failing its hash check.
 */
export async function downloadSnapshot(
  deps: DownloadSnapshotDeps,
  spaceId: string,
  passphrase: string
): Promise<DownloadedSnapshot | null> {
  const blobResult = await downloadVerifiedBlob(deps, spaceId);
  if (!blobResult) return null;

  const { blobVersion, keyVersion, mutationVersion } = readSnapshotVersions(blobResult.headers);
  logRuntime('debug', 'SnapshotDownload', 'Downloaded snapshot blob', {
    spaceId,
    size: blobResult.data.length,
    blobVersion,
    keyVersion,
    mutationVersion,
  });

  const { decrypted } = await decryptAndDecompressDatabase(blobResult.data, passphrase);
  return { decrypted, blobVersion, keyVersion, mutationVersion };
}
