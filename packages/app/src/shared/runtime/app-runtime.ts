/**
 * AppRuntime — Thin wrapper around RuntimeCoordinator.
 *
 * App-level concerns that stay here:
 * - ServiceManager (domain services initialization)
 * - executeMutation() (delegates to coordinator + continuous rules post-hook)
 * - processPushQueue() (uses pushApi, services)
 *
 * Everything else delegates to RuntimeCoordinator from @budgero/runtime.
 */

import {
  FormatTooNewError,
  normalizeMutationPayload,
  RuntimeCoordinator,
  type RuntimeState,
  type ConnectivityState,
  type BudgetSpaceSummary,
  type RuntimeEncryption,
  type MutationSpec,
  type MutationResult,
  type MutationBudgetResolutionContext,
  type QueryClientLike,
  type WebDatabaseInstance,
  type PayloadWithBudgetId,
} from '@budgero/runtime';
import {
  ServiceManager,
  type Services,
  type DatabaseAdapter as CoreDatabaseAdapter,
  TransactionRule,
  MarkOccurrenceReadyResult,
  MutationErrorCode,
} from '@budgero/core/browser';
import type { QueryClient } from '@tanstack/react-query';
import type { SyncStatus } from '@shared/lib/utils';
import { MutationRouter } from '@shared/runtime/mutation-router';
import { createRuntimeDeps } from '@shared/runtime/runtime-bridge';
import { getInvalidatesForOp } from '@shared/mutations/op-code-registry';
import { getErrorMessage } from '@shared/lib/errors';
import { notifyUpdateRequired } from '@shared/lib/update-required';

export class AppRuntime {
  private coordinator: RuntimeCoordinator;

  private serviceManager = new ServiceManager();

  private _mutationsShim: MutationRouter | null = null;

  private pushQueueProcessingInProgress = false;

  /**
   * Query client captured from the first init() that provides one. The
   * coordinator falls back to deps.getQueryClient when its own ref is
   * cleared (destroy() → re-init without a queryClient, e.g. the master
   * password change flow) — this field is what makes that fallback real.
   * It must NOT delegate back to coordinator.getQueryClient(): that is a
   * mutual recursion (the coordinator's fallback IS this dep) and overflows
   * the stack the moment the ref is unset.
   */
  private capturedQueryClient: QueryClientLike | undefined;

  constructor() {
    const deps = createRuntimeDeps();

    // Late-bound deps: these need ServiceManager and QueryClient
    deps.getQueryClient = () => this.capturedQueryClient;
    deps.recordHistory = (entry) => {
      try {
        const services = this.serviceManager.getServices();
        if (services?.mutationHistory) {
          services.mutationHistory.record({
            budgetId: entry.budgetId ?? 0,
            spaceId: entry.spaceId ?? '',
            mutationId: entry.mutationId,
            userId: entry.userId ?? null,
            op: entry.op,
            payload: entry.payload,
            origin: entry.origin,
            undoOps: entry.undoOps ?? null,
            redoOps: entry.redoOps ?? null,
          });
        }
      } catch {
        /* no-op */
      }
    };
    deps.resolveHistoryBudgetId = (context) => this.resolveHistoryBudgetId(context);

    this.coordinator = new RuntimeCoordinator(deps);
  }

  async init(options?: {
    masterPassword?: string;
    skipServerDownload?: boolean;
    queryClient?: unknown;
  }): Promise<void> {
    if (options?.queryClient) {
      this.capturedQueryClient = options.queryClient as QueryClientLike;
    }
    await this.coordinator.init({
      masterPassword: options?.masterPassword,
      skipServerDownload: options?.skipServerDownload,
      queryClient: options?.queryClient as unknown as QueryClientLike | undefined,
    });

    // Initialize services with the now-active database
    await this.initializeServices();
  }

  isInitialized(): boolean {
    return this.coordinator.isInitialized();
  }

  servicesReady(): boolean {
    return this.serviceManager.isInitialized();
  }

  state(): RuntimeState {
    return this.coordinator.state;
  }

  onStateChange(listener: (next: RuntimeState, prev: RuntimeState) => void): () => void {
    return this.coordinator.onStateChange(listener);
  }

  destroy(): void {
    this.coordinator.destroy();
    try {
      this.serviceManager.reset();
    } catch {
      /* no-op */
    }
    this._mutationsShim = null;
  }

  services(): Services {
    return this.serviceManager.getServices();
  }

  mutationsRouter(): MutationRouter {
    if (!this._mutationsShim) {
      this._mutationsShim = new MutationRouter();
    }
    return this._mutationsShim;
  }

  async executeMutation<T>(spec: MutationSpec): Promise<MutationResult<T>> {
    const result = await this.coordinator.executeMutation<T>(spec);
    await this.applyContinuousRulesIfNeeded(result.result, spec, !spec.mutationId);
    return result;
  }

  getDatabase(): WebDatabaseInstance | null {
    return this.coordinator.getDatabase() as WebDatabaseInstance | null;
  }

  getActiveSpaceId(): string | null {
    return this.coordinator.getActiveSpaceId();
  }

  async switchSpace(
    spaceId: string,
    options?: { skipServerDownload?: boolean; forceSnapshotDownload?: boolean }
  ): Promise<void> {
    try {
      await this.coordinator.switchSpace(spaceId, options);
    } catch (error) {
      // A restored/imported DB from a newer app build — migrations refuse to
      // touch it (DatabaseNewerThanAppError); block and prompt for an update.
      if ((error as { code?: string })?.code === 'DB_NEWER_THAN_APP') {
        const { notifyUpdateRequired } = await import('@shared/lib/update-required');
        notifyUpdateRequired('database-newer-than-app');
      }
      throw error;
    }
    await this.initializeServices();
  }

  listSpaces(): BudgetSpaceSummary[] {
    return this.coordinator.spaceRegistry.listSpaces();
  }

  onActiveSpaceChange(listener: (spaceId: string | null) => void): () => void {
    return this.coordinator.spaceRegistry.onActiveSpaceChange(listener);
  }

  onAvailableSpacesChange(listener: () => void): () => void {
    return this.coordinator.spaceRegistry.onAvailableSpacesChange(listener);
  }

  async refreshSpaces(): Promise<void> {
    await this.coordinator.refreshSpaces();
    // Re-bind services to whatever database is now active, with the same
    // build-then-swap as init/switchSpace. The old reset-then-initialize
    // here reopened the null-services window during invite redeems; the
    // shared path also skips the rebuild when the DB instance is unchanged.
    await this.initializeServices();
  }

  getEncryption(): RuntimeEncryption | null {
    return this.coordinator.getEncryption();
  }

  exportSpaceKey(): string | null {
    return this.coordinator.exportSpaceKey();
  }

  async requireSpaceKey(spaceId: string): Promise<Uint8Array> {
    return this.coordinator.requireSpaceKey(spaceId);
  }

  incrementEncryptionKeyVersion(): Promise<number> {
    return this.coordinator.incrementEncryptionKeyVersion();
  }

  /**
   * Re-encrypt local OPFS persistence under a new master password and keep
   * this session's future activations on the new cipher.
   */
  rekeyLocalPersistence(masterPassword: string): Promise<boolean> {
    return this.coordinator.rekeyLocalPersistence(masterPassword);
  }

  /** Tell this user's OTHER devices the master password changed. */
  notifyMasterPasswordChanged(): void {
    this.coordinator.notifyMasterPasswordChanged();
  }

  sendMutation(payload: {
    id: string;
    op: string;
    args: Record<string, unknown>;
    spaceId?: string;
  }): Promise<boolean> {
    return this.coordinator.sendMutation(payload);
  }

  async waitForInitialSync(options?: {
    timeoutMs?: number;
  }): Promise<{ synced: boolean; timedOut: boolean; connected: boolean }> {
    return await (
      this.coordinator as unknown as {
        waitForInitialSync(options?: {
          timeoutMs?: number;
        }): Promise<{ synced: boolean; timedOut: boolean; connected: boolean }>;
      }
    ).waitForInitialSync(options);
  }

  /** Expose the coordinator's ConnectivityMonitor for getConnectivityService() */
  getConnectivityMonitor() {
    return this.coordinator.connectivity;
  }

  connectivityState(): ConnectivityState {
    return this.coordinator.connectivity.getState();
  }

  onConnectivityChange(listener: (state: ConnectivityState) => void): () => void {
    return this.coordinator.connectivity.addListener(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    return this.coordinator.onConnectionChange(listener);
  }

  onSyncStatus(listener: (status: SyncStatus) => void): () => void {
    return this.coordinator.onSyncStatus(listener);
  }

  onOverlayChange(listener: (phase: 'syncing' | 'success' | 'hidden') => void): () => void {
    return this.coordinator.onOverlayChange(listener);
  }

  async save(options?: { outOfBand?: boolean }): Promise<void> {
    await this.coordinator.save(options);
  }

  async downloadLatest(): Promise<void> {
    await this.coordinator.downloadLatest();
  }

  /** Current mutation-log cursor of the active space (undefined when none). */
  getSyncCursor(): number | undefined {
    return this.coordinator.getSyncCursor();
  }

  /**
   * The active DB was replaced out-of-band (password-change restore etc.):
   * runs the restore invariant (cursor reseed, dedup reset, queue re-apply).
   */
  async notifyOutOfBandRestore(boundMutationVersion?: number): Promise<void> {
    await this.coordinator.notifyOutOfBandRestore(boundMutationVersion);
  }

  /**
   * Finalize a bulk/out-of-band DB mutation path (restore/import/direct SQL):
   * upload a fresh snapshot and reseed the mutation cursor from authoritative
   * server state. When the server state is unavailable (transient failure),
   * the cursor is left untouched — never cleared, which would trigger a
   * full-log replay onto a populated DB.
   */
  async finalizeOutOfBandMutation(options?: {
    uploadSnapshot?: boolean;
  }): Promise<{ blobVersion?: number; mutationVersion?: number }> {
    if (options?.uploadSnapshot !== false) {
      try {
        // Flagged out-of-band: this blob's content is NOT in the mutation
        // log, so the server relays the flag and other connected devices
        // download the snapshot instead of waiting for a catch-up that
        // will never carry it.
        await this.save({ outOfBand: true });
      } catch (error) {
        console.warn('[AppRuntime] Failed snapshot upload during out-of-band finalization', error);
      }
    }

    return await (
      this.coordinator as unknown as {
        reseedSyncStateFromServer(): Promise<{ blobVersion?: number; mutationVersion?: number }>;
      }
    ).reseedSyncStateFromServer();
  }

  getQueryClient(): QueryClient | undefined {
    return this.coordinator.getQueryClient() as QueryClient | undefined;
  }

  async processPushQueue(): Promise<{ processed: number; failed: number }> {
    const activeSpaceId = this.getActiveSpaceId();
    if (!activeSpaceId) return { processed: 0, failed: 0 };

    if (this.pushQueueProcessingInProgress) {
      return { processed: 0, failed: 0 };
    }

    this.pushQueueProcessingInProgress = true;
    const currentSpaceId = activeSpaceId;
    let processed = 0;
    let failed = 0;

    const recordFailedMutation = (
      itemId: string,
      op: string,
      payload: Record<string, unknown>,
      errorCode: MutationErrorCode,
      errorMessage: string
    ) => {
      try {
        const services = this.services();
        if (!services?.mutationHistory) return;
        let budgetId = 0;
        try {
          const budgets = services.budgets?.getAllBudgets(currentSpaceId);
          if (budgets && budgets.length > 0) {
            budgetId = budgets[0].ID;
          }
        } catch {
          /* no-op */
        }
        if (budgetId <= 0) {
          const p = payload as PayloadWithBudgetId;
          budgetId = Number(p.budgetId ?? p.budget_id ?? p.BudgetID ?? 0);
        }
        if (budgetId > 0) {
          services.mutationHistory.record({
            budgetId,
            spaceId: currentSpaceId,
            mutationId: `push-failed-${itemId}`,
            userId: null,
            op,
            payload,
            origin: 'remote',
            undoOps: null,
            redoOps: null,
            status: 'failed',
            errorCode,
            errorMessage,
          });
        }
      } catch (historyError) {
        console.warn('[AppRuntime] Failed to record push failure to history', historyError);
      }
    };

    try {
      const { pushApi } = await import('@shared/api/api-client');
      const { items } = await pushApi.getQueue(currentSpaceId);

      if (!items?.length) {
        return { processed: 0, failed: 0 };
      }

      for (const item of items) {
        let parsedOp: string | undefined;
        let parsedArgs: Record<string, unknown> | undefined;

        try {
          const encryption = this.getEncryption();
          if (!encryption) {
            recordFailedMutation(
              item.id,
              'push.import',
              {},
              'DECRYPTION_FAILED',
              'No encryption context available. Please re-open your budget.'
            );
            await pushApi.ackQueueItem(item.id, 'failed');
            failed++;
            continue;
          }

          let decryptedPayload: { op: string; args: Record<string, unknown> };
          try {
            decryptedPayload = await encryption.decryptMutation(item.encrypted_payload);
          } catch (decryptError) {
            console.warn('[AppRuntime] Failed to decrypt push payload', {
              id: item.id,
              decryptError,
            });
            recordFailedMutation(
              item.id,
              'push.import',
              {},
              'DECRYPTION_FAILED',
              'Failed to decrypt payload. Check your encryption key matches the one used to encrypt.'
            );
            await pushApi.ackQueueItem(item.id, 'failed');
            failed++;
            continue;
          }

          if (!decryptedPayload || typeof decryptedPayload !== 'object') {
            recordFailedMutation(
              item.id,
              'push.import',
              {},
              'INVALID_PAYLOAD',
              'Decrypted payload is not a valid object.'
            );
            await pushApi.ackQueueItem(item.id, 'failed');
            failed++;
            continue;
          }

          // Normalize to the current wire format, exactly like the WebSocket
          // sync path: legacy (v1) payloads get their float money args
          // upgraded to integer milliunits; payloads from a newer format are
          // rejected so we don't execute args we'd misinterpret.
          let op: string | undefined;
          let args: Record<string, unknown> | undefined;
          try {
            ({ op, args } = normalizeMutationPayload(
              decryptedPayload as { v?: number; op: string; args: Record<string, unknown> }
            ));
          } catch (formatError) {
            if (formatError instanceof FormatTooNewError) {
              recordFailedMutation(
                item.id,
                'push.import',
                {},
                'INVALID_PAYLOAD',
                `Payload uses data format v${formatError.receivedVersion}, newer than this app supports. Update the app.`
              );
              notifyUpdateRequired('push-payload-newer-than-app');
              await pushApi.ackQueueItem(item.id, 'failed');
              failed++;
              continue;
            }
            throw formatError;
          }
          parsedOp = op;
          parsedArgs = args;

          if (!op || typeof op !== 'string') {
            recordFailedMutation(
              item.id,
              'push.import',
              args || {},
              'INVALID_PAYLOAD',
              'Payload missing required "op" field.'
            );
            await pushApi.ackQueueItem(item.id, 'failed');
            failed++;
            continue;
          }

          const invalidates = getInvalidatesForOp(op);

          // Deterministic ID derived from the queue item: processing is
          // at-least-once (ack only after execution), so a crash before the
          // ack re-runs the item — a fresh random ID each attempt would
          // defeat the server's UNIQUE(space_id, id) dedup and duplicate the
          // mutation on every device. Locally, an already-applied id is
          // acked without re-executing.
          const mutationId = `pushq_${item.id}`;
          if (this.coordinator.isMutationApplied(mutationId)) {
            await pushApi.ackQueueItem(item.id, 'processed');
            processed++;
            continue;
          }

          await this.executeMutation({
            op,
            payload: args || {},
            spaceId: currentSpaceId,
            // idempotencyKey (not mutationId) keeps mutator semantics —
            // the mutation must still be queued and broadcast to the space.
            idempotencyKey: mutationId,
            meta: {
              skipUndo: false,
              label: 'push-api',
              origin: 'remote',
              forceInvalidate: true,
            },
            invalidates,
          });

          await pushApi.ackQueueItem(item.id, 'processed');
          processed++;
        } catch (itemError) {
          console.error(`[AppRuntime] Failed to process push queue item: ${item.id}`, itemError);
          const errorMessage = getErrorMessage(itemError, String(itemError));
          recordFailedMutation(
            item.id,
            parsedOp || 'push.import',
            parsedArgs || {},
            'MUTATION_ERROR',
            errorMessage
          );
          failed++;
          try {
            await pushApi.ackQueueItem(item.id, 'failed');
          } catch {
            /* no-op */
          }
        }
      }
    } catch (error) {
      console.warn('[AppRuntime] Failed to process push queue', error);
    } finally {
      this.pushQueueProcessingInProgress = false;
    }

    return { processed, failed };
  }

  private async applyContinuousRulesIfNeeded(
    result: unknown,
    spec: MutationSpec,
    isMutator: boolean
  ): Promise<void> {
    if (!isMutator) return;
    const isTransactionAdd = spec.op === 'transactions.add';
    const isRecurringReady = spec.op === 'recurring.markReady';

    if (!isTransactionAdd && !isRecurringReady) return;

    let transactionId: number | null = null;
    let budgetId: number | null = null;

    if (isTransactionAdd) {
      transactionId = Number(result);
      budgetId = Number((spec.payload as PayloadWithBudgetId)?.budgetId);
    } else if (isRecurringReady) {
      const ready = result as MarkOccurrenceReadyResult;
      transactionId = Number(ready?.transactionId);
      budgetId = Number(
        ready?.occurrence?.template?.budgetId ?? ready?.occurrence?.budgetId ?? undefined
      );
      if (!Number.isFinite(budgetId)) {
        budgetId = Number((spec.payload as PayloadWithBudgetId)?.budgetId);
      }
    }

    if (!Number.isFinite(transactionId) || budgetId === null || !Number.isFinite(budgetId)) {
      return;
    }

    try {
      const services = this.serviceManager.getServices();
      if (!services) return;

      let rules: TransactionRule[] = [];
      try {
        rules = services.rules.listRules(budgetId);
      } catch (error) {
        console.warn('[AppRuntime] Unable to load rules for continuous run', error);
        return;
      }

      const continuousRules = rules
        .filter((rule) => rule.enabled && rule.mode === 'continuous')
        .sort((a, b) => a.runOrder - b.runOrder || a.id - b.id);

      if (continuousRules.length === 0) {
        return;
      }

      const invalidates = getInvalidatesForOp('rules.execute');

      for (const rule of continuousRules) {
        try {
          await this.executeMutation({
            op: 'rules.execute',
            payload: {
              ruleId: rule.id,
              options: {
                trigger: 'continuous',
                transactionIds: [transactionId],
              },
            },
            invalidates,
            meta: { skipUndo: true, forceInvalidate: true },
          });
        } catch (error) {
          console.warn('[AppRuntime] Failed to run continuous rule', {
            ruleId: rule.id,
            transactionId,
            error,
          });
        }
      }
    } catch (error) {
      console.warn('[AppRuntime] Unexpected error running continuous rules', error);
    }
  }

  private resolveHistoryBudgetId(context: MutationBudgetResolutionContext): number | null {
    const services = this.getServicesSafe();
    if (!services) {
      return null;
    }

    const { payload } = context;
    const fromPayload = this.extractBudgetIdFromPayload(payload);
    if (fromPayload !== null) {
      return fromPayload;
    }

    const fromEntity = this.resolveBudgetIdFromEntityLookup(services, context.op, payload);
    if (fromEntity !== null) {
      return fromEntity;
    }

    const spaceBudgets = services.budgets
      .getAllBudgets(context.spaceId)
      .map((budget) => this.normalizeBudgetId(budget.ID))
      .filter((id): id is number => id !== null);
    if (spaceBudgets.length > 0) {
      return spaceBudgets[0];
    }

    const anyBudget = services.budgets
      .getAllBudgets()
      .map((budget) => this.normalizeBudgetId(budget.ID))
      .find((id): id is number => id !== null);
    return anyBudget ?? null;
  }

  private resolveBudgetIdFromEntityLookup(
    services: Services,
    op: string,
    payload: Record<string, unknown>
  ): number | null {
    const transactionId = this.findFirstNumeric(payload, ['transactionId', 'id']);
    const accountId = this.findFirstNumeric(payload, ['accountId', 'newAccountId']);
    const categoryId = this.findFirstNumeric(payload, [
      'categoryId',
      'newCategoryId',
      'oldCategoryId',
    ]);
    const categoryGroupId = this.findFirstNumeric(payload, [
      'groupId',
      'newGroupId',
      'sourceGroupId',
      'targetGroupId',
    ]);
    const categoryGroupIdWithId = this.findFirstNumeric(payload, [
      'groupId',
      'newGroupId',
      'sourceGroupId',
      'targetGroupId',
      'id',
    ]);
    const ruleId = this.findFirstNumeric(payload, ['ruleId', 'id']);
    const recurringId = this.findFirstNumeric(payload, ['id', 'templateId']);
    const occurrenceId = this.findFirstNumeric(payload, ['occurrenceId']);
    const genericId = this.findFirstNumeric(payload, ['id']);
    const conversationId = this.findFirstNumeric(payload, ['conversationId']);
    const messageId = this.findFirstNumeric(payload, ['messageId', 'id']);

    const byTransactionId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.transactions.getTransactionByID(id).BudgetID);
      } catch {
        return null;
      }
    };

    const byAccountId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.accounts.getAccount(id).BudgetID);
      } catch {
        return null;
      }
    };

    const byCategoryId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.categories.getCategory(id).BudgetID);
      } catch {
        return null;
      }
    };

    const byCategoryGroupId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.categories.getCategoryGroup(id).BudgetID);
      } catch {
        return null;
      }
    };

    const byRuleId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.rules.getRule(id).budgetId);
      } catch {
        return null;
      }
    };

    const byRecurringTemplateId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(
          services.recurring.getRecurringTransaction(id, { includeInactive: true }).budgetId
        );
      } catch {
        return null;
      }
    };

    const byRecurringOccurrenceId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.recurring.getOccurrenceWithTemplate(id).budgetId);
      } catch {
        return null;
      }
    };

    const byImportRunId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.importHistory.getImportRun(id)?.budgetId);
      } catch {
        return null;
      }
    };

    const byWarrantyId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.warranties.getById(id)?.BudgetID);
      } catch {
        return null;
      }
    };

    const byConversationId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.chat.getConversation(id)?.BudgetID);
      } catch {
        return null;
      }
    };

    const byMessageId = (id: number | null): number | null => {
      if (id === null) return null;
      try {
        return this.normalizeBudgetId(services.chat.getMessage(id)?.BudgetID);
      } catch {
        return null;
      }
    };

    if (op.startsWith('transactions.')) {
      return (
        byTransactionId(transactionId) ??
        byAccountId(accountId) ??
        byCategoryId(categoryId) ??
        byCategoryGroupId(categoryGroupId)
      );
    }
    if (op.startsWith('accounts.')) {
      return byAccountId(accountId);
    }
    if (op.startsWith('categories.')) {
      return byCategoryId(categoryId ?? this.findFirstNumeric(payload, ['id']));
    }
    if (op.startsWith('categoryGroups.')) {
      return byCategoryGroupId(categoryGroupIdWithId);
    }
    if (op.startsWith('rules.')) {
      return byRuleId(ruleId);
    }
    if (op.startsWith('recurring.')) {
      return byRecurringTemplateId(recurringId) ?? byRecurringOccurrenceId(occurrenceId);
    }
    if (op.startsWith('importHistory.')) {
      return byImportRunId(genericId);
    }
    if (op.startsWith('warranties.')) {
      return byWarrantyId(genericId);
    }
    if (op.startsWith('chat.')) {
      return byConversationId(conversationId) ?? byMessageId(messageId);
    }

    return null;
  }

  private extractBudgetIdFromPayload(payload: Record<string, unknown>): number | null {
    const direct = this.findFirstNumeric(payload, ['budgetId', 'budget_id', 'BudgetID']);
    if (direct !== null) return direct;

    const { input } = payload;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      return this.findFirstNumeric(input as Record<string, unknown>, [
        'budgetId',
        'budget_id',
        'BudgetID',
      ]);
    }

    return null;
  }

  private findFirstNumeric(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const value = source[key];
      const normalized = this.normalizeBudgetId(value);
      if (normalized !== null) {
        return normalized;
      }
    }
    return null;
  }

  private normalizeBudgetId(value: unknown): number | null {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.trunc(parsed);
  }

  private getServicesSafe(): Services | null {
    try {
      return this.serviceManager.getServices();
    } catch {
      return null;
    }
  }

  private async initializeServices(): Promise<void> {
    const db = this.coordinator.getDatabase();
    if (!db) {
      this.serviceManager.reset();
      return;
    }

    // Already bound to this exact DB instance — nothing to rebuild. init()
    // and switchSpace() both funnel here, so back-to-back calls are common.
    try {
      if (
        this.serviceManager.isInitialized() &&
        this.serviceManager.getDatabase() === (db as unknown as CoreDatabaseAdapter)
      ) {
        return;
      }
    } catch {
      /* not initialized — build below */
    }

    // Build the new services FIRST, then swap atomically. The old
    // reset-then-initialize order left services null while migrations ran —
    // any query landing in that window (e.g. the budgets gate right after a
    // workspace switch) threw 'Services not initialized', which react-query
    // swallowed after its retries, leaving the app stuck on a loading gate.
    const next = new ServiceManager();
    await next.initialize(db as unknown as CoreDatabaseAdapter);
    this.serviceManager.reset();
    this.serviceManager = next;
  }
}

export default AppRuntime;
