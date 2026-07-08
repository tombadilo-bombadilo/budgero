/**
 * DatabaseSync — upload and download encrypted database snapshots.
 *
 * Refactored from SnapshotStore.
 * Upload: backup → compress → encrypt → HTTP POST
 * Download: HTTP GET → decrypt → decompress → restore
 * Does NOT run migrations — caller's job (via DatabaseLoader).
 * All deps injected, no getRuntime().
 */

import { compressAndEncryptDatabase } from '../crypto';
import { BLOB_VERSION_STORAGE_PREFIX } from '../types/storage-keys';
import { errorMessage, isDecryptionError } from '../utils/diagnostics';
import { readStoredVersion, writeStoredVersion } from '../utils/stored-version';
import { logRuntime } from '../logging';
import type { DatabaseSyncDeps, WebDatabaseInstance } from '../types';
import { downloadSnapshot, type DownloadedSnapshot } from './snapshot-download';

const DEFAULT_UPLOAD_MUTATION_THRESHOLD = 20;
const DEFAULT_UPLOAD_MAX_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_UNACKED_RETRY_MS = 2_000;
const DEFAULT_FAILED_UPLOAD_RETRY_MS = 30_000;

/**
 * The API could not be reached at all — a transient condition. Distinct from
 * "the server has no snapshot" (download() returning null): recovery code
 * must NOT treat an unreachable API as proof that no blob exists, or a
 * 1-second network blip permanently disables sync for the session.
 */
export class ApiUnreachableError extends Error {
  constructor(message = 'API unreachable') {
    super(message);
    this.name = 'ApiUnreachableError';
  }
}

export class DatabaseSync {
  private readonly spaceId: string;

  private readonly deps: DatabaseSyncDeps;

  private uploadInProgress = false;

  /** Server blob version for optimistic concurrency control */
  private blobVersion: number | undefined;

  /** Mutations accumulated since the last successful upload. */
  private pendingMutations = 0;

  private uploadTimer: ReturnType<typeof setTimeout> | null = null;

  /** Mutation-log position of the most recently downloaded blob, if bound. */
  private lastDownloadedMutationVersion: number | undefined;

  private readonly onHidden = () => {
    // The tab is going to the background (or away): flush pending changes
    // while the page can still complete a request. Best-effort — the
    // mutation log carries correctness either way.
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
    this.flushPendingUpload('visibility_hidden');
  };

  constructor(spaceId: string, deps: DatabaseSyncDeps) {
    this.spaceId = spaceId;
    this.deps = deps;
    this.blobVersion = readStoredVersion(`${BLOB_VERSION_STORAGE_PREFIX}${spaceId}`);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onHidden);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this.onHidden);
    }
  }

  /** Set the blob version (e.g. from initial download in coordinator) */
  setBlobVersion(version: number): void {
    if (!Number.isFinite(version) || version <= 0) return;
    const next = Math.max(this.blobVersion ?? 0, version);
    if (next === this.blobVersion) return;
    this.blobVersion = next;
    writeStoredVersion(`${BLOB_VERSION_STORAGE_PREFIX}${this.spaceId}`, next);
  }

  getBlobVersion(): number | undefined {
    return this.blobVersion;
  }

  /**
   * Upload the current database to the server.
   * On version_conflict: downloads latest blob, restores, then retries once.
   *
   * `outOfBand` marks blobs whose content is NOT covered by the mutation log
   * (imports, restores, direct SQL). The server relays the flag to other
   * connected clients so they download the blob instead of just recording
   * its version — the log will never deliver this data to them.
   */
  async upload(options?: { outOfBand?: boolean }): Promise<void> {
    const db = this.deps.getDatabase();
    if (!db) return;

    const apiReachable = await this.deps.checkApiHealth();
    if (!apiReachable) {
      logRuntime('debug', 'DatabaseSync', 'API unreachable: skipping upload');
      return;
    }

    const passphrase = this.deps.getPassphrase(this.spaceId);
    if (!passphrase) {
      logRuntime('warn', 'DatabaseSync', 'No passphrase available for upload');
      return;
    }

    const keyVersion = this.deps.getEncryptionKeyVersion(this.spaceId);
    // Mutations that land while the upload runs are not in this blob —
    // only settle the ones captured by it.
    const pendingAtStart = this.pendingMutations;

    try {
      await this.doUpload(db, passphrase, keyVersion, options?.outOfBand);
      this.settlePending(pendingAtStart);
      return;
    } catch (error) {
      const conflict = getConflictDetails(error);
      if (!conflict.isVersionConflict) throw error;
      if (typeof conflict.serverVersion === 'number' && conflict.serverVersion > 0) {
        this.setBlobVersion(conflict.serverVersion);
      }
      if (options?.outOfBand) {
        // Out-of-band content exists ONLY in this local DB — the normal
        // conflict recovery (restore server blob, then re-upload) would
        // destroy the import. Take the server's version and re-upload as-is;
        // any log tail we're missing arrives via catch-up and is applied on
        // top afterwards.
        logRuntime(
          'warn',
          'DatabaseSync',
          'Version conflict on out-of-band upload; retrying without restore',
          {
            clientVersion: this.blobVersion,
            serverVersion: conflict.serverVersion,
          }
        );
        await this.doUpload(db, passphrase, keyVersion, true);
        this.settlePending(pendingAtStart);
        return;
      }
      logRuntime('warn', 'DatabaseSync', 'Version conflict, downloading latest and retrying', {
        clientVersion: this.blobVersion,
        serverVersion: conflict.serverVersion,
      });
    }

    // Conflict: download latest and restore. The onDatabaseRestored hook
    // reseeds the cursor to the restored blob's bound version and re-applies
    // queued local mutations, so cursor and DB content agree again.
    const restored = await this.downloadAndRestore();
    if (!restored) {
      logRuntime('warn', 'DatabaseSync', 'Could not download latest after version conflict');
      return;
    }

    // Re-applied queued mutations are in the DB but not yet versioned in the
    // log — uploading now would bind effects the log can't account for, and
    // a fresh device would double-apply them once they land. Defer until the
    // queue drains (throw → flushPendingUpload arms the retry).
    if (this.deps.hasUnackedMutations?.()) {
      throw new Error('Deferred re-upload after version conflict: unacked mutations pending');
    }

    // Cursor now matches content (hook), so the normal bind-from-cursor
    // upload is correct here too. The retry is NOT out-of-band even if the
    // original attempt was: the DB now holds the restored server blob plus
    // re-applied queued mutations, all of which the log covers.
    await this.doUpload(db, passphrase, keyVersion);
    this.settlePending(pendingAtStart);
  }

  private settlePending(uploadedCount: number): void {
    this.pendingMutations = Math.max(0, this.pendingMutations - uploadedCount);
    if (this.pendingMutations === 0) this.clearUploadTimer();
  }

  private async doUpload(
    db: WebDatabaseInstance,
    passphrase: string,
    keyVersion: number,
    outOfBand?: boolean
  ): Promise<void> {
    // Capture the cursor synchronously adjacent to backup() so the bound
    // mutation version matches the blob contents exactly.
    const mutationVersion = this.deps.getMutationCursor?.();
    const data: Uint8Array = await db.backup();
    const { encrypted, compressed } = await compressAndEncryptDatabase(data, passphrase);

    logRuntime('debug', 'DatabaseSync', 'Uploading database blob', {
      originalSize: data.length,
      compressedSize: compressed.length,
      encryptedSize: encrypted.length,
      blobVersion: this.blobVersion,
      keyVersion,
      mutationVersion,
    });

    const result = await this.deps.uploadBlob(
      this.spaceId,
      encrypted,
      this.blobVersion,
      keyVersion,
      mutationVersion,
      outOfBand
    );
    this.setBlobVersion(result.version);
    logRuntime('info', 'DatabaseSync', 'Upload succeeded', { blobVersion: this.blobVersion });
  }

  /**
   * Download the latest snapshot from the server.
   * Returns the decrypted data, or null if no snapshot available.
   */
  async download(): Promise<Uint8Array | null> {
    const apiReachable = await this.deps.checkApiHealth();
    if (!apiReachable) {
      logRuntime('debug', 'DatabaseSync', 'API unreachable: skipping download');
      // Throw, don't return null: null means "the server has no snapshot",
      // which catch-up recovery treats as terminal (sync disabled). An
      // unreachable API is transient and must stay retryable.
      throw new ApiUnreachableError();
    }

    const passphrase = this.deps.getPassphrase(this.spaceId);
    if (!passphrase) {
      throw new Error('No secret available to decrypt workspace snapshot');
    }

    let snapshot: DownloadedSnapshot | null;
    try {
      snapshot = await downloadSnapshot(this.deps, this.spaceId, passphrase);
    } catch (error) {
      logRuntime('error', 'DatabaseSync', 'Failed to decrypt snapshot', {
        error: errorMessage(error),
      });
      if (isDecryptionError(error)) {
        throw new Error('Decryption failed: invalid password or corrupted data', {
          cause: error,
        });
      }
      throw new Error('Failed to restore workspace snapshot from server', {
        cause: error,
      });
    }

    if (!snapshot) {
      logRuntime('debug', 'DatabaseSync', 'No snapshot available on server');
      return null;
    }

    if (snapshot.keyVersion !== undefined) {
      this.deps.setEncryptionKeyVersion(this.spaceId, snapshot.keyVersion);
    }

    // Track blob version for optimistic concurrency
    if (snapshot.blobVersion !== undefined) {
      this.setBlobVersion(snapshot.blobVersion);
    }

    this.lastDownloadedMutationVersion = snapshot.mutationVersion;

    return snapshot.decrypted;
  }

  /**
   * Mutation-log position bound to the most recently downloaded blob, or
   * undefined for legacy blobs. Callers seeding the mutation cursor after a
   * restore must prefer this over the server's *current* mutation version —
   * with debounced uploads the blob can lag the log.
   */
  getLastDownloadedMutationVersion(): number | undefined {
    return this.lastDownloadedMutationVersion;
  }

  /**
   * External code replaced the DB contents outside downloadAndRestore (e.g.
   * the password-change flow restoring a blob it downloaded itself): run the
   * same restore-invariant hook, with the bound mutation version of whatever
   * was restored.
   */
  async notifyDatabaseRestored(boundMutationVersion: number | undefined): Promise<void> {
    this.lastDownloadedMutationVersion = boundMutationVersion;
    await this.deps.onDatabaseRestored?.(boundMutationVersion);
  }

  /**
   * Download and restore directly into the current database.
   * This is the combined operation that SnapshotStore.downloadLatest() did.
   */
  async downloadAndRestore(): Promise<boolean> {
    const decrypted = await this.download();
    if (!decrypted) return false;

    const db = this.deps.getDatabase();
    if (!db) {
      throw new Error('No database available for restore');
    }

    await db.restore(decrypted);
    logRuntime('info', 'DatabaseSync', 'Database restored via restore()');

    // Restore invariant hook: the DB content just changed out from under
    // every piece of sync state derived from it. The wiring (context
    // factory) reseeds the mutation cursor to this blob's bound version,
    // clears the applied/in-flight dedup sets, and re-applies queued local
    // mutations. Skipping this after ANY restore silently loses the log
    // tail (cursor ahead of DB) or double-applies it (cursor behind).
    try {
      await this.deps.onDatabaseRestored?.(this.lastDownloadedMutationVersion);
    } catch (error) {
      logRuntime('warn', 'DatabaseSync', 'onDatabaseRestored hook failed', {
        error: errorMessage(error),
      });
    }
    return true;
  }

  /**
   * Record a local mutation and upload on a debounced cadence: after
   * `mutationThreshold` accumulated mutations, or `maxDelayMs` after the
   * first pending one — whichever comes first. The mutation log (at-least-
   * once) owns correctness; the blob is a bootstrap accelerator, so it may
   * lag by design. Its log position travels with it (X-Mutation-Version).
   */
  scheduleUpload(): void {
    this.pendingMutations += 1;

    if (this.pendingMutations >= this.getMutationThreshold()) {
      this.flushPendingUpload('mutation_threshold');
      return;
    }

    // Arm the max-delay timer for the first pending mutation of a batch.
    if (!this.uploadTimer) {
      this.uploadTimer = this.scheduleTimer(() => {
        this.uploadTimer = null;
        this.flushPendingUpload('max_delay');
      }, this.getMaxDelayMs());
    }
  }

  /**
   * Upload now if anything is pending. Defers briefly while mutations await
   * their server ack — the cursor must match the blob contents exactly.
   */
  flushPendingUpload(reason: string): void {
    if (this.pendingMutations === 0) return;
    if (this.uploadInProgress) return;

    if (this.deps.hasUnackedMutations?.()) {
      logRuntime('debug', 'DatabaseSync', 'Upload deferred: unacked mutations', { reason });
      this.clearUploadTimer();
      this.uploadTimer = this.scheduleTimer(() => {
        this.uploadTimer = null;
        this.flushPendingUpload(`${reason}_retry`);
      }, this.getUnackedRetryMs());
      return;
    }

    logRuntime('debug', 'DatabaseSync', 'Uploading pending changes', {
      reason,
      pendingMutations: this.pendingMutations,
    });
    this.uploadInProgress = true;
    this.upload()
      .catch((error) => {
        // The mutation log owns correctness, but a silently stale blob
        // degrades every fresh-device bootstrap — log loudly and re-arm a
        // retry instead of waiting for the next mutation to trigger one.
        logRuntime('warn', 'DatabaseSync', 'Blob upload failed; retry armed', {
          reason,
          error: errorMessage(error),
        });
        this.clearUploadTimer();
        this.uploadTimer = this.scheduleTimer(() => {
          this.uploadTimer = null;
          this.flushPendingUpload('failed_upload_retry');
        }, this.getFailedUploadRetryMs());
      })
      .finally(() => {
        this.uploadInProgress = false;
      });
  }

  destroy(): void {
    this.clearUploadTimer();
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onHidden);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', this.onHidden);
    }
  }

  // ---- Debounce internals ----

  private clearUploadTimer(): void {
    if (!this.uploadTimer) return;
    (this.deps.clearTimeout ?? clearTimeout)(this.uploadTimer);
    this.uploadTimer = null;
  }

  private scheduleTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    return (this.deps.setTimeout ?? setTimeout)(callback, ms);
  }

  private getMutationThreshold(): number {
    return this.deps.uploadPolicy?.mutationThreshold ?? DEFAULT_UPLOAD_MUTATION_THRESHOLD;
  }

  private getMaxDelayMs(): number {
    return this.deps.uploadPolicy?.maxDelayMs ?? DEFAULT_UPLOAD_MAX_DELAY_MS;
  }

  private getUnackedRetryMs(): number {
    return this.deps.uploadPolicy?.unackedRetryMs ?? DEFAULT_UNACKED_RETRY_MS;
  }

  private getFailedUploadRetryMs(): number {
    return this.deps.uploadPolicy?.failedUploadRetryMs ?? DEFAULT_FAILED_UPLOAD_RETRY_MS;
  }
}

/**
 * Extract conflict details from API errors.
 * Version conflicts are HTTP 409 with payload { error: "version_conflict", server_version }.
 */
function getConflictDetails(error: unknown): {
  isVersionConflict: boolean;
  serverVersion?: number;
} {
  if (!error || typeof error !== 'object') return { isVersionConflict: false };

  const status =
    'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;

  const responseDetails =
    'response' in error ? parseConflictPayload((error as { response?: unknown }).response) : {};
  const messageDetails =
    'message' in error ? parseConflictPayload((error as { message?: unknown }).message) : {};

  const errorCode = responseDetails.errorCode ?? messageDetails.errorCode;
  const serverVersion = responseDetails.serverVersion ?? messageDetails.serverVersion;

  if (errorCode) {
    return {
      isVersionConflict: errorCode === 'version_conflict',
      serverVersion,
    };
  }

  if (status === 409) {
    // Backward-compat fallback for callers that only provide HTTP status.
    return { isVersionConflict: true, serverVersion };
  }

  return { isVersionConflict: false, serverVersion };
}

function parseConflictPayload(payload: unknown): {
  errorCode?: string;
  serverVersion?: number;
} {
  if (typeof payload === 'string') {
    const raw = payload.trim();
    if (!raw) return {};
    try {
      return parseConflictPayload(JSON.parse(raw));
    } catch {
      if (raw.includes('version_conflict')) return { errorCode: 'version_conflict' };
      if (raw.includes('encryption_key_outdated')) return { errorCode: 'encryption_key_outdated' };
      return {};
    }
  }

  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const errorCode = typeof record.error === 'string' ? record.error : undefined;
  const serverVersion =
    typeof record.server_version === 'number' && Number.isFinite(record.server_version)
      ? record.server_version
      : undefined;

  return { errorCode, serverVersion };
}
