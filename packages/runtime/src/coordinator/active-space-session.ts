import type { SyncStatus } from '../sync-transport';
import type { RuntimeContext } from './runtime-context-factory';

interface ActiveSpaceSessionDeps {
  setActiveSpaceId(spaceId: string | null): void;
  setWebSocketProvider(provider: () => boolean): void;
  clearQueryClient(): void;
  clearUndo?(): void;
  onConnectionChange(connected: boolean): void;
  onSyncStatus(status: SyncStatus): void;
}

export class ActiveSpaceSession {
  private readonly deps: ActiveSpaceSessionDeps;

  private context: RuntimeContext | null = null;

  private contextListenerCleanup: (() => void)[] = [];

  constructor(deps: ActiveSpaceSessionDeps) {
    this.deps = deps;
  }

  getContext(): RuntimeContext | null {
    return this.context;
  }

  isConnected(): boolean {
    return this.context?.sync.isConnected() ?? false;
  }

  replace(context: RuntimeContext): void {
    this.clearContextListenerForwarding();
    this.contextListenerCleanup.push(
      context.sync.onConnectionChange((connected) => {
        this.deps.onConnectionChange(connected);
      })
    );
    this.contextListenerCleanup.push(
      context.sync.addSyncStatusListener((status) => {
        this.deps.onSyncStatus(status);
      })
    );

    this.context = context;
    this.deps.setActiveSpaceId(context.spaceId);
    this.deps.clearQueryClient();
    try {
      this.deps.clearUndo?.();
    } catch {
      /* no-op */
    }
    this.deps.setWebSocketProvider(() => context.sync.isConnected());
  }

  dispose(): void {
    this.clearContextListenerForwarding();
    if (!this.context) return;
    try {
      this.context.sync.destroy();
    } catch {
      /* no-op */
    }
    try {
      this.context.dbSync.destroy();
    } catch {
      /* no-op */
    }
    try {
      this.context.db.close?.();
    } catch {
      /* no-op */
    }
    this.context = null;
    this.deps.setActiveSpaceId(null);
    this.deps.clearQueryClient();
    try {
      this.deps.clearUndo?.();
    } catch {
      /* no-op */
    }
    this.deps.setWebSocketProvider(() => false);
    this.deps.onConnectionChange(false);
  }

  private clearContextListenerForwarding(): void {
    for (const cleanup of this.contextListenerCleanup) {
      try {
        cleanup();
      } catch {
        /* no-op */
      }
    }
    this.contextListenerCleanup = [];
  }
}
