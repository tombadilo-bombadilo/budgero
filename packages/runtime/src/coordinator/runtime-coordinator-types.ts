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

  executeOp(op: string, payload: Record<string, unknown>): Promise<unknown>;
  getUndoSpec(
    op: string
  ): MutationExecutorDeps['getUndoSpec'] extends (op: string) => infer R ? R : never;
  getInvalidatesForOp(op: string): string[][] | undefined;

  getQueryClient?(): QueryClientLike | undefined;
  pushUndo?(entry: import('../types').UndoEntry): void;
  clearUndo?(): void;
  recordHistory?(entry: import('../types').HistoryEntry): void;
  resolveHistoryBudgetId?(
    context: import('../types').MutationBudgetResolutionContext
  ): number | null | undefined;
  onAnalyticsEvent?(op: string): void;

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
    setPasswordChangedReason?(): void;
    reloadApp?(): void;
  };
}
