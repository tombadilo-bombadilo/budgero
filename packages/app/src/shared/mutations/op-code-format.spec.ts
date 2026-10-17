/**
 * Mixed-version sync: every op code needs a mutation format, and ops added
 * after v1.18 must carry a format v1.18 devices reject — they then stop with
 * "update required" instead of quarantining the op and silently diverging.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_MUTATION_FORMAT_VERSION,
  isUpdateRequiredError,
  MUTATION_FORMAT_VERSION,
  mutationFormatVersion,
  normalizeMutationPayload,
  OP_CODE_FORMAT_VERSIONS,
  opCodeFormatVersion,
  UnknownOpCodeError,
} from '@budgero/runtime';
import { APPLY_OPS, executeMutationOp, KNOWN_OP_CODES } from './op-code-registry';

/** Highest mutation format v1.18.0 and earlier read; they reject anything newer. */
const V1_18_MAX_FORMAT = 2;

/** Op codes in the v1.18.0 registry (frozen: never add to this list). */
const V1_18_OP_CODES = new Set([
  'accounts.create',
  'accounts.delete',
  'accounts.reorder',
  'accounts.setArchived',
  'accounts.update',
  'bankSync.addReviews',
  'bankSync.deleteConnection',
  'bankSync.deleteLink',
  'bankSync.recordSync',
  'bankSync.removeEnableBankingSession',
  'bankSync.saveConnection',
  'bankSync.saveEnableBankingConnection',
  'bankSync.saveEnableBankingSession',
  'bankSync.saveLink',
  'bankSync.setReviewStatus',
  'bankSync.updateLinkSettings',
  'budgets.create',
  'budgets.delete',
  'budgets.insertDefaultCategories',
  'budgets.updateCurrency',
  'budgets.updateGoalFundingSettings',
  'budgets.updateIcon',
  'budgets.updateName',
  'budgets.updateNumberFormat',
  'budgets.updateRtaMode',
  'categories.create',
  'categories.delete',
  'categories.moveToNewGroup',
  'categories.reorder',
  'categories.updateDetails',
  'categories.updateExcludeFromBudgetPace',
  'categories.updateFundingPriorities',
  'categories.updateName',
  'categories.updateNote',
  'categoryGroups.create',
  'categoryGroups.delete',
  'categoryGroups.reorder',
  'categoryGroups.update',
  'chat.addMessage',
  'chat.archiveConversation',
  'chat.createConversation',
  'chat.deleteConversation',
  'chat.deleteMessage',
  'chat.updateConversationTitle',
  'chat.updateSettings',
  'currency.customRates.add',
  'currency.customRates.delete',
  'currency.customRates.update',
  'customDashboardWidgets.add',
  'customDashboardWidgets.delete',
  'customDashboardWidgets.reorder',
  'customDashboardWidgets.update',
  'customDashboards.create',
  'customDashboards.delete',
  'customDashboards.reorder',
  'customDashboards.update',
  'goals.create',
  'goals.delete',
  'goals.update',
  'importHistory.delete',
  'importHistory.match',
  'importHistory.record',
  'importHistory.undo',
  'labels.add',
  'labels.delete',
  'labels.update',
  'llmSettings.delete',
  'llmSettings.update',
  'monthlyBudgets.batchUpsertAssignments',
  'monthlyBudgets.reassignAssignment',
  'monthlyBudgets.updateAssignment',
  'monthlyBudgets.upsertAssignment',
  'payees.add',
  'payees.delete',
  'payees.deleteMany',
  'payees.rename',
  'recurring.create',
  'recurring.delete',
  'recurring.markNotified',
  'recurring.markReady',
  'recurring.resetOccurrence',
  'recurring.skip',
  'recurring.update',
  'reports.addChart',
  'reports.create',
  'reports.delete',
  'reports.duplicate',
  'reports.removeChart',
  'reports.toggleFavorite',
  'reports.update',
  'reports.updateChart',
  'rules.create',
  'rules.delete',
  'rules.execute',
  'rules.logAutofillApplication',
  'rules.restore',
  'rules.undoRun',
  'rules.update',
  'scenarios.delete',
  'scenarios.save',
  'transactions.add',
  'transactions.addTransfer',
  'transactions.clearSplits',
  'transactions.delete',
  'transactions.deleteBatch',
  'transactions.deleteByRef',
  'transactions.deleteTransfer',
  'transactions.duplicate',
  'transactions.import',
  'transactions.moveToNewAccount',
  'transactions.moveToNewCategory',
  'transactions.reassign',
  'transactions.reconcile',
  'transactions.reconcileCleared',
  'transactions.restoreBatch',
  'transactions.setCleared',
  'transactions.unreconcile',
  'transactions.updateByRef',
  'transactions.updateColumn',
  'transactions.updateTransferRate',
  'transactions.upsertLiabilityStarts',
  'transactions.upsertSplits',
  'userPreferences.setAllowOverAssignment',
  'userPreferences.setCompactTransactionRows',
  'userPreferences.setDialogBackgroundBlur',
  'userPreferences.setDuplicateHintSettings',
  'userPreferences.setHideZeroAmounts',
  'userPreferences.setInlineTransactionEntry',
  'userPreferences.setPlanningNumberAnimations',
  'userPreferences.setSameDayTransactionOrder',
  'userPreferences.setShowGroupPercent',
  'userPreferences.setSuggestCategoryFromPayee',
  'userPreferences.setWeekStartsOn',
  'warranties.create',
  'warranties.delete',
  'warranties.update',
]);

describe('op code formats', () => {
  it('every op v1.18 knows stays at the base format, so v1.18 devices keep applying it', () => {
    for (const op of V1_18_OP_CODES) {
      expect(KNOWN_OP_CODES.has(op), op).toBe(true);
      expect(opCodeFormatVersion(op), op).toBe(BASE_MUTATION_FORMAT_VERSION);
    }
    expect(BASE_MUTATION_FORMAT_VERSION).toBeLessThanOrEqual(V1_18_MAX_FORMAT);
  });

  it('every op added since v1.18 has a format v1.18 devices reject', () => {
    const added = [...KNOWN_OP_CODES].filter((op) => !V1_18_OP_CODES.has(op)).sort();
    expect(added.length).toBeGreaterThan(0);
    for (const op of added) {
      const format = opCodeFormatVersion(op);
      expect(format, `${op} needs an entry in OP_CODE_FORMAT_VERSIONS`).toBeGreaterThan(
        V1_18_MAX_FORMAT
      );
      expect(format, op).toBeLessThanOrEqual(MUTATION_FORMAT_VERSION);
    }
  });

  it('lists only op codes that exist', () => {
    for (const op of Object.keys(OP_CODE_FORMAT_VERSIONS)) {
      expect(KNOWN_OP_CODES.has(op), op).toBe(true);
    }
  });

  it('a multi-step undo needs the format of its newest step', () => {
    expect(
      mutationFormatVersion(APPLY_OPS, { ops: [{ op: 'transactions.update', args: {} }] })
    ).toBeGreaterThan(V1_18_MAX_FORMAT);
    expect(mutationFormatVersion('transactions.update', {})).toBe(BASE_MUTATION_FORMAT_VERSION);
  });

  it('this build reads every format it writes', () => {
    for (const op of KNOWN_OP_CODES) {
      const v = mutationFormatVersion(op, {});
      expect(() => normalizeMutationPayload({ v, op, args: {} }), op).not.toThrow();
    }
  });
});

describe('unknown op codes', () => {
  it('reject with an update-required error, not a generic failure', async () => {
    const error = await executeMutationOp('futureDomain.newOp', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnknownOpCodeError);
    expect(isUpdateRequiredError(error)).toBe(true);
    expect((error as Error).message).toBe('Unknown mutation op code: futureDomain.newOp');
  });

  it('inside a multi-step op reject the same way', async () => {
    const error = await executeMutationOp(APPLY_OPS, {
      ops: [{ op: 'futureDomain.newOp', args: {} }],
    }).catch((e: unknown) => e);
    expect(isUpdateRequiredError(error)).toBe(true);
  });
});
