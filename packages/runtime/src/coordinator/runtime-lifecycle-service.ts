import { createLocalPersistenceCipher, type LocalPersistenceCipher } from '../crypto';
import { checkAbort } from '../utils/diagnostics';
import { scopedLogger, type RuntimeLogFn } from '../logging';
import type { KeyVault } from '../key-vault';
import type { SpaceRegistry } from '../space-registry';
import type { ConnectivityMonitor } from '../connectivity';
import type { MutationExecutor } from '../mutation-executor';
import { SpaceActivationService } from './space-activation-service';
import type { SpaceCatalogService } from './space-catalog-service';
import type { ActiveSpaceSession } from './active-space-session';

interface RuntimeLifecycleServiceDeps {
  keyVault: KeyVault;
  spaceRegistry: SpaceRegistry;
  connectivity: ConnectivityMonitor;
  spaceCatalog: SpaceCatalogService;
  activation: SpaceActivationService;
  session: ActiveSpaceSession;
  reconnection: {
    start(): void;
    stop(): void;
  };
  /** Out-of-band blob announced for the active space — owner must download. */
  onRemoteBlobVersion?(spaceId: string, version: number): void;
  log?: RuntimeLogFn;
}

interface InitParams {
  masterPassword?: string;
  skipServerDownload?: boolean;
  signal: AbortSignal;
  onSnapshotReset(): void;
}

interface SwitchParams {
  spaceId: string;
  skipServerDownload?: boolean;
  forceSnapshotDownload?: boolean;
  signal: AbortSignal;
}

export class RuntimeLifecycleService {
  private readonly deps: RuntimeLifecycleServiceDeps;

  private readonly log: RuntimeLogFn;

  private generation = 0;

  private localPersistenceCipher: LocalPersistenceCipher | null = null;

  constructor(deps: RuntimeLifecycleServiceDeps) {
    this.deps = deps;
    this.log = deps.log ?? scopedLogger('RuntimeLifecycleService');
  }

  async initialize(params: InitParams): Promise<void> {
    let { masterPassword } = params;
    if (!masterPassword) {
      masterPassword = (await this.deps.keyVault.get()) || undefined;
    }
    if (!masterPassword) throw new Error('Master password required for initialization');

    await this.deps.keyVault.store(masterPassword);
    this.localPersistenceCipher = createLocalPersistenceCipher(masterPassword);

    checkAbort(params.signal);

    const initialSpaceId = await this.deps.spaceCatalog.prepareInitialSpace(
      masterPassword,
      params.signal
    );

    checkAbort(params.signal);

    await this.activateSpace(initialSpaceId, masterPassword, {
      skipServerDownload: params.skipServerDownload,
      forceServerDownload: true,
      signal: params.signal,
    });

    params.onSnapshotReset();

    try {
      this.deps.connectivity.start();
    } catch {
      /* no-op */
    }
    this.deps.reconnection.start();
  }

  async switchSpace(params: SwitchParams): Promise<void> {
    const masterPassword = await this.deps.keyVault.resolveMasterPassword();
    if (!this.localPersistenceCipher) {
      this.localPersistenceCipher = createLocalPersistenceCipher(masterPassword);
    }

    await this.activateSpace(params.spaceId, masterPassword, {
      skipServerDownload: params.skipServerDownload,
      forceServerDownload: params.forceSnapshotDownload,
      signal: params.signal,
    });
  }

  async refreshSpaces(onFallbackSwitch: (spaceId: string) => Promise<void>): Promise<void> {
    const refreshed = await this.deps.spaceCatalog.refreshSpaces();
    const mp = this.deps.keyVault.getMasterPassword();
    if (!refreshed.activeStillAvailable && refreshed.activeSpaceId) {
      this.deps.session.dispose();
    }
    if (refreshed.fallbackSpaceId && mp) {
      await onFallbackSwitch(refreshed.fallbackSpaceId);
    }
  }

  /**
   * Swap the local-persistence cipher (master password changed). Future
   * activations in this session encrypt OPFS payloads under the new key.
   */
  updateLocalPersistenceCipher(cipher: LocalPersistenceCipher): void {
    this.localPersistenceCipher = cipher;
  }

  teardown(): void {
    this.deps.reconnection.stop();
    this.deps.session.dispose();
    try {
      this.deps.connectivity.stop();
    } catch {
      /* no-op */
    }
    this.localPersistenceCipher = null;
  }

  private async activateSpace(
    spaceId: string,
    masterPassword: string,
    options: {
      skipServerDownload?: boolean;
      forceServerDownload?: boolean;
      signal: AbortSignal;
    }
  ): Promise<void> {
    const activeContext = this.deps.session.getContext();
    if (activeContext && activeContext.spaceId !== spaceId) {
      this.deps.session.dispose();
    }

    const gen = ++this.generation;
    const cipher = this.localPersistenceCipher || createLocalPersistenceCipher(masterPassword);
    this.localPersistenceCipher = cipher;

    const context = await this.deps.activation.activateSpace({
      spaceId,
      generation: gen,
      masterPassword,
      signal: options.signal,
      localPersistenceCipher: cipher,
      skipServerDownload: options.skipServerDownload,
      forceServerDownload: options.forceServerDownload,
      onRemoteMutation: async (op, args, id, offlineQueue, executor) => {
        if (gen !== this.generation) return;
        if (offlineQueue.isApplied(id) || offlineQueue.isInFlight(id)) {
          this.log('debug', 'Skipping duplicate remote mutation', { id });
          // Receiving our own mutation back (broadcast/catch-up) proves the
          // server has it — treat it as an implicit ack and dequeue it.
          await offlineQueue.ackMutation(id);
          return;
        }
        offlineQueue.addInFlight(id);
        try {
          await this.applyRemoteMutation(op, args, id, spaceId, executor);
          offlineQueue.markApplied(id);
        } finally {
          offlineQueue.removeInFlight(id);
        }
      },
      onSyncConnectionChange: () => {
        if (gen !== this.generation) return;
        this.deps.connectivity.refresh();
      },
      onRemoteBlobVersion: (blobSpaceId, version) => {
        if (gen !== this.generation) return;
        this.deps.onRemoteBlobVersion?.(blobSpaceId, version);
      },
    });

    try {
      checkAbort(options.signal);
    } catch (error) {
      try {
        context.sync.destroy();
      } catch {
        /* no-op */
      }
      try {
        context.dbSync.destroy();
      } catch {
        /* no-op */
      }
      try {
        context.db.close?.();
      } catch {
        /* no-op */
      }
      throw error;
    }

    this.deps.session.replace(context);
  }

  private async applyRemoteMutation(
    op: string,
    args: Record<string, unknown>,
    id: string,
    spaceId: string,
    executor: MutationExecutor
  ): Promise<void> {
    await executor.execute({
      op,
      payload: args,
      mutationId: id,
      spaceId,
    });
  }
}
