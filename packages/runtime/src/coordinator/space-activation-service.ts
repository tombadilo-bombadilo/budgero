import type { WebDatabaseInstance, SpaceSummary } from '../types';
import { MutationEncryption, type LocalPersistenceCipher } from '../crypto';
import { errorMessage, isDecryptionError, checkAbort } from '../utils/diagnostics';
import { readStoredVersion, writeStoredVersion, clearStoredVersion } from '../utils/stored-version';
import { scopedLogger, type RuntimeLogFn } from '../logging';
import { BLOB_VERSION_STORAGE_PREFIX, MUTATION_CURSOR_STORAGE_PREFIX } from '../types/storage-keys';
import { KeyVault } from '../key-vault';
import { downloadSnapshot } from '../database-sync';
import { RuntimeContextFactory, RuntimeContext } from './runtime-context-factory';
import { reapplyQueueAfterRestore } from './restore-invariant';
import { OfflineQueue } from '../offline-queue';
import { MutationExecutor } from '../mutation-executor';

interface ActivateSpaceParams {
  spaceId: string;
  generation: number;
  masterPassword: string;
  signal: AbortSignal;
  localPersistenceCipher: LocalPersistenceCipher;
  skipServerDownload?: boolean;
  forceServerDownload?: boolean;
  onRemoteMutation(
    op: string,
    args: Record<string, unknown>,
    id: string,
    offlineQueue: OfflineQueue,
    executor: MutationExecutor
  ): Promise<void>;
  onSyncConnectionChange(connected: boolean): void;
  onRemoteBlobVersion?(spaceId: string, version: number): void;
}

interface SpaceActivationServiceDeps {
  keyVault: KeyVault;
  contextFactory: RuntimeContextFactory;
  listAvailableSpaces(): SpaceSummary[];
  createDatabase(
    data?: Uint8Array,
    opts?: {
      forceServerData?: boolean;
      localPersistence?: LocalPersistenceCipher;
      path?: string;
    }
  ): Promise<WebDatabaseInstance>;
  downloadBlob(spaceId: string): Promise<{ data: Uint8Array; headers: Headers } | null>;
  hasLocalDatabase?(path: string): Promise<boolean>;
  getDatabaseState?(spaceId: string): Promise<{
    version: number;
    mutation_version?: number;
    hash?: string;
    space_id?: string;
  } | null>;
  cleanupDatabaseFile?(path: string): Promise<void>;
  isE2E?: boolean;
  opfsSuffix?: string;
  log?: RuntimeLogFn;
}

// Replaying ops through catch-up is cheap (they're local SQL statements);
// a full blob download+restore is not. With debounced blob uploads a device
// is routinely more than a few mutations behind, so prefer local replay for
// anything but very large gaps.
const MAX_MUTATION_GAP_FOR_LOCAL_REPLAY = 200;

export class SpaceActivationService {
  private readonly deps: SpaceActivationServiceDeps;

  private readonly log: RuntimeLogFn;

  constructor(deps: SpaceActivationServiceDeps) {
    this.deps = deps;
    this.log = deps.log ?? scopedLogger('SpaceActivationService');
  }

  async activateSpace(params: ActivateSpaceParams): Promise<RuntimeContext> {
    const spaceKey = await this.deps.keyVault.ensureSpaceKey(
      params.spaceId,
      params.masterPassword,
      this.deps.listAvailableSpaces()
    );
    checkAbort(params.signal);

    const passphrase = this.deps.keyVault.getSpacePassphrase(params.spaceId);
    if (!passphrase) {
      throw new Error('Workspace encryption key unavailable');
    }

    const dbPath = `space_${params.spaceId}${this.deps.opfsSuffix ?? '_sas'}.db`;
    const shouldCheckServer =
      !this.deps.isE2E && (!!params.forceServerDownload || !params.skipServerDownload);

    const localBlobVersion = readStoredVersion(`${BLOB_VERSION_STORAGE_PREFIX}${params.spaceId}`);
    const localMutationCursor = readStoredVersion(
      `${MUTATION_CURSOR_STORAGE_PREFIX}${params.spaceId}`
    );
    const hasLocalSnapshotForPath = await this.tryHasLocalDatabase(dbPath);

    let dbInstance: WebDatabaseInstance | undefined;
    let hydratedFromServer = false;
    let initialBlobVersion: number | undefined;

    if (shouldCheckServer) {
      const serverState = await this.tryGetServerState(params.spaceId);
      checkAbort(params.signal);
      const serverBlobVersion = serverState?.blobVersion;
      const serverMutationVersion = serverState?.mutationVersion;

      const hasAuthoritativeMutationVersion =
        typeof serverMutationVersion === 'number' &&
        Number.isFinite(serverMutationVersion) &&
        serverMutationVersion >= 0;
      const hasLocalMutationCursor =
        typeof localMutationCursor === 'number' &&
        Number.isFinite(localMutationCursor) &&
        localMutationCursor > 0;
      const mutationGap =
        hasAuthoritativeMutationVersion && hasLocalMutationCursor
          ? serverMutationVersion - localMutationCursor
          : undefined;

      const shouldUseAuthoritativeMutationCatchUp =
        hasAuthoritativeMutationVersion &&
        hasLocalMutationCursor &&
        typeof mutationGap === 'number' &&
        mutationGap >= 0 &&
        mutationGap <= MAX_MUTATION_GAP_FOR_LOCAL_REPLAY;
      const shouldUseLegacyBlobFallback =
        !hasAuthoritativeMutationVersion &&
        hasLocalMutationCursor &&
        typeof localBlobVersion === 'number' &&
        typeof serverBlobVersion === 'number' &&
        serverBlobVersion >= localBlobVersion &&
        serverBlobVersion - localBlobVersion <= MAX_MUTATION_GAP_FOR_LOCAL_REPLAY;
      const shouldUseServerCatchUpFromLocalSnapshot =
        hasLocalSnapshotForPath &&
        (shouldUseAuthoritativeMutationCatchUp || shouldUseLegacyBlobFallback);

      if (shouldUseServerCatchUpFromLocalSnapshot) {
        try {
          dbInstance = await this.createLocalDatabase(params.localPersistenceCipher, dbPath, {
            resetOnDecryptError: false,
            resetOnCreateError: false,
            spaceId: params.spaceId,
          });
          initialBlobVersion = localBlobVersion;
          this.log('info', 'Using local OPFS database with server catch-up startup', {
            spaceId: params.spaceId,
            strategy: shouldUseAuthoritativeMutationCatchUp ? 'mutation_gap' : 'legacy_blob_gap',
            localBlobVersion,
            serverBlobVersion,
            localMutationCursor,
            serverMutationVersion,
            mutationGap,
            maxMutationGap: MAX_MUTATION_GAP_FOR_LOCAL_REPLAY,
          });
        } catch (error) {
          this.log('warn', 'Local replay startup unavailable; falling back to full snapshot', {
            spaceId: params.spaceId,
            error: errorMessage(error),
          });
        }
      } else if (!hasLocalMutationCursor) {
        this.log(
          'info',
          'Local startup catch-up disabled because mutation cursor is unavailable; forcing snapshot download',
          {
            spaceId: params.spaceId,
            serverMutationVersion,
            localMutationCursor,
            serverProvidesMutationVersion: hasAuthoritativeMutationVersion,
          }
        );
      } else if (!hasLocalSnapshotForPath) {
        this.log(
          'info',
          'Local startup catch-up disabled because local OPFS snapshot is missing; forcing snapshot download',
          {
            spaceId: params.spaceId,
            dbPath,
            localBlobVersion,
            localMutationCursor,
            serverBlobVersion,
            serverMutationVersion,
          }
        );
      } else if (
        hasAuthoritativeMutationVersion &&
        hasLocalMutationCursor &&
        typeof mutationGap === 'number'
      ) {
        this.log('info', 'Local startup catch-up disabled due to unsafe mutation gap', {
          spaceId: params.spaceId,
          localMutationCursor,
          serverMutationVersion,
          mutationGap,
          maxMutationGap: MAX_MUTATION_GAP_FOR_LOCAL_REPLAY,
        });
      }

      if (!dbInstance) {
        try {
          const snapshot = await downloadSnapshot(this.deps, params.spaceId, passphrase);
          checkAbort(params.signal);

          if (snapshot) {
            if (snapshot.keyVersion !== undefined) {
              this.deps.keyVault.setEncryptionKeyVersion(params.spaceId, snapshot.keyVersion);
            }

            // Blob-version persistence is owned by DatabaseSync: initialBlobVersion
            // flows into the context factory, which seeds dbSync.setBlobVersion.
            if (snapshot.blobVersion !== undefined) {
              initialBlobVersion = snapshot.blobVersion;
            } else if (typeof serverBlobVersion === 'number' && serverBlobVersion > 0) {
              initialBlobVersion = serverBlobVersion;
            }

            dbInstance = await this.deps.createDatabase(snapshot.decrypted, {
              forceServerData: true,
              localPersistence: params.localPersistenceCipher,
              path: dbPath,
            });
            hydratedFromServer = true;
            // Fresh snapshot downloads should not replay the full mutation log
            // from version 0. Seed the cursor from the version BOUND TO THE
            // BLOB we just restored (uploads are debounced, so the blob can
            // lag the log — catch-up then replays exactly the tail). Legacy
            // blobs carry no bound version; fall back to the server's current
            // cursor, matching the old upload-per-mutation behavior.
            this.setPersistedMutationCursor(
              params.spaceId,
              snapshot.mutationVersion ?? serverMutationVersion ?? 0
            );
          } else {
            // Server has no blob. On a genuinely fresh device (no local
            // OPFS snapshot) the DB starts empty, so catch-up must replay
            // from 0 — clear any stale persisted cursor left over from a
            // prior membership of the same space, or the log prefix would
            // be silently skipped. When a local snapshot exists, the local
            // cursor matches it and stays.
            if (!hasLocalSnapshotForPath) {
              this.setPersistedMutationCursor(params.spaceId, 0);
            }
            dbInstance = await this.createLocalDatabase(params.localPersistenceCipher, dbPath, {
              spaceId: params.spaceId,
            });
          }
        } catch (error) {
          checkAbort(params.signal);
          if (isDecryptionError(error)) {
            throw new Error('Decryption failed: invalid password or corrupted data', {
              cause: error,
            });
          }
          this.log('warn', 'Snapshot download failed; falling back to local', {
            error: errorMessage(error),
          });
          dbInstance = await this.createLocalDatabase(params.localPersistenceCipher, dbPath, {
            spaceId: params.spaceId,
          });
        }
      }
    } else {
      dbInstance = await this.createLocalDatabase(params.localPersistenceCipher, dbPath, {
        spaceId: params.spaceId,
      });
    }

    if (!dbInstance) {
      throw new Error('Failed to initialize database for workspace activation');
    }

    checkAbort(params.signal);

    const encryption = await MutationEncryption.fromSpaceKey(spaceKey);
    const context = this.deps.contextFactory.createOnlineContext({
      spaceId: params.spaceId,
      generation: params.generation,
      db: dbInstance,
      encryption,
      passphrase,
      hydratedFromServer,
      localPersistenceCipher: params.localPersistenceCipher,
      initialBlobVersion,
      onRemoteMutation: async (op, args, id, offlineQueue, executor) =>
        params.onRemoteMutation(op, args, id, offlineQueue, executor),
      onSyncConnectionChange: (connected) => params.onSyncConnectionChange(connected),
      onRemoteBlobVersion: (spaceId, version) => params.onRemoteBlobVersion?.(spaceId, version),
    });

    try {
      context.dbLoader.runMigrations(dbInstance);
    } catch (error) {
      this.log('warn', 'Initial migrations failed', {
        error: errorMessage(error),
      });
    }

    if (hydratedFromServer) {
      // The DB was just replaced by a server snapshot: stale dedup records
      // and queued-but-not-yet-acked local mutations refer to the previous
      // DB. Same invariant as DatabaseSync's onDatabaseRestored — reset
      // dedup and re-apply the queue so its effects exist in the restored
      // DB before sync connects.
      try {
        await reapplyQueueAfterRestore({
          spaceId: params.spaceId,
          offlineQueue: context.offlineQueue,
          executor: context.executor,
          persistLocalDatabase: context.persistLocalDatabase,
          log: (message, extra) => this.log('warn', message, extra),
        });
      } catch (error) {
        this.log('warn', 'Queue re-apply after snapshot bootstrap failed', {
          error: errorMessage(error),
        });
      }
    }

    try {
      await context.sync.connect();
    } catch {
      /* no-op */
    }

    return context;
  }

  private async createLocalDatabase(
    localPersistenceCipher: LocalPersistenceCipher,
    dbPath: string,
    options: { resetOnDecryptError?: boolean; resetOnCreateError?: boolean; spaceId?: string } = {}
  ): Promise<WebDatabaseInstance> {
    const resetOnDecryptError = options.resetOnDecryptError ?? true;
    const resetOnCreateError = options.resetOnCreateError ?? true;

    try {
      return await this.deps.createDatabase(undefined, {
        localPersistence: localPersistenceCipher,
        path: dbPath,
      });
    } catch (error) {
      if (isDecryptionError(error)) {
        if (!resetOnDecryptError) {
          throw new Error('Decryption failed: invalid password or corrupted data', {
            cause: error instanceof Error ? error : undefined,
          });
        }
        this.log('warn', 'Local DB decrypt failed; attempting reset', {
          error: errorMessage(error),
        });
        try {
          await this.deps.cleanupDatabaseFile?.(dbPath);
          this.clearPersistedVersions(options.spaceId);
          return await this.deps.createDatabase(undefined, {
            localPersistence: localPersistenceCipher,
            path: dbPath,
          });
        } catch (cleanupError) {
          this.log('warn', 'Local reset failed', {
            error: errorMessage(cleanupError),
          });
          throw new Error('Decryption failed: invalid password or corrupted data', {
            cause: error,
          });
        }
      }

      if (!resetOnCreateError) {
        throw error instanceof Error ? error : new Error(String(error));
      }

      await this.deps.cleanupDatabaseFile?.(dbPath);
      this.clearPersistedVersions(options.spaceId);
      return await this.deps.createDatabase(undefined, {
        localPersistence: localPersistenceCipher,
        path: dbPath,
      });
    }
  }

  private async tryHasLocalDatabase(path: string): Promise<boolean> {
    if (!this.deps.hasLocalDatabase) return true;
    try {
      return await this.deps.hasLocalDatabase(path);
    } catch (error) {
      this.log('warn', 'Failed to check local OPFS snapshot presence', {
        path,
        error: errorMessage(error),
      });
      return false;
    }
  }

  private async tryGetServerState(
    spaceId: string
  ): Promise<{ blobVersion?: number; mutationVersion?: number } | undefined> {
    if (!this.deps.getDatabaseState) return undefined;
    try {
      const state = await this.deps.getDatabaseState(spaceId);
      if (!state) return undefined;

      const blobVersion =
        typeof state.version === 'number' && Number.isFinite(state.version) && state.version >= 0
          ? state.version
          : undefined;
      const mutationVersion =
        typeof state.mutation_version === 'number' &&
        Number.isFinite(state.mutation_version) &&
        state.mutation_version >= 0
          ? state.mutation_version
          : undefined;

      if (blobVersion === undefined && mutationVersion === undefined) {
        return undefined;
      }
      return { blobVersion, mutationVersion };
    } catch (error) {
      this.log('debug', 'Failed to fetch lightweight server sync state', {
        spaceId,
        error: errorMessage(error),
      });
      return undefined;
    }
  }

  private setPersistedMutationCursor(spaceId: string, version: number): void {
    if (!Number.isFinite(version) || version < 0) return;
    if (version === 0) {
      clearStoredVersion(`${MUTATION_CURSOR_STORAGE_PREFIX}${spaceId}`);
      return;
    }
    writeStoredVersion(`${MUTATION_CURSOR_STORAGE_PREFIX}${spaceId}`, version);
  }

  private clearPersistedVersions(spaceId: string | undefined): void {
    if (!spaceId) return;
    clearStoredVersion(`${BLOB_VERSION_STORAGE_PREFIX}${spaceId}`);
    clearStoredVersion(`${MUTATION_CURSOR_STORAGE_PREFIX}${spaceId}`);
  }
}
