/**
 * @budgero/runtime — Runtime engine for Budgero.
 *
 * Components organized by dependency layer:
 * - Layer 1: Pure utilities (crypto, utils)
 * - Layer 2: Leaf components (KeyVault, ConnectivityMonitor, OfflineQueue, SpaceRegistry)
 * - Layer 3: Mid-level components (SyncTransport, DatabaseSync, DatabaseLoader, MutationExecutor)
 * - Layer 4: Coordinator (RuntimeCoordinator)
 */

// Crypto
export {
  encryptEnvelope,
  decryptEnvelope,
  clearEnvelopeCache,
  getCachedSalt,
  compress,
  decompress,
  tryDecompress,
  toBase64,
  fromBase64,
  toBase64Url,
  fromBase64Url,
  MutationEncryption,
  compressAndEncryptDatabase,
  decryptAndDecompressDatabase,
  generateSpaceKey,
  encodeSpaceKey,
  decodeSpaceKey,
  wrapSpaceKeyWithMaster,
  unwrapSpaceKeyWithMaster,
  generateInviteSecret,
  hashInviteSecret,
  encryptSpaceKeyForInvite,
  decryptSpaceKeyFromInvite,
  createLocalPersistenceCipher,
} from './crypto';
export type {
  DecryptEnvelopeResult,
  CompressAndEncryptResult,
  DecryptAndDecompressResult,
  LocalPersistenceCipher,
} from './crypto';

// Types
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
  WsMessage,
  WsCatchUpMutation,
} from './types';
export {
  extractBudgetId,
  SPACE_KEY_STORAGE_PREFIX,
  SPACE_CACHE_STORAGE,
  ACTIVE_SPACE_STORAGE,
  ENCRYPTION_KEY_VERSION_PREFIX,
  BLOB_VERSION_STORAGE_PREFIX,
  MUTATION_CURSOR_STORAGE_PREFIX,
  PASSWORD_CHANGED_REASON_KEY,
} from './types';

// Utils
export {
  generateMutationId,
  errorMessage,
  isDecryptionError,
  CancellationError,
  checkAbort,
} from './utils';
export { logRuntime, logRuntimeError, scopedLogger } from './logging';
export type {
  RuntimeLogLevel,
  RuntimeLogContext,
  RuntimeLogFn,
  RuntimeComponentLogFn,
} from './logging';

// Components
export {
  KeyVault,
  MasterPasswordStore,
  masterPasswordStore,
  IndexedDBStore,
  getOrCreateDeviceKey,
  deleteDeviceKeyRecord,
  encryptWithDeviceKey,
  decryptWithDeviceKey,
} from './key-vault';
export type { KeyVaultDeps, MasterPasswordPersistenceSetting } from './key-vault';

export { ConnectivityMonitor } from './connectivity';
export type { ConnectivityListener } from './connectivity';

export { OfflineQueue, IndexedDBQueueStorage, InMemoryQueueStorage } from './offline-queue';
export type { QueueStorage } from './offline-queue';

export { SpaceRegistry } from './space-registry';

export {
  FormatTooNewError,
  MUTATION_FORMAT_VERSION,
  SYNC_PROTOCOL_VERSION,
  normalizeMutationPayload,
  upgradeLegacyMoneyValues,
} from './sync-format';

export { SyncTransport, SnapshotUnavailableError } from './sync-transport';
export type {
  ConnectionListener,
  OverlayPhase,
  OverlayListener,
  SyncStatus,
  SyncStatusListener,
} from './sync-transport';

export { DatabaseSync, DatabaseLoader } from './database-sync';
export type { MigrationRunner } from './database-sync';

export { MutationExecutor } from './mutation-executor';
export type { ExecuteResult } from './mutation-executor';

export { RuntimeCoordinator } from './coordinator';
export type { RuntimeCoordinatorDeps, StateChangeListener } from './coordinator';
