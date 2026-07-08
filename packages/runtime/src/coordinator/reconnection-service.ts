import type { RuntimeState, MutationPayload, MutationSpec } from '../types';
import type { ConnectivityMonitor } from '../connectivity';
import { scopedLogger, type RuntimeLogFn } from '../logging';
import { CancellationError, errorMessage } from '../utils/diagnostics';

type OverlayPhase = 'syncing' | 'success' | 'hidden';

interface SnapshotState {
  lastSnapshotDownloadAt: number;
  hasLocalChangesSinceLastDownload: boolean;
}

interface SyncStatusPatch {
  isSyncing?: boolean;
  lastSyncTime?: Date | null;
  syncError?: string | null;
}

interface ReconnectionContext {
  spaceId: string;
  executor: {
    execute<T = unknown>(
      spec: MutationSpec
    ): Promise<{ result: T; mutationId: string; isReceiver: boolean }>;
  };
  offlineQueue: {
    hasQueued(): Promise<boolean>;
    getQueue(): Promise<MutationPayload[]>;
    getStale(thresholdMs: number): Promise<MutationPayload[]>;
    noteSent(mutationId: string): void;
  };
  sync: {
    isConnected(): boolean;
    setBufferMode(enabled: boolean): void;
    flushBuffer(): Promise<void>;
    updateSyncStatus(patch: SyncStatusPatch): void;
    send(payload: {
      id: string;
      op: string;
      args: Record<string, unknown>;
      spaceId?: string;
    }): Promise<boolean>;
  };
  dbSync: {
    upload(): Promise<void>;
  };
}

export interface ReconnectionServiceDeps {
  connectivity: ConnectivityMonitor;
  getRuntimeState(): RuntimeState;
  setRuntimeState(next: RuntimeState): void;
  getSnapshotState(): SnapshotState;
  downloadLatest(): Promise<void>;
  getActiveContext(): ReconnectionContext | null;
  emitOverlay(phase: OverlayPhase): void;
  policy?: {
    cooldownMs?: number;
    recentDownloadWindowMs?: number;
    successOverlayMs?: number;
    /** Interval between unacked-mutation resend sweeps. */
    resendSweepMs?: number;
    /** How long a sent mutation may go unacked before a sweep re-sends it. */
    resendStaleMs?: number;
  };
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  setInterval?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
  log?: RuntimeLogFn;
}

export class ReconnectionService {
  private readonly deps: ReconnectionServiceDeps;

  private readonly log: RuntimeLogFn;

  private listenerCleanup: (() => void) | null = null;

  private hiddenOverlayTimer: ReturnType<typeof setTimeout> | null = null;

  private resendSweepTimer: ReturnType<typeof setInterval> | null = null;

  private prevReconnectOnline = false;

  private reconnectionInProgress = false;

  private lastReconnectionAt = 0;

  private suppressNextOnlineTransition = false;

  constructor(deps: ReconnectionServiceDeps) {
    this.deps = deps;
    this.log = deps.log ?? scopedLogger('ReconnectionService');
  }

  start(): void {
    this.stop();

    this.resendSweepTimer = (this.deps.setInterval ?? setInterval)(() => {
      void this.resendSweep().catch((error) => {
        this.log('warn', 'Resend sweep failed', { error: errorMessage(error) });
      });
    }, this.getResendSweepMs());

    // addListener fires immediately with current state (which is overall:false
    // before the first probe completes). Skip that initial invocation so it
    // doesn't reset prevReconnectOnline and trigger a false reconnection.
    this.prevReconnectOnline = true;
    let firstCallback = true;
    this.listenerCleanup = this.deps.connectivity.addListener(async (state) => {
      if (firstCallback) {
        firstCallback = false;
        return;
      }
      const reconnectOnline = this.isReconnectOnline(state);
      const runtimeState = this.deps.getRuntimeState();
      if (runtimeState === 'SwitchingSpace') {
        // Workspace switches can briefly flap ws/api readiness. Ignore the first
        // offline->online transition that happens as part of that intentional switch.
        this.suppressNextOnlineTransition = !reconnectOnline;
        this.prevReconnectOnline = reconnectOnline;
        return;
      }
      if (!this.prevReconnectOnline && reconnectOnline) {
        if (this.suppressNextOnlineTransition) {
          this.suppressNextOnlineTransition = false;
        } else {
          await this.onBecameFullyOnline();
        }
      } else if (state.wsConnected && !state.overall) {
        try {
          const ctx = this.deps.getActiveContext();
          const hasQueued = (await ctx?.offlineQueue.hasQueued()) ?? false;
          if (hasQueued && ctx) {
            await this.replayQueueViaSync(ctx);
          }
        } catch {
          /* no-op */
        }
      }
      this.prevReconnectOnline = reconnectOnline;
    });
  }

  stop(): void {
    if (this.listenerCleanup) {
      try {
        this.listenerCleanup();
      } catch {
        /* no-op */
      }
      this.listenerCleanup = null;
    }
    this.clearHiddenOverlayTimer();
    this.clearResendSweepTimer();
    this.reconnectionInProgress = false;
    this.suppressNextOnlineTransition = false;
  }

  private async onBecameFullyOnline(): Promise<void> {
    if (this.reconnectionInProgress) return;

    const now = this.now();
    if (now - this.lastReconnectionAt < this.getCooldownMs()) return;

    const prevState = this.deps.getRuntimeState();
    if (prevState !== 'Ready' && prevState !== 'Degraded') {
      return;
    }

    this.reconnectionInProgress = true;

    try {
      this.deps.setRuntimeState('Reconnecting');

      this.deps.emitOverlay('syncing');

      const state = this.deps.connectivity.getState();
      if (!this.isReconnectOnline(state)) {
        if (prevState === 'Ready') this.deps.setRuntimeState('Degraded');
        else this.deps.setRuntimeState(prevState);
        this.deps.emitOverlay('hidden');
        return;
      }

      const snapshot = this.deps.getSnapshotState();
      const recentDownload =
        this.now() - snapshot.lastSnapshotDownloadAt < this.getRecentDownloadWindowMs();
      if (!recentDownload && !snapshot.hasLocalChangesSinceLastDownload) {
        try {
          await this.deps.downloadLatest();
        } catch (error) {
          this.log('warn', 'Download failed after becoming online', {
            error: errorMessage(error),
          });
        }
      }

      const ctx = this.deps.getActiveContext();
      if (ctx) {
        await this.replayQueueViaSync(ctx);
      }

      const endState = this.deps.getRuntimeState();
      if (endState === 'Reconnecting' || endState === 'Degraded') {
        this.deps.setRuntimeState('Ready');
      } else {
        this.log('debug', 'Skip Ready transition after reconnection due to state drift', {
          endState,
        });
      }
      this.deps.emitOverlay('success');
      this.clearHiddenOverlayTimer();
      this.hiddenOverlayTimer = this.scheduleTimeout(() => {
        this.hiddenOverlayTimer = null;
        this.deps.emitOverlay('hidden');
      }, this.getSuccessOverlayMs());
    } catch (error) {
      if (error instanceof CancellationError) return;
      this.log('warn', 'Reconnection failed', {
        error: errorMessage(error),
      });
      const stateAfterFailure = this.deps.getRuntimeState();
      if (stateAfterFailure === 'Reconnecting' || stateAfterFailure === 'Ready') {
        this.deps.setRuntimeState('Degraded');
      }
      this.deps.emitOverlay('hidden');
    } finally {
      this.lastReconnectionAt = this.now();
      this.reconnectionInProgress = false;
    }
  }

  private async replayQueueViaSync(ctx: ReconnectionContext): Promise<void> {
    const queue = await ctx.offlineQueue.getQueue();
    if (!queue.length) return;

    ctx.sync.updateSyncStatus({ isSyncing: true, syncError: null });

    let sent = 0;
    let failed = 0;

    // Entries are NOT removed here: at-least-once means a mutation leaves the
    // queue only when its mutation_ack arrives (acks buffered during replay
    // are processed by flushBuffer below). Re-sends are deduped server-side
    // on UNIQUE(space_id, id).
    //
    // SEND-ONLY, never re-apply locally: in the common reconnect case the DB
    // was NOT restored (the snapshot download is skipped whenever local
    // changes exist) and already contains every queued mutation — re-running
    // the ops here silently duplicated rows (plain autoincrement INSERTs)
    // and the corrupted DB was then uploaded as the space blob. When a
    // restore DOES erase queued effects, DatabaseSync's onDatabaseRestored
    // hook re-applies the queue with proper in-flight re-marking.
    ctx.sync.setBufferMode(true);
    try {
      for (const mutation of queue) {
        if (mutation.spaceId && mutation.spaceId !== ctx.spaceId) continue;

        try {
          const ok = await ctx.sync.send({
            id: mutation.id,
            op: mutation.op,
            args: mutation.args,
            spaceId: ctx.spaceId,
          });

          if (ok) {
            ctx.offlineQueue.noteSent(mutation.id);
            sent++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
    } finally {
      try {
        await ctx.sync.flushBuffer();
      } catch (error) {
        // flushBuffer disables buffer mode at start; force-disable on unexpected failures.
        ctx.sync.setBufferMode(false);
        this.log('warn', 'Failed to flush buffered sync messages', {
          error: errorMessage(error),
        });
      }
    }

    try {
      await ctx.dbSync.upload();
      ctx.sync.updateSyncStatus({ isSyncing: false, lastSyncTime: new Date(), syncError: null });
    } catch (error) {
      ctx.sync.updateSyncStatus({ isSyncing: false, syncError: errorMessage(error) });
    }

    this.log('debug', 'Replay finished', {
      sent,
      failed,
    });
  }

  /**
   * Periodic at-least-once sweep: re-send queued mutations whose last send
   * went unacked for longer than the stale threshold. Sends only — no local
   * re-apply (the local DB already has them) and no blob upload; the server
   * dedups repeats and its ack is what dequeues the entry.
   */
  private async resendSweep(): Promise<void> {
    if (this.reconnectionInProgress) return;

    const ctx = this.deps.getActiveContext();
    if (!ctx || !ctx.sync.isConnected()) return;

    const stale = await ctx.offlineQueue.getStale(this.getResendStaleMs());
    if (!stale.length) return;

    this.log('debug', 'Resending unacked mutations', { count: stale.length });
    for (const mutation of stale) {
      try {
        const ok = await ctx.sync.send({
          id: mutation.id,
          op: mutation.op,
          args: mutation.args,
          spaceId: ctx.spaceId,
        });
        if (ok) {
          ctx.offlineQueue.noteSent(mutation.id);
        } else {
          // Socket dropped mid-sweep; the reconnect path takes over.
          break;
        }
      } catch {
        break;
      }
    }
  }

  private clearResendSweepTimer(): void {
    if (!this.resendSweepTimer) return;
    (this.deps.clearInterval ?? clearInterval)(this.resendSweepTimer);
    this.resendSweepTimer = null;
  }

  private clearHiddenOverlayTimer(): void {
    if (!this.hiddenOverlayTimer) return;
    this.cancelTimeout(this.hiddenOverlayTimer);
    this.hiddenOverlayTimer = null;
  }

  private getCooldownMs(): number {
    return this.deps.policy?.cooldownMs ?? 8000;
  }

  private getRecentDownloadWindowMs(): number {
    return this.deps.policy?.recentDownloadWindowMs ?? 5000;
  }

  private getSuccessOverlayMs(): number {
    return this.deps.policy?.successOverlayMs ?? 1000;
  }

  private getResendSweepMs(): number {
    return this.deps.policy?.resendSweepMs ?? 20_000;
  }

  private getResendStaleMs(): number {
    return this.deps.policy?.resendStaleMs ?? 15_000;
  }

  private isReconnectOnline(state: { apiReachable: boolean; wsConnected: boolean }): boolean {
    return !!(state.apiReachable && state.wsConnected);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private scheduleTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    return (this.deps.setTimeout ?? setTimeout)(callback, ms);
  }

  private cancelTimeout(timer: ReturnType<typeof setTimeout>): void {
    (this.deps.clearTimeout ?? clearTimeout)(timer);
  }
}
