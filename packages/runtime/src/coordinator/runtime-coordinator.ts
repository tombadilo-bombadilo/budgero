/** Runtime coordinator orchestrating lifecycle, mutation dispatch, and accessors. */

import type {
  RuntimeState,
  MutationSpec,
  MutationResult,
  WebDatabaseInstance,
  RuntimeEncryption,
  MutationPayload,
  QueryClientLike,
} from '../types';
import { KeyVault } from '../key-vault';
import { createLocalPersistenceCipher } from '../crypto';
import { ConnectivityMonitor } from '../connectivity';
import { SpaceRegistry } from '../space-registry';
import { CancellationError, errorMessage } from '../utils/diagnostics';
import { scopedLogger, type RuntimeLogFn } from '../logging';
import { ApiUnreachableError } from '../database-sync';
import { ReconnectionService } from './reconnection-service';
import { RuntimeContextFactory, type RuntimeContext } from './runtime-context-factory';
import { SpaceActivationService } from './space-activation-service';
import { MutationDispatchService } from './mutation-dispatch-service';
import { RuntimeStateMachine } from './runtime-state-machine';
import { SpaceCatalogService } from './space-catalog-service';
import { ActiveSpaceSession } from './active-space-session';
import { RuntimeStatePolicy, type RuntimeStateIntent } from './runtime-state-policy';
import { RuntimeLifecycleService } from './runtime-lifecycle-service';
import { RuntimeCoordinatorEvents } from './runtime-coordinator-events';
import type { RuntimeCoordinatorDeps, StateChangeListener } from './runtime-coordinator-types';

export class RuntimeCoordinator {
  private abortController: AbortController | null = null;

  private readonly stateMachine = new RuntimeStateMachine('Idle');

  private readonly statePolicy = new RuntimeStatePolicy();

  private initInFlight: Promise<void> | null = null;

  readonly keyVault: KeyVault;

  readonly connectivity: ConnectivityMonitor;

  readonly spaceRegistry: SpaceRegistry;

  private readonly session: ActiveSpaceSession;

  private readonly lifecycle: RuntimeLifecycleService;

  private readonly reconnection: ReconnectionService;

  private readonly mutationDispatch: MutationDispatchService;

  private readonly deps: RuntimeCoordinatorDeps;

  private readonly log: RuntimeLogFn;

  private lastSnapshotDownloadAt = 0;

  private hasLocalChangesSinceLastDownload = false;

  /** Highest out-of-band blob version announced but not yet downloaded. */
  private pendingRemoteBlob: { spaceId: string; version: number } | null = null;

  private remoteBlobRetryTimer: ReturnType<typeof setTimeout> | null = null;

  private queryClientRef: QueryClientLike | undefined;

  private readonly events: RuntimeCoordinatorEvents;

  constructor(deps: RuntimeCoordinatorDeps) {
    this.deps = deps;
    this.log = scopedLogger('RuntimeCoordinator', deps.runtimeLog);

    this.keyVault = new KeyVault({
      uploadEncryptedKey: deps.uploadEncryptedKey,
      allowUnpersistedOwnerKey: deps.isE2E === true,
    });

    this.connectivity = new ConnectivityMonitor({
      getToken: () => deps.getToken(),
      checkApiHealth: () => deps.checkApiHealth(),
      isSelfHostable: deps.isSelfHostable,
    });

    this.spaceRegistry = new SpaceRegistry();
    const contextFactory = new RuntimeContextFactory(
      {
        getToken: () => deps.getToken(),
        executeOp: (op, payload) => deps.executeOp(op, payload),
        getUndoSpec: (op) => deps.getUndoSpec(op),
        getInvalidatesForOp: (op) => deps.getInvalidatesForOp(op),
        getQueryClient: () => this.getQueryClient(),
        pushUndo: (entry) => deps.pushUndo?.(entry),
        recordHistory: (entry) => deps.recordHistory?.(entry),
        resolveHistoryBudgetId: (context) => deps.resolveHistoryBudgetId?.(context),
        onAnalyticsEvent: (op) => deps.onAnalyticsEvent?.(op),
        getActiveSpaceId: () => this.getActiveSpaceId(),
        getSpaceRole: (spaceId) => this.spaceRegistry.getSpace(spaceId)?.role ?? null,
        getPassphrase: (spaceId) => this.keyVault.getSpacePassphrase(spaceId),
        getEncryptionKeyVersion: (spaceId) => this.keyVault.getEncryptionKeyVersion(spaceId),
        setEncryptionKeyVersion: (spaceId, version) =>
          this.keyVault.setEncryptionKeyVersion(spaceId, version),
        uploadBlob: (spaceId, data, version, keyVersion, mutationVersion, outOfBand) =>
          deps.uploadBlob(spaceId, data, version, keyVersion, mutationVersion, outOfBand),
        downloadBlob: (spaceId) => deps.downloadBlob(spaceId),
        ...(deps.getDatabaseState
          ? {
              getDatabaseState: (spaceId: string) => deps.getDatabaseState!(spaceId),
            }
          : {}),
        checkApiHealth: () => deps.checkApiHealth(),
        syncTransportPolicy: deps.syncTransportPolicy,
        log: deps.runtimeLog,
      },
      deps.migrationRunner
    );
    const activation = new SpaceActivationService({
      keyVault: this.keyVault,
      contextFactory,
      listAvailableSpaces: () => this.spaceRegistry.listSpaces(),
      createDatabase: (data, opts) => deps.createDatabase(data, opts),
      downloadBlob: (spaceId) => deps.downloadBlob(spaceId),
      hasLocalDatabase: deps.hasLocalDatabase
        ? (path: string) => deps.hasLocalDatabase!(path)
        : undefined,
      ...(deps.getDatabaseState
        ? {
            getDatabaseState: (spaceId: string) => deps.getDatabaseState!(spaceId),
          }
        : {}),
      cleanupDatabaseFile: deps.cleanupDatabaseFile,
      isE2E: deps.isE2E,
      opfsSuffix: deps.opfsSuffix,
      log: scopedLogger('SpaceActivationService', deps.runtimeLog),
    });
    const spaceCatalog = new SpaceCatalogService({
      listSpaces: deps.listSpaces,
      getProfile: deps.getProfile,
      keyVault: this.keyVault,
      spaceRegistry: this.spaceRegistry,
      cleanupStaleSpaceDatabases: deps.cleanupStaleSpaceDatabases,
      opfsSuffix: deps.opfsSuffix,
      log: scopedLogger('SpaceCatalogService', deps.runtimeLog),
    });
    this.session = new ActiveSpaceSession({
      setActiveSpaceId: (spaceId) => this.spaceRegistry.setActiveSpaceId(spaceId),
      setWebSocketProvider: (provider) => this.connectivity.setWebSocketProvider(provider),
      clearQueryClient: () => this.clearQueryClient(),
      clearUndo: () => this.deps.clearUndo?.(),
      onConnectionChange: (connected) => this.events.emitConnectionChange(connected),
      onSyncStatus: (status) => this.events.emitSyncStatus(status),
    });
    this.events = new RuntimeCoordinatorEvents({
      getCurrentConnection: () => this.session.isConnected(),
    });
    this.reconnection = new ReconnectionService({
      connectivity: this.connectivity,
      getRuntimeState: () => this.state,
      setRuntimeState: (next) => {
        this.trySetState(next);
      },
      getSnapshotState: () => ({
        lastSnapshotDownloadAt: this.lastSnapshotDownloadAt,
        hasLocalChangesSinceLastDownload: this.hasLocalChangesSinceLastDownload,
      }),
      downloadLatest: () => this.downloadLatest(),
      getActiveContext: () => this.session.getContext(),
      emitOverlay: (phase) => this.events.emitOverlay(phase),
      policy: deps.reconnectionPolicy,
      log: scopedLogger('ReconnectionService', deps.runtimeLog),
    });
    this.lifecycle = new RuntimeLifecycleService({
      keyVault: this.keyVault,
      spaceRegistry: this.spaceRegistry,
      connectivity: this.connectivity,
      spaceCatalog,
      activation,
      session: this.session,
      reconnection: this.reconnection,
      onRemoteBlobVersion: (spaceId, version) => this.handleRemoteBlobVersion(spaceId, version),
      log: scopedLogger('RuntimeLifecycleService', deps.runtimeLog),
    });
    this.mutationDispatch = new MutationDispatchService();
  }

  private get activeContext(): RuntimeContext | null {
    return this.session.getContext();
  }

  get state(): RuntimeState {
    return this.stateMachine.state;
  }

  onStateChange(listener: StateChangeListener): () => void {
    return this.stateMachine.onChange(listener);
  }

  private setState(next: RuntimeState): void {
    const prev = this.state;
    this.stateMachine.transition(next);
    if (prev !== next) {
      this.log('info', 'State transition', { prev, next });
    }
  }

  private applyIntent(intent: RuntimeStateIntent): void {
    const prev = this.state;
    const next = this.statePolicy.resolveIntent(intent, prev);
    if (prev === next) return;
    this.setState(next);
  }

  private trySetState(next: RuntimeState): boolean {
    const prev = this.state;
    if (!this.stateMachine.canTransition(next, prev)) {
      this.log('warn', 'Ignored invalid state transition', { prev, next });
      return false;
    }
    this.setState(next);
    return true;
  }

  private cancelInflight(): void {
    this.abortController?.abort();
    this.abortController = new AbortController();
  }

  private get signal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }

  // ---- Initialization ----

  async init(options?: {
    masterPassword?: string;
    skipServerDownload?: boolean;
    queryClient?: QueryClientLike;
  }): Promise<void> {
    if (this.state === 'Initializing' && this.initInFlight) {
      // Allow late callers to replace query client while initialization is in progress.
      if (options?.queryClient) {
        this.queryClientRef = options.queryClient;
      }
      await this.initInFlight;
      return;
    }

    if (this.statePolicy.shouldNoopInit(this.state)) {
      if (options?.queryClient) {
        this.queryClientRef = options.queryClient;
      }
      return;
    }

    if (this.statePolicy.shouldResetBeforeInit(this.state)) {
      this.applyIntent('init:reset');
    }

    this.cancelInflight();
    this.applyIntent('init:start');

    if (options?.queryClient) {
      this.queryClientRef = options.queryClient;
    }

    const initPromise = (async () => {
      try {
        await this.lifecycle.initialize({
          masterPassword: options?.masterPassword,
          skipServerDownload: options?.skipServerDownload,
          signal: this.signal,
          onSnapshotReset: () => {
            this.lastSnapshotDownloadAt = Date.now();
            this.hasLocalChangesSinceLastDownload = false;
          },
        });
        this.applyIntent('init:success');
      } catch (error) {
        if (error instanceof CancellationError) return;
        this.applyIntent('init:failure');
        throw error;
      }
    })();

    this.initInFlight = initPromise;
    try {
      await initPromise;
    } finally {
      if (this.initInFlight === initPromise) {
        this.initInFlight = null;
      }
    }
  }

  // ---- Space Switching ----

  async switchSpace(
    spaceId: string,
    options?: { skipServerDownload?: boolean; forceSnapshotDownload?: boolean }
  ): Promise<void> {
    if (!this.statePolicy.canSwitchSpace(this.state)) {
      throw new Error(`Cannot switch space in state: ${this.state}`);
    }
    if (!this.spaceRegistry.isSpaceAvailable(spaceId)) {
      throw new Error('Requested workspace is not available to this user');
    }
    if (this.getActiveSpaceId() === spaceId) {
      return;
    }

    this.cancelInflight();
    this.applyIntent('switch:start');

    try {
      await this.lifecycle.switchSpace({
        spaceId,
        skipServerDownload: options?.skipServerDownload,
        forceSnapshotDownload: options?.forceSnapshotDownload,
        signal: this.signal,
      });
      this.applyIntent('switch:success');
    } catch (error) {
      if (error instanceof CancellationError) return;
      this.applyIntent('switch:failure');
      throw error;
    }
  }

  // ---- Mutation Execution ----

  async executeMutation<T = unknown>(spec: MutationSpec): Promise<MutationResult<T>> {
    if (!this.statePolicy.canExecuteMutation(this.state)) {
      throw new Error(`Cannot execute mutations in state: ${this.state}`);
    }

    const ctx = this.activeContext;
    if (!ctx) throw new Error('No active workspace');

    const result = await this.mutationDispatch.executeMutation<T>(spec, ctx);
    if (result.synced || result.queued) {
      this.hasLocalChangesSinceLastDownload = true;
    }
    return result;
  }

  // ---- Accessors ----

  getDatabase(): WebDatabaseInstance | null {
    return this.activeContext?.db ?? null;
  }

  getActiveSpaceId(): string | null {
    return this.spaceRegistry.getActiveSpaceId();
  }

  getEncryption(): RuntimeEncryption | null {
    return this.activeContext?.encryption ?? null;
  }

  getQueryClient(): QueryClientLike | undefined {
    return this.queryClientRef ?? this.deps.getQueryClient?.();
  }

  exportSpaceKey(): string | null {
    const spaceId = this.getActiveSpaceId();
    if (!spaceId) return null;
    return this.keyVault.exportSpaceKey(spaceId);
  }

  getSpacePassphrase(spaceId: string): string | null {
    return this.keyVault.getSpacePassphrase(spaceId);
  }

  /** Send a mutation over WebSocket via SyncTransport */
  sendMutation(payload: {
    id: string;
    op: string;
    args: Record<string, unknown>;
    spaceId?: string;
  }): Promise<boolean> {
    return this.activeContext?.sync.send(payload) ?? Promise.resolve(false);
  }

  incrementEncryptionKeyVersion(): Promise<number> {
    if (!this.activeContext?.sync) {
      return Promise.reject(new Error('SyncTransport not initialized'));
    }
    return this.activeContext.sync.incrementEncryptionKeyVersion();
  }

  scheduleSnapshotUpload(): void {
    this.activeContext?.dbSync.scheduleUpload();
  }

  async waitForInitialSync(options?: {
    timeoutMs?: number;
  }): Promise<{ synced: boolean; timedOut: boolean; connected: boolean }> {
    const ctx = this.activeContext;
    if (!ctx) {
      return { synced: true, timedOut: false, connected: false };
    }

    const result = await ctx.sync.waitForInitialCatchUp({
      timeoutMs: options?.timeoutMs,
    });

    return {
      synced: result.completed,
      timedOut: result.timedOut,
      connected: ctx.sync.isConnected(),
    };
  }

  /**
   * Reseed in-memory sync cursor and blob version from authoritative server state.
   *
   * When the state is unavailable (missing dep, null response, absent
   * mutation_version, or a thrown error — all of which a transient server
   * hiccup can produce), the cursor is LEFT UNTOUCHED. It used to be cleared
   * to 0 here, which turned any network blip during an out-of-band finalize
   * (warranty save, CSV import, …) into a full-log replay onto a populated
   * DB — duplicating data on a perfectly healthy device.
   */
  async reseedSyncStateFromServer(): Promise<{ blobVersion?: number; mutationVersion?: number }> {
    const ctx = this.activeContext;
    const spaceId = this.getActiveSpaceId();
    if (!ctx || !spaceId) {
      return {};
    }

    if (!this.deps.getDatabaseState) {
      return {};
    }

    try {
      const state = await this.deps.getDatabaseState(spaceId);
      if (!state) {
        this.log('warn', 'Server database state unavailable; keeping local sync cursor', {
          spaceId,
        });
        return {};
      }

      let blobVersion: number | undefined;
      let mutationVersion: number | undefined;

      if (
        typeof state.version === 'number' &&
        Number.isFinite(state.version) &&
        state.version > 0
      ) {
        blobVersion = state.version;
        ctx.dbSync.setBlobVersion(blobVersion);
      }

      if (
        typeof state.mutation_version === 'number' &&
        Number.isFinite(state.mutation_version) &&
        state.mutation_version >= 0
      ) {
        mutationVersion = state.mutation_version;
        ctx.sync.setLocalVersion(mutationVersion);
      }

      return { blobVersion, mutationVersion };
    } catch (error) {
      this.log('warn', 'Failed to reseed sync state from server; keeping local sync cursor', {
        spaceId,
        error: errorMessage(error),
      });
      return {};
    }
  }

  addToSyncQueue(mutation: MutationPayload): void {
    void this.activeContext?.offlineQueue.add(mutation).catch((error) => {
      this.log('warn', 'Failed to enqueue mutation', {
        id: mutation.id,
        error: errorMessage(error),
      });
    });
  }

  async hasQueuedMutations(): Promise<boolean> {
    return (await this.activeContext?.offlineQueue.hasQueued()) ?? false;
  }

  /** Synchronous check — returns false if queue not loaded yet. */
  hasQueuedMutationsNow(): boolean {
    return this.activeContext?.offlineQueue.hasQueuedNow() ?? false;
  }

  async getQueueLength(): Promise<number> {
    return (await this.activeContext?.offlineQueue.getLength()) ?? 0;
  }

  /** Synchronous length — returns 0 if queue not loaded yet. */
  peekQueueLength(): number {
    return this.activeContext?.offlineQueue.peekQueueLength() ?? 0;
  }

  async save(options?: { outOfBand?: boolean }): Promise<void> {
    await this.activeContext?.dbSync.upload(options);
    this.hasLocalChangesSinceLastDownload = false;
  }

  /**
   * Another client uploaded an out-of-band blob (YNAB import, DB restore,
   * direct SQL). That content exists ONLY in the blob — it never enters the
   * mutation log, so no catch-up will deliver it. Download it now.
   * downloadLatest() runs the restore invariant (cursor reseed + queued-
   * mutation re-apply) and invalidates every query, so this is safe while
   * the user is mid-session.
   */
  private handleRemoteBlobVersion(spaceId: string, version: number): void {
    if (spaceId !== this.getActiveSpaceId()) return;
    const ctx = this.activeContext;
    if (!ctx) return;
    if (version <= (ctx.dbSync.getBlobVersion() ?? 0)) return;

    if (!this.pendingRemoteBlob || this.pendingRemoteBlob.version < version) {
      this.pendingRemoteBlob = { spaceId, version };
    }
    void this.drainPendingRemoteBlob();
  }

  private async drainPendingRemoteBlob(): Promise<void> {
    if (this.remoteBlobRetryTimer) return; // a retry is already armed
    const pending = this.pendingRemoteBlob;
    if (!pending) return;
    if (pending.spaceId !== this.getActiveSpaceId()) {
      this.pendingRemoteBlob = null;
      return;
    }
    if (!this.statePolicy.isInitialized(this.state)) {
      // Mid-switch/init: the (re)activation downloads a fresh snapshot anyway.
      this.pendingRemoteBlob = null;
      return;
    }

    try {
      await this.downloadLatest();
    } catch (error) {
      this.log('warn', 'Out-of-band blob download failed; retry armed', {
        spaceId: pending.spaceId,
        version: pending.version,
        error: errorMessage(error),
      });
    }

    const current = this.activeContext?.dbSync.getBlobVersion() ?? 0;
    if (!this.pendingRemoteBlob || current >= this.pendingRemoteBlob.version) {
      this.pendingRemoteBlob = null;
      return;
    }

    // downloadLatest was rate-limited or failed — retry after its window.
    this.remoteBlobRetryTimer = setTimeout(() => {
      this.remoteBlobRetryTimer = null;
      void this.drainPendingRemoteBlob();
    }, 5500);
  }

  async downloadLatest(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSnapshotDownloadAt < 5000) {
      this.log('debug', 'Skipped download because a recent download already ran');
      return;
    }
    let restored: boolean | undefined;
    try {
      restored = await this.activeContext?.dbSync.downloadAndRestore();
    } catch (error) {
      if (error instanceof ApiUnreachableError) {
        this.log('debug', 'Skipped download: API unreachable');
        return;
      }
      throw error;
    }
    if (restored) {
      const db = this.activeContext?.db;
      if (db) {
        this.activeContext?.dbLoader.runMigrations(db);
      }
      const qc = this.getQueryClient();
      if (qc?.invalidateQueries) {
        await qc.invalidateQueries();
      }
      this.hasLocalChangesSinceLastDownload = false;
    }
    this.lastSnapshotDownloadAt = Date.now();
  }

  async requireSpaceKey(spaceId: string): Promise<Uint8Array> {
    const mp = await this.keyVault.resolveMasterPassword();
    return this.keyVault.ensureSpaceKey(spaceId, mp, this.spaceRegistry.listSpaces());
  }

  /** Current mutation-log cursor of the active space (undefined when none). */
  getSyncCursor(): number | undefined {
    return this.activeContext?.sync.getLocalVersion();
  }

  /** Whether this mutation id was already applied locally (durable dedup). */
  isMutationApplied(mutationId: string): boolean {
    return this.activeContext?.offlineQueue.isApplied(mutationId) ?? false;
  }

  /**
   * The active DB was replaced out-of-band (e.g. password-change restore).
   * Runs the restore invariant: cursor reseed to the restored content's
   * bound log position, dedup reset, queued-mutation re-apply.
   */
  async notifyOutOfBandRestore(boundMutationVersion?: number): Promise<void> {
    await this.activeContext?.dbSync.notifyDatabaseRestored(boundMutationVersion);
  }

  /**
   * Master password changed on THIS device: re-encrypt the local OPFS
   * persistence under the new password-derived cipher so the next startup
   * can decrypt it (instead of falling back to a server snapshot), and keep
   * future in-session activations on the new cipher. Returns whether the
   * re-persist succeeded.
   */
  async rekeyLocalPersistence(masterPassword: string): Promise<boolean> {
    const ctx = this.activeContext;
    if (!ctx) return false;
    const cipher = createLocalPersistenceCipher(masterPassword);
    ctx.db.updateLocalPersistenceCipher?.(cipher);
    this.lifecycle.updateLocalPersistenceCipher(cipher);
    return await ctx.persistLocalDatabase();
  }

  /** Tell this user's OTHER devices the master password changed (via WS). */
  notifyMasterPasswordChanged(): void {
    this.activeContext?.sync.notifyMasterPasswordChanged();
  }

  async refreshSpaces(): Promise<void> {
    try {
      await this.lifecycle.refreshSpaces(async (fallbackSpaceId) => {
        await this.switchSpace(fallbackSpaceId);
      });
    } catch (error) {
      this.log('warn', 'Failed to refresh spaces', {
        error: errorMessage(error),
      });
    }
  }

  // ---- Overlay & Listeners ----
  // These are coordinator-level: listeners survive context switches and
  // can be registered before init (when activeContext is still null).

  onOverlayChange(listener: (phase: 'syncing' | 'success' | 'hidden') => void): () => void {
    return this.events.onOverlayChange(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    return this.events.onConnectionChange(listener);
  }

  onSyncStatus(listener: (status: import('../sync-transport').SyncStatus) => void): () => void {
    return this.events.onSyncStatus(listener);
  }

  // ---- Destroy ----

  destroy(): void {
    this.cancelInflight();

    if (this.remoteBlobRetryTimer) {
      clearTimeout(this.remoteBlobRetryTimer);
      this.remoteBlobRetryTimer = null;
    }
    this.pendingRemoteBlob = null;

    this.lifecycle.teardown();

    this.keyVault.clear();
    this.spaceRegistry.setActiveSpaceId(null);
    this.spaceRegistry.setAvailableSpaces([]);
    this.queryClientRef = undefined;
    this.events.clear();

    this.applyIntent('destroy');
  }

  isInitialized(): boolean {
    return this.statePolicy.isInitialized(this.state);
  }

  private clearQueryClient(): void {
    const qc = this.getQueryClient();
    if (!qc) return;
    try {
      qc.cancelQueries?.();
    } catch {
      /* no-op */
    }
    try {
      qc.removeQueries?.();
    } catch {
      /* no-op */
    }
    try {
      qc.clear?.();
    } catch {
      /* no-op */
    }
  }
}
