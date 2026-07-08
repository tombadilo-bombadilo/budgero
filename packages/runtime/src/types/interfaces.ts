/**
 * Core runtime interfaces — dependency injection contracts.
 */

import type { RuntimeLogFn } from '../logging';

/**
 * Minimal database adapter interface.
 * Matches @budgero/core DatabaseAdapter surface used by runtime.
 */
export interface DatabaseAdapter {
  exec(sql: string): void;
  backup(): Promise<Uint8Array>;
  restore(data: Uint8Array): Promise<void>;
  /** Restore a backup blob and run pending migrations before persisting. */
  restoreAndMigrate?(data: Uint8Array): Promise<void>;
  close?(): void;
}

/**
 * Extended database adapter with web-specific methods.
 */
export interface WebDatabaseInstance extends DatabaseAdapter {
  /** Save database to OPFS (Origin Private File System) */
  saveToOPFSPublic?: () => Promise<void>;
  /** Force save to persistence layer */
  forceSave?: () => Promise<void>;
  /** Swap the at-rest encryption cipher for subsequent OPFS persists. */
  updateLocalPersistenceCipher?: (cipher: {
    encrypt(data: Uint8Array): Promise<Uint8Array>;
    decrypt(data: Uint8Array): Promise<{ decrypted: Uint8Array; wasEncrypted: boolean }>;
  }) => void;
}

/**
 * Encryption service for mutation payloads.
 * Used for encrypting/decrypting data sent over WebSocket.
 */
export interface RuntimeEncryption {
  encryptMutation(payload: { op: string; args: Record<string, unknown> }): Promise<string>;
  decryptMutation(encryptedPayload: string): Promise<{ op: string; args: Record<string, unknown> }>;
}

/**
 * Connectivity state snapshot.
 */
export interface ConnectivityState {
  clerkToken: boolean;
  apiReachable: boolean;
  wsConnected: boolean;
  overall: boolean;
  lastChecked: number;
  selfHostable: boolean;
}

/**
 * Workspace (budget space) summary from server API.
 */
export interface SpaceSummary {
  space_id: string;
  display_name: string;
  owner_user_id: string;
  role: string;
  invitation_status: string;
  encrypted_space_key: string;
  is_accessible?: boolean;
  access_reason?: 'active' | 'owned_subscription_required' | 'shared_owner_inactive';
  created_at: string;
}

/** @deprecated Use {@link SpaceSummary} instead. */
export type BudgetSpaceSummary = SpaceSummary;

/**
 * Mutation payload for offline queue and sync.
 */
export interface MutationPayload {
  id: string;
  baseVersion: number;
  /** Data-format version of args (see sync-format.ts); absent = legacy decimal format. */
  v?: number;
  op: string;
  args: Record<string, unknown>;
  timestamp: Date;
  spaceId: string;
}

/**
 * Mutation specification for executor.
 */
export interface MutationSpec {
  op: string;
  payload: Record<string, unknown>;
  invalidates?: string[][];
  /**
   * Remote/replay id — setting this marks the mutation as a RECEIVER apply
   * (no undo, no queue/broadcast). For a LOCAL mutation that needs a stable
   * id across retries, use idempotencyKey instead.
   */
  mutationId?: string;
  /**
   * Stable id for a locally-originated mutation (at-least-once producers
   * like the push-API queue). Unlike mutationId it keeps full mutator
   * semantics: undo capture, durable queueing, broadcast.
   */
  idempotencyKey?: string;
  spaceId?: string;
  meta?: {
    skipUndo?: boolean;
    /** Opt out of the executor's op-driven query invalidation (rare). */
    skipInvalidate?: boolean;
    label?: string;
    forceInvalidate?: boolean;
    origin?: 'local' | 'remote';
  };
}

/**
 * Mutation execution result.
 */
export interface MutationResult<T = unknown> {
  result: T;
  synced: boolean;
  queued: boolean;
}

/**
 * SyncTransport dependency injection interface.
 */
export interface SyncTransportDeps {
  getToken(): Promise<string | null>;
  encryptPayload(payload: { v: number; op: string; args: unknown }): Promise<string>;
  decryptPayload(encrypted: string): Promise<{ v?: number; op: string; args: unknown }>;
  onRemoteMutation(op: string, args: Record<string, unknown>, id: string): Promise<void>;
  /**
   * The server acknowledged a mutation we sent. At-least-once delivery:
   * a mutation stays in the offline queue until this fires for its ID.
   */
  onMutationAck?(mutationId: string, version: number): void | Promise<void>;
  /** Persist local DB snapshot before advancing durable mutation cursor. */
  persistLocalDatabase?(): Promise<boolean>;
  onConnectionChange(connected: boolean): void;
  onSyncStateChanged?(spaceId: string, version: number, outOfBand?: boolean): void;
  onCatchUpUnsafe?(details: {
    reason: string;
    sinceVersion: number;
    localVersion: number;
    spaceId: string;
  }): Promise<{ mutationVersion?: number; blobVersion?: number } | void>;
  getWebSocketUrl?(spaceId: string, token: string | null): string;
  subscribeNetworkStatus?(handlers: { online: () => void; offline: () => void }): () => void;
  getReconnectDelayMs?(attempt: number): number;
  onEncryptionKeyChanged?(spaceId: string, version: number): void;
  /** A payload arrived in a format newer than this build understands — prompt for update. */
  onFormatTooNew?(spaceId: string, receivedVersion: number): void;
  setPasswordChangedReason?(): void;
  reloadApp?(): void;
  log?: RuntimeLogFn;
}

/**
 * ConnectivityMonitor dependency injection interface.
 */
export interface ConnectivityMonitorDeps {
  getToken(): Promise<string | null>;
  checkApiHealth(): Promise<boolean>;
  getWebSocketConnected?(): boolean;
  isSelfHostable?: boolean;
}

/**
 * DatabaseSync dependency injection interface.
 */
export interface DatabaseSyncDeps {
  getDatabase(): WebDatabaseInstance | null;
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
  checkApiHealth(): Promise<boolean>;
  /** Current mutation-log cursor; bound to each uploaded blob. */
  getMutationCursor?(): number;
  /**
   * True while locally-applied mutations await their server ack. Uploads are
   * deferred then: the cursor wouldn't match the blob's contents, and a
   * mismatch means skipped or double-applied mutations on fresh devices.
   */
  hasUnackedMutations?(): boolean;
  /**
   * Fired after every successful downloadAndRestore, with the mutation-log
   * version bound to the restored blob (undefined for legacy blobs). The
   * wiring must restore the sync invariants the new DB content invalidated:
   * reseed the cursor, clear applied/in-flight dedup, re-apply queued local
   * mutations.
   */
  onDatabaseRestored?(boundMutationVersion: number | undefined): Promise<void> | void;
  /** Debounce policy for steady-state uploads (tests override). */
  uploadPolicy?: {
    /** Upload once this many mutations accumulated. Default 20. */
    mutationThreshold?: number;
    /** Upload at latest this long after the first pending mutation. Default 5 min. */
    maxDelayMs?: number;
    /** Retry delay when an upload is deferred on unacked mutations. Default 2 s. */
    unackedRetryMs?: number;
    /** Retry delay after a failed upload. Default 30 s. */
    failedUploadRetryMs?: number;
  };
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * MutationExecutor dependency injection interface.
 */
export interface MutationExecutorDeps {
  executeOp(op: string, payload: Record<string, unknown>): Promise<unknown>;
  getUndoSpec(op: string): UndoSpec | undefined;
  getInvalidatesForOp(op: string): string[][] | undefined;
  getQueryClient(): QueryClientLike | undefined;
  pushUndo(entry: UndoEntry): void;
  recordHistory(entry: HistoryEntry): void;
  resolveHistoryBudgetId?(context: MutationBudgetResolutionContext): number | null | undefined;
  getActiveSpaceId(): string | null;
  getSpaceRole(spaceId: string): string | null;
  onAnalyticsEvent?(op: string): void;
}

/**
 * QueryClient-like interface (minimal surface of TanStack QueryClient).
 */
export interface QueryClientLike {
  invalidateQueries(options?: {
    queryKey?: string[];
    predicate?: (q: { queryKey: unknown[] }) => boolean;
  }): Promise<void>;
  cancelQueries?(): void;
  removeQueries?(): void;
  clear?(): void;
}

/**
 * Undo specification from op-code registry.
 */
export interface UndoSpec {
  capture?(payload: Record<string, unknown>): Promise<unknown>;
  build?(
    payload: Record<string, unknown>,
    result: unknown,
    beforeState: unknown
  ): { op: string; args: Record<string, unknown> }[] | null;
}

/**
 * Undo entry for the undo store.
 */
export interface UndoEntry {
  id: string;
  label?: string;
  undo: { op: string; args: Record<string, unknown> }[];
  redo: { op: string; args: Record<string, unknown> }[];
  ts: number;
}

/**
 * Mutation history entry.
 */
export interface HistoryEntry {
  budgetId: number;
  spaceId: string;
  mutationId: string;
  userId: string | null;
  op: string;
  payload: Record<string, unknown>;
  origin: 'local' | 'remote';
  undoOps: { op: string; args: Record<string, unknown> }[] | null;
  redoOps: { op: string; args: Record<string, unknown> }[] | null;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface MutationBudgetResolutionContext {
  op: string;
  payload: Record<string, unknown>;
  result: unknown;
  beforeState: unknown;
  undoOps: { op: string; args: Record<string, unknown> }[] | null;
  redoOps: { op: string; args: Record<string, unknown> }[] | null;
  spaceId: string;
  isReceiver: boolean;
}

/**
 * RuntimeCoordinator states.
 */
export type RuntimeState =
  | 'Idle'
  | 'Initializing'
  | 'Ready'
  | 'SwitchingSpace'
  | 'Reconnecting'
  | 'Degraded'
  | 'Error'
  | 'Destroyed';

/**
 * Budget ID extraction from mutation payload.
 */
export interface PayloadWithBudgetId {
  budgetId?: number;
  budget_id?: number;
  BudgetID?: number;
}

export function extractBudgetId(payload: Record<string, unknown>): number | null {
  const p = payload as PayloadWithBudgetId;
  const id = p.budgetId ?? p.budget_id ?? p.BudgetID;
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
    return id;
  }
  return null;
}

/**
 * User ID extraction from mutation spec.
 */
export interface SpecWithUserId {
  userId?: string | null;
}
