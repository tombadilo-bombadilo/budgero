/**
 * runtime-bridge.ts — Factory that wires app-specific dependencies
 * into RuntimeCoordinatorDeps for the @budgero/runtime package.
 *
 * This is the ONLY file that knows about both the runtime package
 * and the app-specific modules (API client, op-code-registry, etc.).
 */

import type {
  RuntimeCoordinatorDeps,
  WebDatabaseInstance as RuntimeWebDatabaseInstance,
} from '@budgero/runtime';
import {
  executeMutationOp,
  getUndoSpec,
  getInvalidatesForOp,
} from '@shared/mutations/op-code-registry';
import {
  MigrationRunner as CoreMigrationRunner,
  getMaxSupportedSchemaVersion,
} from '@budgero/core/browser';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useUndoStore } from '@shared/mutations/UndoStore';

type MigrationDatabase = ConstructorParameters<typeof CoreMigrationRunner>[0];

const OPFS_FLAVOR_SUFFIX = IS_SELF_HOSTABLE_BUILD ? '_self_host' : '_sas';

function detectE2E(): boolean {
  if (IS_SELF_HOSTABLE_BUILD) return false;
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('budgero_e2e_skip_server') === '1'
    ) {
      return true;
    }
  } catch {
    /* no-op */
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_E2E_SKIP_SERVER === 'true') {
      return true;
    }
  } catch {
    /* no-op */
  }
  return false;
}

/**
 * Create base RuntimeCoordinatorDeps from app modules.
 * The AppRuntime wrapper adds late-bound deps (recordHistory, getQueryClient)
 * after ServiceManager is available.
 */
export function createRuntimeDeps(): RuntimeCoordinatorDeps {
  return {
    // Every runtime restore path (reconnect downloadLatest, 409 conflict
    // retry, catch-up recovery) funnels through DatabaseLoader — without
    // this runner those paths silently skipped schema migrations, so a blob
    // from an older app version ran against a stale schema until the next
    // full activation, and a NEWER blob bypassed the hard-stop guard.
    migrationRunner: {
      needsMigration(db) {
        const runner = new CoreMigrationRunner(db as unknown as MigrationDatabase);
        // A newer-than-app schema must reach runMigrations' hard stop
        // (DatabaseNewerThanAppError) instead of reading as "up to date".
        return (
          runner.needsMigration() || runner.getCurrentVersion() > getMaxSupportedSchemaVersion()
        );
      },
      runMigrations(db) {
        new CoreMigrationRunner(db as unknown as MigrationDatabase).runMigrations();
      },
    },

    async getToken() {
      const { getGlobalToken } = await import('@shared/lib/clerk-token-manager');
      return getGlobalToken();
    },

    async checkApiHealth() {
      const { checkApiHealth } = await import('@shared/api/health');
      return checkApiHealth();
    },

    async uploadBlob(spaceId, data, version, keyVersion, mutationVersion, outOfBand) {
      const { blobApi } = await import('@shared/api/api-client');
      return blobApi.uploadBlob(spaceId, data, version, keyVersion, mutationVersion, outOfBand);
    },

    async downloadBlob(spaceId) {
      const { blobApi } = await import('@shared/api/api-client');
      return blobApi.downloadBlob(spaceId);
    },

    async hasLocalDatabase(path) {
      try {
        if (!path) return false;
        if (!navigator.storage || !navigator.storage.getDirectory) return false;
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.getFileHandle(path, { create: false });
        return true;
      } catch {
        return false;
      }
    },

    async getDatabaseState(spaceId) {
      const { blobApi } = await import('@shared/api/api-client');
      return blobApi.getState(spaceId);
    },

    async getProfile() {
      const { authApi } = await import('@shared/api/api-client');
      const profile = await authApi.getProfile();
      if (!profile || typeof profile !== 'object') {
        return null;
      }
      return profile as { primary_space_id?: string };
    },

    async listSpaces() {
      const { spaceApi } = await import('@shared/api/api-client');
      const spaces = await spaceApi.listSpaces();
      return Array.isArray(spaces) ? spaces : [];
    },

    async uploadEncryptedKey(spaceId, wrappedKey) {
      const { spaceApi } = await import('@shared/api/api-client');
      await spaceApi.updateEncryptedKey(spaceId, wrappedKey);
    },

    async cleanupStaleSpaceDatabases(spaceIds, opts) {
      const { WebDatabaseAdapter } = await import('@budgero/core/browser');
      if (typeof WebDatabaseAdapter.cleanupStaleSpaceDatabases === 'function') {
        await WebDatabaseAdapter.cleanupStaleSpaceDatabases(spaceIds, opts);
      }
    },

    async cleanupDatabaseFile(path) {
      const { WebDatabaseAdapter } = await import('@budgero/core/browser');
      await WebDatabaseAdapter.cleanupDatabaseFile(path);
    },

    async createDatabase(data, opts) {
      const { WebDatabaseAdapter } = await import('@budgero/core/browser');
      const db = await WebDatabaseAdapter.create(data, opts);
      const coreDb = db as unknown as {
        backup: () => Uint8Array | Promise<Uint8Array>;
        restore: (bytes: Uint8Array) => void | Promise<void>;
      };
      const backup = coreDb.backup.bind(coreDb);
      const restore = coreDb.restore.bind(coreDb);
      const runtimeDb = db as unknown as RuntimeWebDatabaseInstance;
      runtimeDb.backup = async () => Promise.resolve(backup());
      runtimeDb.restore = async (bytes) => {
        await Promise.resolve(restore(bytes));
      };
      return runtimeDb;
    },

    async executeOp(op, payload) {
      return executeMutationOp(op, payload);
    },

    getUndoSpec(op) {
      return getUndoSpec(op);
    },

    getInvalidatesForOp(op) {
      return getInvalidatesForOp(op);
    },

    pushUndo(entry) {
      try {
        useUndoStore.getState().push({
          id: entry.id,
          label: entry.label,
          undo: entry.undo,
          redo: entry.redo,
          ts: entry.ts,
        });
      } catch {
        /* no-op */
      }
    },

    clearUndo() {
      try {
        useUndoStore.getState().clear();
      } catch {
        /* no-op */
      }
    },

    onAnalyticsEvent(op: string) {
      import('@shared/lib/analytics/analytics')
        .then(
          ({
            trackTransactionLogged,
            trackTransactionEdited,
            trackTransactionDeleted,
            trackAccountAdded,
            trackAssignmentUpserted,
            trackCategoryAdded,
            trackCategoryEdited,
            trackCategoryDeleted,
            trackCategoryGroupAdded,
            trackCategoryGroupEdited,
            trackCategoryGroupDeleted,
          }) => {
            switch (op) {
              case 'transactions.add':
                trackTransactionLogged();
                break;
              case 'transactions.updateColumn':
                trackTransactionEdited();
                break;
              case 'transactions.delete':
                trackTransactionDeleted();
                break;
              case 'accounts.create':
                trackAccountAdded();
                break;
              case 'categories.create':
                trackCategoryAdded();
                break;
              case 'categories.updateName':
                trackCategoryEdited();
                break;
              case 'categories.delete':
                trackCategoryDeleted();
                break;
              case 'categoryGroups.create':
                trackCategoryGroupAdded();
                break;
              case 'categoryGroups.update':
                trackCategoryGroupEdited();
                break;
              case 'categoryGroups.delete':
                trackCategoryGroupDeleted();
                break;
              case 'monthlyBudgets.upsertAssignment':
                trackAssignmentUpserted();
                break;
            }
          }
        )
        .catch(() => {});
    },

    // recordHistory and getQueryClient are set by AppRuntime after ServiceManager init

    syncTransportPolicy: {
      onFormatTooNew: () => {
        void import('@shared/lib/update-required').then(({ notifyUpdateRequired }) =>
          notifyUpdateRequired('sync-format-too-new')
        );
      },
    },

    isSelfHostable: IS_SELF_HOSTABLE_BUILD,
    isE2E: detectE2E(),
    opfsSuffix: OPFS_FLAVOR_SUFFIX,
  };
}
