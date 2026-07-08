/**
 * Shared snapshot-download bootstrap: fetch the encrypted database blob,
 * parse the version headers, and decrypt. Used by both DatabaseSync (steady
 * state) and SpaceActivationService (startup), so the header contract lives
 * in exactly one place.
 */

import { decryptAndDecompressDatabase } from '../crypto';
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

/**
 * Download and decrypt the latest server snapshot for a space.
 * Returns null when the server has no snapshot; persistence of the returned
 * versions is the caller's responsibility. Decryption errors propagate.
 */
export async function downloadSnapshot(
  deps: DownloadSnapshotDeps,
  spaceId: string,
  passphrase: string
): Promise<DownloadedSnapshot | null> {
  const blobResult = await deps.downloadBlob(spaceId);
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
