export type {
  DatabaseAdapter,
  WebDatabaseInstance,
  RuntimeEncryption,
  ConnectivityState,
  SpaceSummary,
  BudgetSpaceSummary,
  MutationPayload,
  MutationSpec,
  MutationResult,
  SyncTransportDeps,
  ConnectivityMonitorDeps,
  DatabaseSyncDeps,
  MutationExecutorDeps,
  QueryClientLike,
  UndoSpec,
  UndoEntry,
  HistoryEntry,
  MutationBudgetResolutionContext,
  RuntimeState,
  PayloadWithBudgetId,
  SpecWithUserId,
} from './interfaces';

export { extractBudgetId } from './interfaces';

export type { WsMessage, WsCatchUpMutation } from './messages';

export {
  SPACE_KEY_STORAGE_PREFIX,
  SPACE_CACHE_STORAGE,
  ACTIVE_SPACE_STORAGE,
  ENCRYPTION_KEY_VERSION_PREFIX,
  BLOB_VERSION_STORAGE_PREFIX,
  MUTATION_CURSOR_STORAGE_PREFIX,
  PASSWORD_CHANGED_REASON_KEY,
  APPLIED_IDS_PREFIX,
  DEFAULT_SPACE_KEY,
  MASTER_PASSWORD_STATUS_KEY,
  MASTER_PASSWORD_PERSISTENCE_KEY,
  MASTER_PASSWORD_SESSION_CACHE_KEY,
  MASTER_PASSWORD_INDEXEDDB_NAME,
  MASTER_PASSWORD_INDEXEDDB_STORE,
  MASTER_PASSWORD_INDEXEDDB_RECORD_KEY,
} from './storage-keys';
