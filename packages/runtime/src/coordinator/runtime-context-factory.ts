import type {
  RuntimeEncryption,
  WebDatabaseInstance,
  QueryClientLike,
  MutationExecutorDeps,
  MutationBudgetResolutionContext,
  UndoEntry,
  HistoryEntry,
} from '../types';
import type { LocalPersistenceCipher } from '../crypto';
import { errorMessage } from '../utils/diagnostics';
import { persistDatabase } from '../utils/persist-database';
import { scopedLogger, type RuntimeComponentLogFn } from '../logging';
import { MutationExecutor } from '../mutation-executor';
import { DatabaseSync, DatabaseLoader, type MigrationRunner } from '../database-sync';
import { OfflineQueue } from '../offline-queue';
import { SyncTransport, SnapshotUnavailableError } from '../sync-transport';
import { reapplyQueueAfterRestore } from './restore-invariant';

export interface RuntimeContext {
  spaceId: string;
  generation: number;
  db: WebDatabaseInstance;
  persistLocalDatabase(): Promise<boolean>;
  sync: SyncTransport;
  executor: MutationExecutor;
  dbSync: DatabaseSync;
  dbLoader: DatabaseLoader;
  offlineQueue: OfflineQueue;
  encryption: RuntimeEncryption | null;
  passphrase: string;
  hydratedFromServer: boolean;
  localPersistenceCipher: LocalPersistenceCipher;
}

export interface RuntimeContextFactoryDeps {
  getToken(): Promise<string | null>;
  executeOp(op: string, payload: Record<string, unknown>): Promise<unknown>;
  getUndoSpec(op: string): ReturnType<MutationExecutorDeps['getUndoSpec']>;
  getInvalidatesForOp(op: string): string[][] | undefined;
  getQueryClient(): QueryClientLike | undefined;
  pushUndo?(entry: UndoEntry): void;
  recordHistory?(entry: HistoryEntry): void;
  resolveHistoryBudgetId?(context: MutationBudgetResolutionContext): number | null | undefined;
  onAnalyticsEvent?(op: string): void;
  getActiveSpaceId(): string | null;
  getSpaceRole(spaceId: string): string | null;
  getPassphrase(spaceId: string): string | null;
  getEncryptionKeyVersion(spaceId: string): number;
  setEncryptionKeyVersion(spaceId: string, version: number): void;
  uploadBlob(
    spaceId: string,
    data: Uint8Array,
    version: number | undefined,
    keyVersion: number,
    mutationVersion?: number,
    outOfBand?: boolean
  ): Promise<{ version: number }>;
  downloadBlob(spaceId: string): Promise<{ data: Uint8Array; headers: Headers } | null>;
  getDatabaseState?(spaceId: string): Promise<{
    version: number;
    mutation_version?: number;
    hash?: string;
    space_id?: string;
  } | null>;
  checkApiHealth(): Promise<boolean>;
  syncTransportPolicy?: {
    getWebSocketUrl?(spaceId: string, token: string | null): string;
    subscribeNetworkStatus?(handlers: { online: () => void; offline: () => void }): () => void;
    getReconnectDelayMs?(attempt: number): number;
    onEncryptionKeyChanged?(spaceId: string, version: number): void;
    /** A sync payload arrived in a newer data format — prompt for an app update. */
    onFormatTooNew?(spaceId: string, receivedVersion: number): void;
    setPasswordChangedReason?(): void;
    reloadApp?(): void;
  };
  log?: RuntimeComponentLogFn;
}

export interface CreateOnlineContextParams {
  spaceId: string;
  generation: number;
  db: WebDatabaseInstance;
  encryption: RuntimeEncryption;
  passphrase: string;
  hydratedFromServer: boolean;
  localPersistenceCipher: LocalPersistenceCipher;
  initialBlobVersion?: number;
  onRemoteMutation(
    op: string,
    args: Record<string, unknown>,
    id: string,
    offlineQueue: OfflineQueue,
    executor: MutationExecutor
  ): Promise<void>;
  onSyncConnectionChange(connected: boolean): void;
  /**
   * Another client uploaded an out-of-band blob (import/restore) whose
   * content is NOT in the mutation log. The owner (coordinator) must
   * download it — no catch-up will ever deliver it.
   */
  onRemoteBlobVersion?(spaceId: string, version: number): void;
}

export class RuntimeContextFactory {
  private readonly deps: RuntimeContextFactoryDeps;

  private readonly migrationRunner?: MigrationRunner;

  constructor(deps: RuntimeContextFactoryDeps, migrationRunner?: MigrationRunner) {
    this.deps = deps;
    this.migrationRunner = migrationRunner;
  }

  createOnlineContext(params: CreateOnlineContextParams): RuntimeContext {
    const persistDb = this.createLocalPersistenceWriter(params.spaceId, params.db);

    const executor = this.buildExecutor((spaceId) => this.deps.getSpaceRole(spaceId));

    // dbSync is constructed before the transport/queue; these deps are
    // late-bound closures over the refs assigned below.
    let syncRef: SyncTransport | null = null;
    let offlineQueueRef: OfflineQueue | null = null;

    // Applied-id records must never outlive the DB persist that contains
    // their effects (a persisted id whose mutation the persisted DB lost is
    // skipped on replay forever) — so the flush rides on every successful
    // DB persist.
    const persistLocalDatabase = async (): Promise<boolean> => {
      const ok = await persistDb();
      if (ok) offlineQueueRef?.flushAppliedIds();
      return ok;
    };

    const dbSync = new DatabaseSync(params.spaceId, {
      getDatabase: () => params.db,
      getPassphrase: (spaceId) => this.deps.getPassphrase(spaceId),
      getEncryptionKeyVersion: (spaceId) => this.deps.getEncryptionKeyVersion(spaceId),
      setEncryptionKeyVersion: (spaceId, version) =>
        this.deps.setEncryptionKeyVersion(spaceId, version),
      uploadBlob: (spaceId, data, version, keyVersion, mutationVersion, outOfBand) =>
        this.deps.uploadBlob(spaceId, data, version, keyVersion, mutationVersion, outOfBand),
      downloadBlob: (spaceId) => this.deps.downloadBlob(spaceId),
      checkApiHealth: () => this.deps.checkApiHealth(),
      getMutationCursor: () => syncRef?.getLocalVersion() ?? 0,
      hasUnackedMutations: () => (offlineQueueRef?.peekQueueLength() ?? 0) > 0,
      // Restore invariant: after ANY snapshot restore the DB content changed
      // out from under the cursor and the dedup sets. Reseed the cursor to
      // the blob's bound log position, then reset dedup and re-apply queued
      // local mutations (see restore-invariant.ts).
      onDatabaseRestored: async (boundMutationVersion) => {
        if (boundMutationVersion !== undefined) {
          syncRef?.setLocalVersion(boundMutationVersion);
        }
        const queue = offlineQueueRef;
        if (!queue) return;
        await reapplyQueueAfterRestore({
          spaceId: params.spaceId,
          offlineQueue: queue,
          executor,
          persistLocalDatabase,
          log: (message, extra) => this.deps.log?.('warn', 'RuntimeContextFactory', message, extra),
        });
      },
    });
    if (params.initialBlobVersion !== undefined) {
      dbSync.setBlobVersion(params.initialBlobVersion);
    }

    const dbLoader = new DatabaseLoader(this.migrationRunner);
    const offlineQueue = new OfflineQueue(params.spaceId);
    offlineQueueRef = offlineQueue;

    const sync = new SyncTransport(params.spaceId, {
      getToken: () => this.deps.getToken(),
      encryptPayload: async (payload) =>
        params.encryption.encryptMutation(payload as { op: string; args: Record<string, unknown> }),
      decryptPayload: async (encrypted) => params.encryption.decryptMutation(encrypted),
      onRemoteMutation: async (op, args, id) =>
        params.onRemoteMutation(op, args, id, offlineQueue, executor),
      onMutationAck: (mutationId) => offlineQueue.ackMutation(mutationId),
      persistLocalDatabase,
      onConnectionChange: (connected) => {
        if (!connected) {
          // Bytes written to the dead socket have unknown fate: treat every
          // queued entry as never-sent so the next connection re-sends them
          // in FIFO order (server dedups by id). Without this, a lost-in-
          // flight mutation can be overtaken by a newer one and land in the
          // log out of causal order.
          offlineQueue.resetSendState();
        }
        params.onSyncConnectionChange(connected);
      },
      onSyncStateChanged: (spaceId, version, outOfBand) => {
        if (outOfBand) {
          // Out-of-band blob (YNAB import, DB restore, …): its content is
          // NOT in the mutation log, so it must be downloaded. Do NOT record
          // the version here — a version we never downloaded would let this
          // device's next snapshot upload pass the server's compare-and-swap
          // with stale content and destroy the import for everyone. The
          // version advances when the download actually lands.
          params.onRemoteBlobVersion?.(spaceId, version);
          return;
        }
        // Normal debounced upload from another device: the mutation log
        // covers its content, so just track the version for optimistic
        // concurrency on our own next upload.
        dbSync.setBlobVersion(version);
      },
      onCatchUpUnsafe: async ({ reason, sinceVersion, localVersion, spaceId }) => {
        this.deps.log?.('warn', 'RuntimeContextFactory', 'catch_up_fallback_snapshot', {
          reason,
          sinceVersion,
          localVersion,
          spaceId,
        });

        const restored = await dbSync.downloadAndRestore();
        if (!restored) {
          throw new SnapshotUnavailableError();
        }

        dbLoader.runMigrations(params.db);

        // Prefer the mutation version bound to the blob we just restored —
        // with debounced uploads the blob can lag the log, and seeding from
        // the server's *current* version would skip the tail. Legacy blobs
        // (no bound version) fall back to the server state as before.
        let mutationVersion: number | undefined = dbSync.getLastDownloadedMutationVersion();
        let blobVersion: number | undefined;
        if (this.deps.getDatabaseState) {
          const state = await this.deps.getDatabaseState(spaceId);
          if (
            typeof state?.version === 'number' &&
            Number.isFinite(state.version) &&
            state.version > 0
          ) {
            blobVersion = state.version;
            dbSync.setBlobVersion(blobVersion);
          }
          if (
            mutationVersion === undefined &&
            typeof state?.mutation_version === 'number' &&
            Number.isFinite(state.mutation_version) &&
            state.mutation_version >= 0
          ) {
            mutationVersion = state.mutation_version;
          }
        }

        const persisted = await persistLocalDatabase();
        if (!persisted) {
          throw new Error('Failed to persist local database after catch-up recovery');
        }

        return { mutationVersion, blobVersion };
      },
      ...this.transportPolicyDeps(),
    });
    syncRef = sync;

    return {
      spaceId: params.spaceId,
      generation: params.generation,
      db: params.db,
      persistLocalDatabase,
      sync,
      executor,
      dbSync,
      dbLoader,
      offlineQueue,
      encryption: params.encryption,
      passphrase: params.passphrase,
      hydratedFromServer: params.hydratedFromServer,
      localPersistenceCipher: params.localPersistenceCipher,
    };
  }

  private buildExecutor(getSpaceRole: (spaceId: string) => string | null): MutationExecutor {
    return new MutationExecutor({
      executeOp: (op, payload) => this.deps.executeOp(op, payload),
      getUndoSpec: (op) => this.deps.getUndoSpec(op),
      getInvalidatesForOp: (op) => this.deps.getInvalidatesForOp(op),
      getQueryClient: () => this.deps.getQueryClient(),
      pushUndo: (entry) => this.deps.pushUndo?.(entry),
      recordHistory: (entry) => this.deps.recordHistory?.(entry),
      resolveHistoryBudgetId: (context) => this.deps.resolveHistoryBudgetId?.(context),
      getActiveSpaceId: () => this.deps.getActiveSpaceId(),
      getSpaceRole,
      onAnalyticsEvent: (op) => this.deps.onAnalyticsEvent?.(op),
    });
  }

  private transportPolicyDeps() {
    const policy = this.deps.syncTransportPolicy;
    return {
      getWebSocketUrl: policy?.getWebSocketUrl,
      subscribeNetworkStatus: policy?.subscribeNetworkStatus,
      getReconnectDelayMs: policy?.getReconnectDelayMs,
      onEncryptionKeyChanged: policy?.onEncryptionKeyChanged,
      onFormatTooNew: policy?.onFormatTooNew,
      setPasswordChangedReason: policy?.setPasswordChangedReason,
      reloadApp: policy?.reloadApp,
      log: scopedLogger('SyncTransport', this.deps.log),
    };
  }

  private createLocalPersistenceWriter(
    spaceId: string,
    db: WebDatabaseInstance
  ): () => Promise<boolean> {
    let writeChain: Promise<boolean> = Promise.resolve(true);

    const runWrite = async (): Promise<boolean> => {
      try {
        if (await persistDatabase(db)) {
          return true;
        }
        this.deps.log?.(
          'warn',
          'RuntimeContextFactory',
          'Local persistence unavailable for active database adapter',
          { spaceId }
        );
        return false;
      } catch (error) {
        this.deps.log?.('warn', 'RuntimeContextFactory', 'Failed to persist local database', {
          spaceId,
          error: errorMessage(error),
        });
        return false;
      }
    };

    return async () => {
      writeChain = writeChain.then(runWrite, runWrite);
      return writeChain;
    };
  }
}
