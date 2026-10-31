import type {
  SpaceSummary,
  MutationExecutorDeps,
  QueryClientLike,
  WebDatabaseInstance,
} from '../types';
import type { LocalPersistenceCipher } from '../crypto';
import type { MigrationRunner } from '../database-sync';
import type { RuntimeComponentLogFn } from '../logging';

export type StateChangeListener = (
  state: import('../types').RuntimeState,
  prevState: import('../types').RuntimeState
) => void;

export interface RuntimeCoordinatorDeps {
  getToken(): Promise<string | null>;

  checkApiHealth(): Promise<boolean>;
  uploadBlob(
    spaceId: string,
    data: Uint8Array,
    version: number | undefined,
    keyVersion: number,
    mutationVersion?: number,
    outOfBand?: boolean
  ): Promise<{ version: number }>;
  downloadBlob(spaceId: string): Promise<{ data: Uint8Array; headers: Headers } | null>;
  hasLocalDatabase?(path: string): Promise<boolean>;
  getDatabaseState?(spaceId: string): Promise<{
    version: number;
    mutation_version?: number;
    hash?: string;
    space_id?: string;
  } | null>;
  getProfile?(): Promise<{ primary_space_id?: string } | null>;
  listSpaces?(): Promise<SpaceSummary[]>;
  uploadEncryptedKey?(spaceId: string, wrappedKey: string): Promise<void>;
  cleanupStaleSpaceDatabases?(spaceIds: string[], opts: { suffix: string }): Promise<void>;
  cleanupDatabaseFile?(path: string): Promise<void>;

  createDatabase(
    data?: Uint8Array,
    opts?: {
      forceServerData?: boolean;
      localPersistence?: LocalPersistenceCipher;
      path?: string;
    }
  ): Promise<WebDatabaseInstance>;

  executeOp(
    op: string,
    payload: Record<string, unknown>,
    context: import('../types').MutationExecutionContext
  ): Promise<unknown>;
  getUndoSpec(
    op: string
  ): MutationExecutorDeps['getUndoSpec'] extends (op: string) => infer R ? R : never;
  getInvalidatesForOp(op: string): string[][] | undefined;
  getInvalidatesForCall?(op: string, args: Record<string, unknown>): string[][] | undefined;

  getQueryClient?(): QueryClientLike | undefined;
  pushUndo?(entry: import('../types').UndoEntry): void;
  clearUndo?(): void;
  recordHistory?(entry: import('../types').HistoryEntry): void;
  resolveHistoryBudgetId?(
    context: import('../types').MutationBudgetResolutionContext
  ): number | null | undefined;
  onAnalyticsEvent?(op: string): void;
  /** Every space activation, successful or not, with how the local database was obtained. */
  onSpaceActivated?(outcome: SpaceActivationOutcome): void;

  migrationRunner?: MigrationRunner;

  isSelfHostable?: boolean;
  isE2E?: boolean;
  opfsSuffix?: string;

  runtimeLog?: RuntimeComponentLogFn;
  reconnectionPolicy?: {
    cooldownMs?: number;
    recentDownloadWindowMs?: number;
    successOverlayMs?: number;
  };
  syncTransportPolicy?: {
    getWebSocketUrl?(spaceId: string, token: string | null): string;
    subscribeNetworkStatus?(handlers: { online: () => void; offline: () => void }): () => void;
    getReconnectDelayMs?(attempt: number): number;
    onEncryptionKeyChanged?(spaceId: string, version: number): void;
    /** A sync payload arrived in a newer data format — prompt for an app update. */
    onFormatTooNew?(spaceId: string, receivedVersion: number): void;
    /** A synced mutation names an op code this build doesn't have — prompt for update. */
    onUnknownOpCode?(spaceId: string, op: string): void;
    setPasswordChangedReason?(): void;
    reloadApp?(): void;
  };
}

/** Read-only snapshot of the active space's sync position, for diagnostics UI. */
/**
 * How a space activation obtained its local database:
 *  - server_snapshot: downloaded and restored the server snapshot
 *  - local: opened this device's stored copy
 *  - local_after_download_failure: the snapshot download/restore failed, fell back to the stored copy
 *  - local_reset: the stored copy could not be opened and was wiped (catch-up rebuilds it)
 *  - fresh: no stored copy and no server snapshot (new space)
 */
export type SpaceActivationPath =
  'server_snapshot' | 'local' | 'local_after_download_failure' | 'local_reset' | 'fresh';

export interface SpaceActivationOutcome {
  ok: boolean;
  path: SpaceActivationPath;
  durationMs: number;
  /** Set when ok is false. */
  error?: unknown;
  /** The error that sent activation down a fallback path (download or local open), if any. */
  fallbackError?: unknown;
}

export interface SyncDiagnostics {
  spaceId: string;
  /** Last mutation-log version applied to the local database. */
  cursor: number;
  /** Server blob version last seen by this device. */
  blobVersion: number | undefined;
  /** Log position of the snapshot this device last restored from. */
  lastDownloadedMutationVersion: number | undefined;
  connected: boolean;
  catchUpInProgress: boolean;
  initialCatchUpSettled: boolean;
  /** Local mutations the server has not acknowledged yet. */
  pendingCount: number;
}

export interface PendingMutationInfo {
  id: string;
  op: string;
  timestamp: Date;
  /** False until sent on the current connection. */
  sent: boolean;
}
