import type { OverlayPhase, SyncStatus } from '../sync-transport';

interface RuntimeCoordinatorEventsDeps {
  getCurrentConnection(): boolean;
}

export class RuntimeCoordinatorEvents {
  private readonly deps: RuntimeCoordinatorEventsDeps;

  private overlayListeners = new Set<(phase: OverlayPhase) => void>();

  private connectionChangeListeners = new Set<(connected: boolean) => void>();

  private syncStatusListeners = new Set<(status: SyncStatus) => void>();

  constructor(deps: RuntimeCoordinatorEventsDeps) {
    this.deps = deps;
  }

  onOverlayChange(listener: (phase: OverlayPhase) => void): () => void {
    this.overlayListeners.add(listener);
    return () => this.overlayListeners.delete(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionChangeListeners.add(listener);
    try {
      listener(this.deps.getCurrentConnection());
    } catch {
      /* no-op */
    }
    return () => this.connectionChangeListeners.delete(listener);
  }

  onSyncStatus(listener: (status: SyncStatus) => void): () => void {
    this.syncStatusListeners.add(listener);
    return () => this.syncStatusListeners.delete(listener);
  }

  emitOverlay(phase: OverlayPhase): void {
    this.overlayListeners.forEach((listener) => {
      try {
        listener(phase);
      } catch {
        /* no-op */
      }
    });
  }

  emitConnectionChange(connected: boolean): void {
    this.connectionChangeListeners.forEach((listener) => {
      try {
        listener(connected);
      } catch {
        /* no-op */
      }
    });
  }

  emitSyncStatus(status: SyncStatus): void {
    this.syncStatusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        /* no-op */
      }
    });
  }

  clear(): void {
    this.overlayListeners.clear();
    this.connectionChangeListeners.clear();
    this.syncStatusListeners.clear();
  }
}
