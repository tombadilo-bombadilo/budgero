/**
 * SyncTransport — WebSocket transport for real-time sync.
 *
 * Extracted from SyncEngine — WebSocket parts only.
 * Connect, send, receive, reconnect with exponential backoff.
 * Does NOT know about mutations, encryption, or queuing — uses callbacks.
 *
 * Accepts AbortSignal for cancellation.
 * Has bufferMode for reconnection ordering guarantees.
 */

import { getClientSessionId } from '../utils/client-session';
import type { SyncTransportDeps, WsMessage, WsCatchUpMutation } from '../types';
import {
  type FormatTooNewError,
  isUpdateRequiredError,
  mutationFormatVersion,
  normalizeMutationPayload,
  SYNC_PROTOCOL_VERSION,
  UnknownOpCodeError,
} from '../sync-format.js';
import { MUTATION_CURSOR_STORAGE_PREFIX, PASSWORD_CHANGED_REASON_KEY } from '../types/storage-keys';
import { errorMessage } from '../utils/diagnostics';
import { readStoredVersion, writeStoredVersion, clearStoredVersion } from '../utils/stored-version';
import { scopedLogger, type RuntimeLogFn } from '../logging';

/**
 * Thrown by catch-up recovery when the server has neither a usable mutation
 * log nor a snapshot/blob to restore from. The space cannot be synced in this
 * state, so the transport stops reconnecting instead of looping.
 */
export class SnapshotUnavailableError extends Error {
  constructor(message = 'No snapshot available for catch-up recovery') {
    super(message);
    this.name = 'SnapshotUnavailableError';
  }
}

export type ConnectionListener = (connected: boolean) => void;
export type OverlayPhase = 'syncing' | 'success' | 'hidden';
export type OverlayListener = (phase: OverlayPhase) => void;
export type SyncStatusListener = (status: SyncStatus) => void;

/** Why sync stopped or skipped something. `code` is what gets reported; `message` is for the UI. */
export type SyncErrorCode =
  | 'session_expired'
  | 'session_rejected'
  | 'update_required'
  | 'mutation_quarantined'
  | 'snapshot_unavailable'
  | 'snapshot_upload_failed'
  | 'mutation_rejected';

export interface SyncError {
  code: SyncErrorCode;
  message: string;
  /** Fixed-list refinement (e.g. 'format_too_new', '5xx', a server nack code). */
  detail?: string;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: SyncError | null;
}

/** Shown when sync stops because there is no usable sign-in session. */
export const SYNC_SESSION_EXPIRED_MESSAGE =
  'Sync is paused because your session expired. Sign in again to resume syncing.';

/** Shown when the server keeps refusing the sync handshake while its API is up. */
export const SYNC_SESSION_REJECTED_MESSAGE =
  'Sync is paused because the server did not accept this session. Sign in again to resume syncing.';

export const SYNC_SESSION_EXPIRED: SyncError = {
  code: 'session_expired',
  message: SYNC_SESSION_EXPIRED_MESSAGE,
};

export const SYNC_SESSION_REJECTED: SyncError = {
  code: 'session_rejected',
  message: SYNC_SESSION_REJECTED_MESSAGE,
};

/** Server nack codes we pass through as `detail`; anything else becomes 'other'. */
const NACK_CODES = new Set(['invalid', 'format_too_new', 'storage_error', 'internal']);

/** Consecutive auth failures before the app is told the session is gone. */
const AUTH_FAILURES_BEFORE_SURFACING = 3;

const AUTH_RETRY_BASE_MS = 2_000;

const AUTH_RETRY_MAX_MS = 5 * 60_000;

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export class SyncTransport {
  private readonly spaceId: string;

  private readonly deps: SyncTransportDeps;

  private readonly log: RuntimeLogFn;

  private readonly cursorStorageKey: string;

  private ws: WebSocket | null = null;

  private destroyed = false;

  private suspended = false;

  /** Invalidates connection attempts that are still waiting for a token. */
  private connectionGeneration = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectAttempts = 0;

  /**
   * Consecutive attempts that failed for auth reasons: no token to send, or
   * a handshake refused while the API itself is reachable. Drives a slower
   * backoff than network failures and surfaces the expired session.
   */
  private authFailures = 0;

  /** Which syncError (if any) this transport set for an auth problem. */
  private authErrorShown: SyncError | null = null;

  /** A reconnect was wanted while the page was hidden; run it on visible. */
  private reconnectDeferredWhileHidden = false;

  private handleVisibilityListener: (() => void) | null = null;

  private localVersion = 0;

  /** Highest cursor written to storage by a deferred (debounced) persist. */
  private durableVersion = 0;

  /** Bumped when the cursor is replaced; stale deferred writes are dropped. */
  private cursorEpoch = 0;

  private connectionListeners = new Set<ConnectionListener>();

  private overlayListeners = new Set<OverlayListener>();

  private syncListeners = new Set<SyncStatusListener>();

  private syncStatus: SyncStatus = { isSyncing: false, lastSyncTime: null, syncError: null };

  private handleOfflineListener: (() => void) | null = null;

  private handleOnlineListener: (() => void) | null = null;

  private networkUnsubscribe: (() => void) | null = null;

  /** When true, incoming WS messages are buffered instead of applied. */
  private bufferMode = false;

  private messageBuffer: WsMessage[] = [];

  private catchUpMutationBuffer: WsMessage[] = [];

  private catchUpInProgress = false;

  private catchUpRequestedSince: number | null = null;

  private catchUpPages = 0;

  private catchUpRecoveryInProgress = false;

  /**
   * A snapshot cannot repair a deterministic domain-apply failure. Remember
   * the failed log entry across the one allowed snapshot restore so the next
   * replay can quarantine it instead of reconnecting forever.
   */
  private catchUpApplyFailures = new Map<string, { version: number; precedingVersion: number }>();

  /**
   * Set when catch-up recovery fails terminally (no snapshot to restore).
   * Blocks connect/reconnect for the rest of this transport's lifetime —
   * retrying would replay the same doomed catch-up forever.
   */
  private syncDisabled = false;

  /**
   * Set when a synced mutation needs a newer app (newer format or unknown op
   * code). Nothing past it is applied and the cursor stays just before it,
   * so the stored cursor is the durable "pending" marker: after the update
   * (a reload builds a new transport) catch-up resumes there and applies it.
   */
  private updateRequired: { mutationId: string; version?: number } | null = null;

  private initialCatchUpSettled = false;

  private initialCatchUpWaiters = new Set<
    (result: { completed: boolean; timedOut: boolean }) => void
  >();

  private keyVersionCallbacks: {
    resolve: (version: number) => void;
    reject: (error: Error) => void;
  }[] = [];

  constructor(spaceId: string, deps: SyncTransportDeps) {
    this.spaceId = spaceId;
    this.deps = deps;
    this.log = deps.log ?? scopedLogger('SyncTransport');
    this.cursorStorageKey = `${MUTATION_CURSOR_STORAGE_PREFIX}${spaceId}`;
    this.localVersion = readStoredVersion(this.cursorStorageKey, 0);
    this.durableVersion = this.localVersion;

    const handleOffline = () => {
      if (this.destroyed || this.suspended) return;
      try {
        this.ws?.close();
      } catch {
        /* no-op */
      }
      this.ws = null;
      this.notifyConnection(false);
    };
    const handleOnline = () => {
      this.scheduleReconnect();
    };

    if (this.deps.subscribeNetworkStatus) {
      this.networkUnsubscribe = this.deps.subscribeNetworkStatus({
        online: handleOnline,
        offline: handleOffline,
      });
    } else if (typeof window !== 'undefined') {
      this.handleOfflineListener = handleOffline;
      this.handleOnlineListener = handleOnline;
      window.addEventListener('offline', this.handleOfflineListener);
      window.addEventListener('online', this.handleOnlineListener);
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.handleVisibilityListener = () => {
        if (document.visibilityState !== 'visible') return;
        this.resumeAfterHidden();
      };
      document.addEventListener('visibilitychange', this.handleVisibilityListener);
    }
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  getLocalVersion(): number {
    return this.localVersion;
  }

  setLocalVersion(version: number): void {
    this.replaceLocalVersion(version);
  }

  /** Pull the log from the current cursor (e.g. after a snapshot restore moved it back). */
  requestCatchUp(): boolean {
    if (!this.isConnected()) return false;
    if (!this.catchUpInProgress) this.requestCatchUpIfNeeded(this.ws, this.localVersion);
    return true;
  }

  isCatchUpInProgress(): boolean {
    return this.catchUpInProgress;
  }

  hasInitialCatchUpSettled(): boolean {
    return this.initialCatchUpSettled;
  }

  async waitForInitialCatchUp(options?: {
    timeoutMs?: number;
  }): Promise<{ completed: boolean; timedOut: boolean }> {
    if (this.initialCatchUpSettled) {
      return { completed: true, timedOut: false };
    }
    if (this.syncDisabled) {
      return { completed: false, timedOut: false };
    }

    const timeoutMs =
      typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
        ? Math.max(0, options.timeoutMs)
        : 15_000;

    return await new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const waiter = (result: { completed: boolean; timedOut: boolean }) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.initialCatchUpWaiters.delete(waiter);
        resolve(result);
      };

      this.initialCatchUpWaiters.add(waiter);

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          waiter({ completed: false, timedOut: true });
        }, timeoutMs);
      }
    });
  }

  // ---- Buffer Mode ----

  setBufferMode(enabled: boolean): void {
    this.bufferMode = enabled;
  }

  /**
   * Flush buffered messages, applying them via deps.onRemoteMutation.
   */
  async flushBuffer(): Promise<void> {
    this.bufferMode = false;
    const buffer = [...this.messageBuffer];
    this.messageBuffer = [];

    for (const msg of buffer) {
      try {
        await this.processMessage(msg);
      } catch {
        /* message processing errors logged internally */
      }
    }
  }

  // ---- Connection ----

  async connect(): Promise<void> {
    if (this.destroyed || this.syncDisabled) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.suspended = false;
    const generation = ++this.connectionGeneration;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    let token: string | null = null;
    try {
      token = await this.deps.getToken();
    } catch {
      token = null;
    }
    if (
      this.destroyed ||
      this.suspended ||
      this.syncDisabled ||
      generation !== this.connectionGeneration
    ) {
      return;
    }
    if (typeof token !== 'string' || token.length === 0) {
      // No session token (e.g. the auth session expired in a background
      // tab). The server would refuse the handshake, so don't open one:
      // wait for a fresh token with backoff, or for visible/online/auth
      // changes to retry sooner.
      this.noteAuthFailure(SYNC_SESSION_EXPIRED, 'no auth token');
      this.scheduleReconnect();
      return;
    }
    const url =
      this.deps.getWebSocketUrl?.(this.spaceId, token) ?? this.createDefaultWebSocketUrl(token);

    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      const isCurrentConnection = () =>
        !this.destroyed &&
        !this.suspended &&
        !this.syncDisabled &&
        generation === this.connectionGeneration &&
        this.ws === ws;

      let opened = false;
      ws.onopen = () => {
        if (!isCurrentConnection()) return;
        opened = true;
        this.reconnectAttempts = 0;
        this.clearAuthFailures();
        this.notifyConnection(true);
        this.catchUpPages = 0;
        this.catchUpMutationBuffer = [];
        this.requestCatchUpIfNeeded(ws, this.localVersion);
      };
      ws.onclose = () => {
        if (!isCurrentConnection()) return;
        this.ws = null;
        this.catchUpInProgress = false;
        this.catchUpRequestedSince = null;
        this.catchUpMutationBuffer = [];
        this.notifyConnection(false);
        if (opened || !this.deps.checkApiHealth) {
          this.scheduleReconnect();
          return;
        }
        // Closed before it ever opened: the handshake failed. Browsers
        // hide the HTTP status, so ask the API whether it is up — if it is,
        // the server refused us (expired/invalid session) and hammering it
        // won't help.
        this.handleHandshakeFailure(generation).catch(() => {
          this.scheduleReconnect();
        });
      };
      ws.onerror = () => {
        /* onclose will handle reconnect */
      };
      ws.onmessage = (ev) => {
        if (!isCurrentConnection()) return;
        this.handleRawMessage(ev.data).catch(() => {
          /* message handling errors logged internally */
        });
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  /** Serializes send() calls so wire order always matches call order. */
  private sendChain: Promise<unknown> = Promise.resolve();

  /**
   * Send a mutation payload over WebSocket.
   *
   * Calls are chained: the async encryption step would otherwise let a
   * later-called send() reach `ws.send` first (e.g. a dispatch racing the
   * resend sweep), putting mutations into the server log — whose order is
   * arrival order — out of causal order.
   */
  async send(payload: {
    id: string;
    op: string;
    args: Record<string, unknown>;
    spaceId?: string;
  }): Promise<boolean> {
    const run = () => this.sendNow(payload);
    const result = this.sendChain.then(run, run);
    this.sendChain = result.catch(() => undefined);
    return result;
  }

  private async sendNow(payload: {
    id: string;
    op: string;
    args: Record<string, unknown>;
    spaceId?: string;
  }): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    try {
      const targetSpaceId = payload.spaceId || this.spaceId;
      const encryptedPayload = await this.deps.encryptPayload({
        // Lowest format that can express this op: older builds keep applying
        // ops they know, and stop with "update required" on ones they don't.
        v: mutationFormatVersion(payload.op, payload.args),
        op: payload.op,
        args: payload.args,
      });
      if (this.destroyed) return false;
      const message = {
        type: 'mutation',
        id: payload.id,
        baseVersion: this.localVersion,
        timestamp: new Date(),
        spaceId: targetSpaceId,
        encryptedPayload,
      };

      this.log('debug', 'Sending mutation', message as Record<string, unknown>);
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (e) {
      if (this.destroyed) return false;
      this.log('error', 'Failed to send mutation', {
        error: errorMessage(e),
        originalError: e,
        spaceId: this.spaceId,
      });

      // Treat send failure as disconnect
      try {
        this.ws?.close();
      } catch {
        /* no-op */
      }
      this.ws = null;
      this.notifyConnection(false);
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * Increment the encryption key version via WebSocket.
   */
  async incrementEncryptionKeyVersion(): Promise<number> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      const callback = { resolve, reject };
      try {
        const { ws } = this;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket not connected');
        }
        const message = {
          type: 'increment_encryption_key_version',
          spaceId: this.spaceId,
        };
        this.log(
          'debug',
          'Sending increment_encryption_key_version',
          message as Record<string, unknown>
        );
        this.keyVersionCallbacks.push(callback);
        ws.send(JSON.stringify(message));
      } catch (e) {
        this.keyVersionCallbacks = this.keyVersionCallbacks.filter((cb) => cb !== callback);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // ---- Listeners ----

  onConnectionChange(listener: ConnectionListener): () => void {
    const wrapped: ConnectionListener = (c) => listener(!!c);
    this.connectionListeners.add(wrapped);
    try {
      wrapped(this.isConnected());
    } catch {
      /* no-op */
    }
    return () => this.connectionListeners.delete(wrapped);
  }

  addOverlayListener(listener: OverlayListener): () => void {
    this.overlayListeners.add(listener);
    return () => this.overlayListeners.delete(listener);
  }

  addSyncStatusListener(listener: SyncStatusListener): () => void {
    this.syncListeners.add(listener);
    try {
      listener(this.syncStatus);
    } catch {
      /* no-op */
    }
    return () => this.syncListeners.delete(listener);
  }

  emitOverlay(phase: OverlayPhase): void {
    this.overlayListeners.forEach((l) => {
      try {
        l(phase);
      } catch {
        /* no-op */
      }
    });
  }

  updateSyncStatus(partial: Partial<SyncStatus>): void {
    this.syncStatus = { ...this.syncStatus, ...partial };
    this.syncListeners.forEach((l) => {
      try {
        l(this.syncStatus);
      } catch {
        /* no-op */
      }
    });
  }

  // ---- Lifecycle ----

  suspend(): void {
    this.suspended = true;
    this.connectionGeneration++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.reconnectDeferredWhileHidden = false;
    this.catchUpInProgress = false;
    this.catchUpRequestedSince = null;
    this.catchUpPages = 0;
    this.catchUpMutationBuffer = [];
    const { ws } = this;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
    }
    try {
      ws?.close();
    } catch {
      /* no-op */
    }
    this.notifyConnection(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.suspend();
    this.messageBuffer = [];
    this.catchUpMutationBuffer = [];
    this.bufferMode = false;
    this.catchUpRecoveryInProgress = false;
    this.resolveInitialCatchUpWaiters({ completed: false, timedOut: false });

    for (const cb of this.keyVersionCallbacks) {
      cb.reject(new Error('SyncTransport destroyed'));
    }
    this.keyVersionCallbacks = [];

    if (this.networkUnsubscribe) {
      try {
        this.networkUnsubscribe();
      } catch {
        /* no-op */
      }
      this.networkUnsubscribe = null;
    }

    if (typeof window !== 'undefined') {
      if (this.handleOfflineListener) {
        window.removeEventListener('offline', this.handleOfflineListener);
        this.handleOfflineListener = null;
      }
      if (this.handleOnlineListener) {
        window.removeEventListener('online', this.handleOnlineListener);
        this.handleOnlineListener = null;
      }
    }

    if (this.handleVisibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityListener);
      this.handleVisibilityListener = null;
    }
  }

  /**
   * Retry right away if the transport is waiting to reconnect — e.g. the
   * app just obtained a fresh auth token. No-op while connected/connecting,
   * suspended or destroyed.
   */
  retryNow(): void {
    if (this.destroyed || this.suspended || this.syncDisabled) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (isPageHidden()) {
      this.reconnectDeferredWhileHidden = true;
      return;
    }
    this.reconnectDeferredWhileHidden = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect().catch(() => {
      /* reconnect errors trigger retry */
    });
  }

  // ---- Internals ----

  private resumeAfterHidden(): void {
    if (!this.reconnectDeferredWhileHidden && !this.reconnectTimer) return;
    // Back in the foreground: try now (with a fresh token) rather than
    // waiting out a backoff that grew while nobody was looking.
    this.retryNow();
  }

  private noteAuthFailure(error: SyncError, reason: string): void {
    this.authFailures += 1;
    if (this.authFailures === 1 || this.authFailures === AUTH_FAILURES_BEFORE_SURFACING) {
      this.log('warn', 'Sync connection waiting for a valid session', {
        reason,
        attempts: this.authFailures,
        spaceId: this.spaceId,
      });
    }
    // Only tell someone who can see it; a hidden tab finds out on return.
    if (
      this.authFailures >= AUTH_FAILURES_BEFORE_SURFACING &&
      this.authErrorShown?.code !== error.code &&
      !isPageHidden()
    ) {
      this.authErrorShown = error;
      this.updateSyncStatus({ isSyncing: false, syncError: error });
    }
  }

  private clearAuthFailures(): void {
    this.authFailures = 0;
    if (this.authErrorShown) {
      if (this.syncStatus.syncError?.code === this.authErrorShown.code) {
        this.updateSyncStatus({ syncError: null });
      }
      this.authErrorShown = null;
    }
  }

  private async handleHandshakeFailure(generation: number): Promise<void> {
    let rejectedWhileApiUp = false;
    try {
      rejectedWhileApiUp = (await this.deps.checkApiHealth?.()) === true;
    } catch {
      rejectedWhileApiUp = false;
    }
    if (
      this.destroyed ||
      this.suspended ||
      this.syncDisabled ||
      generation !== this.connectionGeneration ||
      this.ws
    ) {
      return;
    }
    if (rejectedWhileApiUp) {
      this.noteAuthFailure(SYNC_SESSION_REJECTED, 'handshake rejected');
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.suspended || this.syncDisabled) return;
    if (this.reconnectTimer) return;
    if (isPageHidden()) {
      // Nobody is looking: don't keep dialing the server from a background
      // tab. The visibilitychange handler reconnects when the page returns.
      this.reconnectDeferredWhileHidden = true;
      return;
    }
    this.reconnectDeferredWhileHidden = false;
    this.reconnectAttempts++;
    let delay: number;
    if (this.authFailures > 0) {
      delay = Math.min(AUTH_RETRY_BASE_MS * 2 ** (this.authFailures - 1), AUTH_RETRY_MAX_MS);
    } else {
      const defaultDelay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10000);
      const configured = this.deps.getReconnectDelayMs?.(this.reconnectAttempts);
      delay =
        typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
          ? configured
          : defaultDelay;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (isPageHidden()) {
        this.reconnectDeferredWhileHidden = true;
        return;
      }
      this.connect().catch(() => {
        /* reconnect errors trigger retry */
      });
    }, delay);
  }

  private notifyConnection(connected: boolean): void {
    this.connectionListeners.forEach((l) => {
      try {
        l(connected);
      } catch {
        /* no-op */
      }
    });
    this.deps.onConnectionChange(connected);
  }

  private async handleRawMessage(raw: string): Promise<void> {
    try {
      const msg = JSON.parse(raw) as WsMessage;
      this.log('debug', 'Received WS message', {
        type: msg.type,
        spaceId: msg.spaceId,
        mutationId: msg.mutationId,
      });

      if (msg.spaceId && msg.spaceId !== this.spaceId) {
        return;
      }

      if (
        this.bufferMode &&
        (msg.type === 'mutation_applied' ||
          msg.type === 'catch_up_response' ||
          msg.type === 'mutation_ack')
      ) {
        // Acks are buffered too: an own-mutation ack overtaking a buffered
        // catch-up page would advance (and persist) the cursor past
        // mutations the DB doesn't hold yet — a crash in that window loses
        // them permanently. Buffered acks are processed in arrival order by
        // flushBuffer, after the page that precedes them.
        this.messageBuffer.push(msg);
        return;
      }

      // During catch-up replay we buffer live mutation_applied messages and flush afterwards.
      if (this.catchUpInProgress && msg.type === 'mutation_applied') {
        this.catchUpMutationBuffer.push(msg);
        return;
      }

      await this.processMessage(msg);
    } catch {
      /* no-op */
    }
  }

  private async processMessage(msg: WsMessage): Promise<void> {
    if (this.destroyed) return;
    if (msg.type === 'mutation_ack') {
      // The server's WritePump serializes the acked mutation ID as
      // `mutationId` (its internal hub Message carries it in `hash` — accept
      // both). The ack is what releases a mutation from the at-least-once
      // queue; missing it means the queue never drains, blob uploads defer
      // forever, and applied-ID dedup never records our own mutations.
      const ackedId = msg.mutationId ?? msg.hash;
      if (ackedId) {
        try {
          await this.deps.onMutationAck?.(ackedId, msg.version ?? 0);
        } catch (error) {
          if (this.destroyed) return;
          this.log('warn', 'onMutationAck handler failed', {
            mutationId: ackedId,
            error: errorMessage(error),
            originalError: error,
          });
        }
      }
      if (this.destroyed) return;
      if (typeof msg.version === 'number' && Number.isFinite(msg.version)) {
        if (msg.version > this.localVersion + 1) {
          // Our mutation landed at a version beyond the next contiguous one:
          // broadcasts in between were missed (e.g. dropped server-side).
          // Advancing would skip them forever — leave the cursor and pull
          // the gap via catch-up instead. The acked mutation itself comes
          // back in that replay and dedups as our own.
          this.log('warn', 'mutation_ack version gap — requesting catch-up', {
            ackVersion: msg.version,
            localVersion: this.localVersion,
            spaceId: this.spaceId,
          });
          if (!this.catchUpInProgress) {
            this.requestCatchUpIfNeeded(this.ws, this.localVersion);
          }
        } else {
          await this.updateLocalVersion(msg.version);
        }
      }
    } else if (msg.type === 'sync_state_changed') {
      if (typeof msg.version === 'number') {
        // Blob version is tracked by DatabaseSync, not mutation localVersion.
        // Keep mutation version untouched, but propagate latest blob state.
        // out_of_band marks blobs written by bulk imports/restores whose
        // content is NOT in the mutation log — the handler must download
        // them, not just record the version.
        try {
          this.deps.onSyncStateChanged?.(
            msg.spaceId || this.spaceId,
            msg.version,
            msg.out_of_band === true
          );
        } catch {
          /* no-op */
        }
      }
    } else if (msg.type === 'mutation_applied') {
      await this.handleMutationApplied(msg);
    } else if (msg.type === 'catch_up_response') {
      await this.handleCatchUp(msg);
    } else if (msg.type === 'encryption_key_changed') {
      this.handleEncryptionKeyChanged(msg);
    } else if (msg.type === 'master_password_changed') {
      this.handleMasterPasswordChanged();
    } else if (msg.type === 'encryption_key_version_ack') {
      this.handleKeyVersionAck(msg);
    } else if (msg.type === 'mutation_nack') {
      this.handleMutationNack(msg);
    }
    // ignore other control messages
  }

  /**
   * The server refused a mutation (`mutation_nack`). Without this frame the
   * client could only guess from a missing ack. The change stays in the local
   * queue (at-least-once); the status tells the app, and the app reports the
   * code. Server codes: invalid | format_too_new | storage_error | internal.
   */
  private handleMutationNack(msg: WsMessage): void {
    const mutationId = msg.id ?? msg.mutationId ?? '';
    const code = typeof msg.code === 'string' && NACK_CODES.has(msg.code) ? msg.code : 'other';
    this.log('warn', 'Server rejected a mutation', { mutationId, code, spaceId: this.spaceId });
    this.updateSyncStatus({
      isSyncing: false,
      syncError: {
        code: 'mutation_rejected',
        message: 'The server could not accept one of your changes. It is kept on this device.',
        detail: code,
      },
    });
  }

  /**
   * Tell the server the account's master password changed so it can notify
   * this USER's other devices (and only them — space members keep their own
   * passwords). Fire-and-forget; offline devices reconcile on next unlock.
   */
  notifyMasterPasswordChanged(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: 'master_password_changed', spaceId: this.spaceId }));
    } catch {
      /* no-op — best-effort notification */
    }
  }

  /**
   * Another device of THIS user changed the master password: the locally
   * stored password and the OPFS persistence cipher are stale. Flag the
   * reason and reload so startup re-prompts.
   */
  private handleMasterPasswordChanged(): void {
    this.log('warn', 'Master password changed on another device', { spaceId: this.spaceId });

    if (this.deps.setPasswordChangedReason) {
      this.deps.setPasswordChangedReason();
    } else {
      try {
        localStorage.setItem(PASSWORD_CHANGED_REASON_KEY, 'true');
      } catch {
        /* no-op */
      }
    }

    if (this.deps.reloadApp) {
      this.deps.reloadApp();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  private async handleMutationApplied(msg: WsMessage): Promise<void> {
    const id = msg.mutationId;
    if (!id) return;
    // Halted before an earlier mutation this build can't apply: applying a
    // later one would reorder the log.
    if (this.updateRequired) return;

    if (typeof msg.version === 'number' && Number.isFinite(msg.version)) {
      // Already at or behind our cursor: the effect is in the DB (or was
      // covered by a catch-up page). Applying again would duplicate rows.
      if (msg.version <= this.localVersion) return;
      // Beyond the next contiguous version: a broadcast in between was
      // missed (the server drops broadcasts when its channel is full, with
      // no redelivery). Applying THIS one and advancing would skip the
      // missed mutation forever — and the next blob upload would bake the
      // omission in. Pull the gap via ordered catch-up instead.
      if (msg.version > this.localVersion + 1) {
        this.log('warn', 'mutation_applied version gap — requesting catch-up', {
          version: msg.version,
          localVersion: this.localVersion,
          spaceId: this.spaceId,
        });
        if (!this.catchUpInProgress) {
          this.requestCatchUpIfNeeded(this.ws, this.localVersion);
        }
        return;
      }
    }

    // The broadcast payload is a best-effort re-query on the server and can
    // arrive empty. Never advance the cursor past a mutation we could not
    // decode — pull it from the log via catch-up instead.
    const { payload } = msg;
    if (!payload || (!payload.encryptedPayload && !payload.op)) {
      this.log('warn', 'mutation_applied without payload — requesting catch-up', {
        mutationId: id,
        version: msg.version,
        spaceId: this.spaceId,
      });
      this.requestCatchUpIfNeeded(this.ws, this.localVersion);
      return;
    }

    // Our own mutation echoed back — skip
    // (The coordinator handles dedup via OfflineQueue.isApplied/isInFlight)

    try {
      const { op, args } = await this.decodeMutationPayload(payload);
      if (this.destroyed) return;

      this.log('debug', 'Applying remote mutation', {
        op,
        mutationId: id,
        spaceId: this.spaceId,
      });

      await this.deps.onRemoteMutation(op, args, id);
      if (this.destroyed) return;
      if (typeof msg.version === 'number' && Number.isFinite(msg.version)) {
        await this.updateLocalVersion(msg.version);
      } else {
        await this.persistLocalMutationOnly('mutation_applied_no_version');
      }
    } catch (error) {
      if (this.destroyed) return;
      if (isUpdateRequiredError(error)) {
        this.haltForUpdate(error, id, msg.version);
        return;
      }
      this.log('warn', 'Failed to apply remote mutation', {
        mutationId: id,
        error: errorMessage(error),
        originalError: error,
      });
    }
  }

  /**
   * Decode a mutation payload: decrypt when encrypted, otherwise parse plain
   * op/args. Every payload is normalized through the sync-format layer:
   * legacy decimal-money payloads are upgraded to milliunits, and payloads
   * from a newer format throw FormatTooNewError (handled by callers).
   */
  private async decodeMutationPayload(payload: {
    v?: number;
    op?: string;
    args?: string | Record<string, unknown>;
    encryptedPayload?: string;
  }): Promise<{ op: string; args: Record<string, unknown> }> {
    if (payload.encryptedPayload) {
      const dec = await this.deps.decryptPayload(payload.encryptedPayload);
      return normalizeMutationPayload({
        v: dec.v,
        op: dec.op,
        args: dec.args as Record<string, unknown>,
      });
    }
    return normalizeMutationPayload({
      v: payload.v,
      op: payload.op ?? '',
      args:
        typeof payload.args === 'string'
          ? JSON.parse(payload.args)
          : ((payload.args as Record<string, unknown>) ?? {}),
    });
  }

  private async handleCatchUp(msg: WsMessage): Promise<void> {
    if (this.updateRequired) {
      this.catchUpInProgress = false;
      this.catchUpRequestedSince = null;
      return;
    }
    const rawMutations = msg.mutations;
    const mutations: WsCatchUpMutation[] =
      rawMutations == null ? [] : Array.isArray(rawMutations) ? rawMutations : [];

    if (rawMutations != null && !Array.isArray(rawMutations)) {
      await this.handleCatchUpUnsafe('malformed_payload');
      return;
    }

    if (!this.catchUpInProgress) {
      this.catchUpInProgress = true;
    }

    const sinceVersion = this.catchUpRequestedSince ?? this.localVersion;

    // The server assigns mutation versions contiguously (MAX+1 per space), so
    // a valid replay must continue right after the newest version this client
    // holds — sinceVersion, or localVersion when acks advanced it mid-flight.
    // A gap means the log was compacted/pruned past our cursor (or our
    // database baseline is gone entirely) — replaying it would corrupt state,
    // so restore from a snapshot instead of attempting to apply anything.
    const firstIncoming = mutations[0];
    const knownVersion = Math.max(sinceVersion, this.localVersion);
    if (
      firstIncoming &&
      typeof firstIncoming.version === 'number' &&
      Number.isFinite(firstIncoming.version) &&
      firstIncoming.version > knownVersion + 1
    ) {
      this.log('warn', 'Catch-up log does not reach back to local version', {
        spaceId: this.spaceId,
        sinceVersion,
        localVersion: this.localVersion,
        firstAvailableVersion: firstIncoming.version,
      });
      await this.handleCatchUpUnsafe('mutation_log_gap');
      return;
    }

    let previousVersion = sinceVersion;
    let firstVersion: number | null = null;
    let lastVersion: number | null = null;

    for (const m of mutations) {
      if (this.destroyed) return;
      const { id } = m;
      if (typeof m.version !== 'number' || !Number.isFinite(m.version) || m.version <= 0) {
        await this.handleCatchUpUnsafe('invalid_mutation_version');
        return;
      }
      if (m.version <= previousVersion) {
        await this.handleCatchUpUnsafe('non_monotonic_version');
        return;
      }
      previousVersion = m.version;
      if (firstVersion === null) firstVersion = m.version;
      lastVersion = m.version;

      try {
        const { op, args } = await this.decodeMutationPayload(m);
        if (this.destroyed) return;

        await this.deps.onRemoteMutation(op, args, id || '');
        if (this.destroyed) return;
        this.catchUpApplyFailures.delete(this.catchUpFailureKey(m));
        await this.updateLocalVersion(m.version);
      } catch (error) {
        if (this.destroyed) return;
        if (isUpdateRequiredError(error)) {
          // A snapshot fallback cannot fix a format or op code we don't
          // understand, and quarantining would skip the change for good —
          // stop here and prompt for an app update instead.
          this.haltForUpdate(error, id, m.version);
          return;
        }
        this.log('warn', 'Failed to apply catch-up mutation', {
          mutationId: id,
          error: errorMessage(error),
          originalError: error,
        });
        const failureKey = this.catchUpFailureKey(m);
        const previousFailure = this.catchUpApplyFailures.get(failureKey);
        if (
          previousFailure?.version === m.version &&
          previousFailure.precedingVersion === this.localVersion
        ) {
          await this.quarantineCatchUpMutation(m, error);
          continue;
        }
        this.catchUpApplyFailures.set(failureKey, {
          version: m.version,
          precedingVersion: this.localVersion,
        });
        await this.handleCatchUpUnsafe('apply_failed');
        return;
      }
    }

    if (this.destroyed) return;
    this.catchUpPages += 1;
    const hasMoreMeta = typeof msg.hasMore === 'boolean' ? msg.hasMore : undefined;
    const latestVersionMeta =
      typeof msg.latestVersion === 'number' && Number.isFinite(msg.latestVersion)
        ? msg.latestVersion
        : undefined;
    const nextSinceMeta =
      typeof msg.nextSinceVersion === 'number' && Number.isFinite(msg.nextSinceVersion)
        ? msg.nextSinceVersion
        : undefined;

    // Regression guards compare against THIS catch-up's own progression
    // (previousVersion = last version applied from this page, or the
    // request's sinceVersion for an empty page) — NOT this.localVersion,
    // which an own-mutation ack can legitimately advance past the page's
    // metadata mid-flight (the server computed latestVersion before our
    // mutation was appended). Comparing against localVersion made an
    // ordinary reconnect-with-one-queued-mutation trigger a full snapshot
    // restore.
    if (typeof latestVersionMeta === 'number' && latestVersionMeta < previousVersion) {
      await this.handleCatchUpUnsafe('latest_version_regressed');
      return;
    }

    if (typeof nextSinceMeta === 'number' && nextSinceMeta < previousVersion) {
      await this.handleCatchUpUnsafe('next_since_regressed');
      return;
    }

    const resolvedHasMore = hasMoreMeta ?? mutations.length > 0;
    this.log('info', 'catch_up_page', {
      spaceId: this.spaceId,
      sinceVersion,
      count: mutations.length,
      from: firstVersion ?? sinceVersion,
      to: lastVersion ?? this.localVersion,
      hasMore: resolvedHasMore,
      latestVersion: latestVersionMeta,
      nextSinceVersion: nextSinceMeta,
    });

    if (hasMoreMeta === true && mutations.length === 0) {
      await this.handleCatchUpUnsafe('metadata_inconsistent_empty_page');
      return;
    }

    if (hasMoreMeta === true) {
      // Continue from the page's own end, never from localVersion — an
      // ack-inflated cursor would skip log entries between the page end and
      // the acked version.
      const nextSince = nextSinceMeta ?? previousVersion;
      if (nextSince <= sinceVersion) {
        await this.handleCatchUpUnsafe('metadata_inconsistent_next_since');
        return;
      }
      this.requestCatchUpIfNeeded(this.ws, nextSince);
      return;
    }

    if (hasMoreMeta === false) {
      await this.finishCatchUp();
      return;
    }

    // Legacy server path without pagination metadata.
    if (mutations.length === 0) {
      await this.finishCatchUp();
      return;
    }

    if (previousVersion <= sinceVersion) {
      await this.handleCatchUpUnsafe('legacy_progress_stalled');
      return;
    }
    this.requestCatchUpIfNeeded(this.ws, previousVersion);
  }

  /**
   * Stop applying synced mutations: this build is too old for the one at
   * `version`. The cursor stays before it (not advanced, not quarantined),
   * later mutations are ignored instead of applied out of order, and the app
   * is told to show its update prompt.
   */
  private haltForUpdate(
    error: FormatTooNewError | UnknownOpCodeError,
    mutationId: string | undefined,
    version: unknown
  ): void {
    const first = !this.updateRequired;
    this.updateRequired = {
      mutationId: mutationId || '',
      version: typeof version === 'number' ? version : undefined,
    };
    this.catchUpInProgress = false;
    this.catchUpRequestedSince = null;
    this.catchUpPages = 0;
    this.catchUpMutationBuffer = [];
    this.updateSyncStatus({
      isSyncing: false,
      syncError: {
        code: 'update_required',
        message: 'This device needs an app update to apply newer changes.',
        detail:
          error instanceof UnknownOpCodeError || error.name === 'UnknownOpCodeError'
            ? 'unknown_op'
            : 'format_too_new',
      },
    });
    if (error instanceof UnknownOpCodeError || error.name === 'UnknownOpCodeError') {
      const { op } = error as UnknownOpCodeError;
      this.log(
        'error',
        'Synced mutation uses an op code this app does not have — update required',
        {
          mutationId,
          version,
          op,
          localVersion: this.localVersion,
          spaceId: this.spaceId,
        }
      );
      if (first) this.deps.onUnknownOpCode?.(this.spaceId, op);
      return;
    }
    const { receivedVersion } = error as FormatTooNewError;
    this.log('error', 'Synced mutation uses a newer data format — update required', {
      mutationId,
      version,
      receivedVersion,
      localVersion: this.localVersion,
      spaceId: this.spaceId,
    });
    if (first) this.deps.onFormatTooNew?.(this.spaceId, receivedVersion);
  }

  /** True once a synced mutation needed a newer app; sync is halted before it. */
  isUpdateRequired(): boolean {
    return this.updateRequired !== null;
  }

  private catchUpFailureKey(mutation: WsCatchUpMutation): string {
    return mutation.id || `version:${mutation.version}`;
  }

  private async quarantineCatchUpMutation(
    mutation: WsCatchUpMutation,
    error: unknown
  ): Promise<void> {
    const { version } = mutation;
    if (typeof version !== 'number' || !Number.isFinite(version)) return;
    const mutationId = mutation.id || `version ${mutation.version}`;
    const message = `A synced change (${mutationId}) could not be applied and was skipped on this device.`;

    this.log('error', 'catch_up_mutation_quarantined', {
      mutationId: mutation.id,
      version: mutation.version,
      precedingVersion: this.localVersion,
      error: errorMessage(error),
      originalError: error,
      spaceId: this.spaceId,
    });
    await this.updateLocalVersion(version);
    if (this.destroyed) return;
    this.updateSyncStatus({
      isSyncing: false,
      syncError: { code: 'mutation_quarantined', message },
    });
  }

  private requestCatchUpIfNeeded(ws: WebSocket | null, sinceVersion = this.localVersion): void {
    if (this.destroyed) return;
    if (this.updateRequired) return;
    if (!ws) return;
    if (sinceVersion < 0) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      this.catchUpInProgress = true;
      this.catchUpRequestedSince = sinceVersion;
      ws.send(
        JSON.stringify({
          type: 'catch_up_request',
          sinceVersion,
          spaceId: this.spaceId,
        })
      );
      if (this.catchUpPages === 0) {
        this.log('info', 'catch_up_start', {
          spaceId: this.spaceId,
          sinceVersion,
        });
      } else {
        this.log('debug', 'Requested catch-up mutations', {
          sinceVersion,
          spaceId: this.spaceId,
          page: this.catchUpPages + 1,
        });
      }
    } catch (error) {
      this.catchUpInProgress = false;
      this.catchUpRequestedSince = null;
      this.log('warn', 'Failed to request catch-up mutations', {
        sinceVersion,
        error: errorMessage(error),
        originalError: error,
      });
    }
  }

  private async finishCatchUp(): Promise<void> {
    if (!this.catchUpInProgress && this.catchUpMutationBuffer.length === 0) return;
    const bufferedCount = this.catchUpMutationBuffer.length;
    this.catchUpRequestedSince = null;
    this.catchUpPages = 0;

    this.log('info', 'catch_up_complete', {
      spaceId: this.spaceId,
      localVersion: this.localVersion,
      bufferedMutations: bufferedCount,
    });

    // Drain with catchUpInProgress still set: live mutations arriving
    // mid-drain keep buffering behind the entries already waiting instead
    // of applying concurrently and leapfrogging them. Loop until the buffer
    // is genuinely empty, then release the flag.
    while (this.catchUpMutationBuffer.length > 0) {
      const pending = [...this.catchUpMutationBuffer];
      this.catchUpMutationBuffer = [];
      for (const m of pending) {
        try {
          await this.processMessage(m);
        } catch {
          /* message processing errors logged internally */
        }
      }
    }
    this.catchUpInProgress = false;
    this.markInitialCatchUpSettled();
  }

  private async handleCatchUpUnsafe(reason: string): Promise<void> {
    if (this.destroyed || this.catchUpRecoveryInProgress) return;
    this.catchUpRecoveryInProgress = true;

    const sinceVersion = this.catchUpRequestedSince ?? this.localVersion;
    this.catchUpInProgress = false;
    this.catchUpRequestedSince = null;
    this.catchUpPages = 0;
    this.catchUpMutationBuffer = [];

    this.log('warn', 'catch_up_fallback_snapshot', {
      reason,
      sinceVersion,
      localVersion: this.localVersion,
      spaceId: this.spaceId,
    });

    try {
      const recovery = await this.deps.onCatchUpUnsafe?.({
        reason,
        sinceVersion,
        localVersion: this.localVersion,
        spaceId: this.spaceId,
      });
      if (this.destroyed) return;
      if (
        recovery &&
        typeof recovery.mutationVersion === 'number' &&
        Number.isFinite(recovery.mutationVersion) &&
        recovery.mutationVersion >= 0
      ) {
        this.replaceLocalVersion(recovery.mutationVersion);
      }
      if (
        recovery &&
        typeof recovery.blobVersion === 'number' &&
        Number.isFinite(recovery.blobVersion) &&
        recovery.blobVersion > 0
      ) {
        try {
          this.deps.onSyncStateChanged?.(this.spaceId, recovery.blobVersion);
        } catch {
          /* no-op */
        }
      }
    } catch (error) {
      if (this.destroyed) return;
      if (error instanceof SnapshotUnavailableError) {
        // Nothing left to restore from: the mutation log can't be replayed and
        // the server has no snapshot/blob. Retrying would loop through the
        // same failure, so stop syncing this space until the next activation.
        this.syncDisabled = true;
        this.updateSyncStatus({
          isSyncing: false,
          syncError: { code: 'snapshot_unavailable', message: errorMessage(error) },
        });
        this.resolveInitialCatchUpWaiters({ completed: false, timedOut: false });
        this.log('error', 'Catch-up recovery is impossible — sync disabled for this space', {
          reason,
          spaceId: this.spaceId,
        });
      } else {
        this.log('error', 'Catch-up snapshot recovery failed', {
          reason,
          error: errorMessage(error),
          originalError: error,
          spaceId: this.spaceId,
        });
      }
    } finally {
      this.catchUpRecoveryInProgress = false;
    }

    if (this.destroyed) return;
    if (this.syncDisabled) {
      try {
        this.ws?.close();
      } catch {
        /* no-op */
      }
      this.ws = null;
      this.notifyConnection(false);
      return;
    }

    const { ws } = this;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close();
      } catch {
        this.scheduleReconnect();
      }
      return;
    }
    this.scheduleReconnect();
  }

  private markInitialCatchUpSettled(): void {
    if (this.destroyed || this.initialCatchUpSettled) return;
    this.initialCatchUpSettled = true;
    this.resolveInitialCatchUpWaiters({ completed: true, timedOut: false });
  }

  private resolveInitialCatchUpWaiters(result: { completed: boolean; timedOut: boolean }): void {
    if (!this.initialCatchUpWaiters.size) return;
    const waiters = [...this.initialCatchUpWaiters];
    this.initialCatchUpWaiters.clear();
    for (const waiter of waiters) {
      try {
        waiter(result);
      } catch {
        /* no-op */
      }
    }
  }

  private async updateLocalVersion(version: number): Promise<void> {
    if (this.destroyed) return;
    if (!Number.isFinite(version)) return;
    if (version <= this.localVersion) return;
    this.localVersion = version;

    if (this.deps.persistLocalDatabaseSoon) {
      this.persistCursorAfterDebouncedSave(version);
      return;
    }

    const persisted = await this.persistCursorAfterLocalSave(version);
    if (this.destroyed) return;
    if (!persisted) {
      this.log('warn', 'Mutation cursor advance skipped due to local persistence failure', {
        version,
        spaceId: this.spaceId,
      });
    }
  }

  private replaceLocalVersion(version: number): void {
    if (this.destroyed) return;
    if (!Number.isFinite(version) || version < 0) return;
    if (version === this.localVersion) return;
    this.localVersion = version;
    this.cursorEpoch += 1;
    this.durableVersion = version;
    if (version > 0) {
      writeStoredVersion(this.cursorStorageKey, version);
    } else {
      clearStoredVersion(this.cursorStorageKey);
    }
  }

  private async persistCursorAfterLocalSave(version: number): Promise<boolean> {
    if (this.destroyed) return false;
    try {
      if (this.deps.persistLocalDatabase) {
        const persisted = await this.deps.persistLocalDatabase();
        if (this.destroyed || !persisted) {
          return false;
        }
      }
      writeStoredVersion(this.cursorStorageKey, version);
      return true;
    } catch (error) {
      if (this.destroyed) return false;
      this.log('warn', 'Failed to persist mutation cursor after local save', {
        version,
        spaceId: this.spaceId,
        error: errorMessage(error),
        originalError: error,
      });
      return false;
    }
  }

  /**
   * Debounced cursor advance: the in-memory cursor moved already; the stored
   * one follows once a local persist that started after this call (so it
   * contains every mutation up to `version`) has landed. Message handling does
   * not wait for it, so a catch-up page or a burst of acks costs one persist.
   * A crash before then leaves the stored cursor behind the DB, never ahead:
   * catch-up replays the gap and applied-id dedup skips what the DB has.
   */
  private persistCursorAfterDebouncedSave(version: number): void {
    const epoch = this.cursorEpoch;
    const persist = this.deps.persistLocalDatabaseSoon!;
    persist().then(
      (persisted) => {
        if (this.destroyed || epoch !== this.cursorEpoch) return;
        if (!persisted) {
          this.log('warn', 'Mutation cursor advance skipped due to local persistence failure', {
            version,
            spaceId: this.spaceId,
          });
          return;
        }
        if (version <= this.durableVersion) return;
        this.durableVersion = version;
        writeStoredVersion(this.cursorStorageKey, version);
      },
      (error: unknown) => {
        if (this.destroyed) return;
        this.log('warn', 'Failed to persist mutation cursor after local save', {
          version,
          spaceId: this.spaceId,
          error: errorMessage(error),
          originalError: error,
        });
      }
    );
  }

  private async persistLocalMutationOnly(reason: string): Promise<boolean> {
    if (this.destroyed) return false;
    try {
      if (!this.deps.persistLocalDatabase) return true;
      const persisted = await this.deps.persistLocalDatabase();
      if (this.destroyed) return false;
      if (!persisted) {
        this.log('warn', 'Failed to persist local database for applied mutation', {
          reason,
          version: this.localVersion,
          spaceId: this.spaceId,
        });
      }
      return persisted;
    } catch (error) {
      if (this.destroyed) return false;
      this.log('warn', 'Error persisting local database for applied mutation', {
        reason,
        version: this.localVersion,
        spaceId: this.spaceId,
        error: errorMessage(error),
        originalError: error,
      });
      return false;
    }
  }

  private handleEncryptionKeyChanged(msg: WsMessage): void {
    const newVersion = typeof msg.version === 'number' ? msg.version : 0;
    this.log('warn', 'Encryption key changed on another device', {
      newVersion,
      spaceId: this.spaceId,
    });

    if (this.deps.onEncryptionKeyChanged) {
      this.deps.onEncryptionKeyChanged(this.spaceId, newVersion);
      return;
    }

    if (this.deps.setPasswordChangedReason) {
      this.deps.setPasswordChangedReason();
    } else {
      try {
        localStorage.setItem(PASSWORD_CHANGED_REASON_KEY, 'true');
      } catch {
        /* no-op */
      }
    }

    this.log('warn', 'Reloading app due to encryption key change');
    if (this.deps.reloadApp) {
      this.deps.reloadApp();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  private handleKeyVersionAck(msg: WsMessage): void {
    const callback = this.keyVersionCallbacks.shift();
    if (callback) {
      if (msg.success && typeof msg.new_version === 'number') {
        this.log('info', 'Encryption key version incremented', {
          newVersion: msg.new_version,
        });
        callback.resolve(msg.new_version);
      } else {
        const errorMsg =
          typeof msg.error === 'string' ? msg.error : 'Failed to increment key version';
        this.log('error', 'Failed to increment encryption key version', {
          error: errorMsg,
        });
        callback.reject(new Error(errorMsg));
      }
    }
  }

  private createDefaultWebSocketUrl(token: string | null): string {
    if (typeof window === 'undefined') {
      throw new Error('No WebSocket URL provider available in non-browser environment');
    }
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    return `${wsProtocol}//${wsHost}/api/v1/ws/sync?token=${encodeURIComponent(
      token || ''
    )}&space_id=${encodeURIComponent(this.spaceId)}&protocol=${SYNC_PROTOCOL_VERSION}&client_session=${getClientSessionId()}`;
  }
}
