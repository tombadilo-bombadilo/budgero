import type { DuplicateHintSettings } from '@budgero/core/browser';
import { S, safeCapture, type OpCodeEntry } from '../shared';

type UserMetaGetter =
  | 'getWeekStartsOn'
  | 'getAllowOverAssignment'
  | 'getSuggestCategoryFromPayee'
  | 'getShowGroupPercent'
  | 'getPlanningNumberAnimations'
  | 'getDialogBackgroundBlur'
  | 'getHideZeroAmounts'
  | 'getInlineTransactionEntry';

/** Undo for single-value preference setters: re-issue the op with the old value. */
function preferenceUndo(op: string, getter: UserMetaGetter): NonNullable<OpCodeEntry['undo']> {
  return {
    capture: async () => safeCapture(() => S().userMeta[getter]()),
    build: (_args, _result, before) =>
      before === null || before === undefined ? [] : [{ op, args: { value: before } }],
  };
}

export const userPreferenceOps = {
  'userPreferences.setDuplicateHintSettings': {
    execute: async (args) => {
      const services = S() as {
        userMeta?: { setDuplicateHintSettings(patch: Partial<DuplicateHintSettings>): void };
      };
      if (!services.userMeta) throw new Error('userMeta service not available');
      services.userMeta.setDuplicateHintSettings(args.settings as Partial<DuplicateHintSettings>);
      return { success: true };
    },
    invalidates: [['duplicateHintSettings'], ['userPreferences']],
    undo: {
      capture: async () => safeCapture(() => S().userMeta.getDuplicateHintSettings()),
      build: (_args, _result, before) =>
        before
          ? [{ op: 'userPreferences.setDuplicateHintSettings', args: { settings: before } }]
          : [],
    },
  },
  'userPreferences.setWeekStartsOn': {
    execute: async (args) => {
      const services = S() as { userMeta?: { setWeekStartsOn(value: 0 | 1): void } };
      if (!services.userMeta) throw new Error('userMeta service not available');
      if (args.value !== 0 && args.value !== 1) {
        throw new Error('Week start must be Sunday or Monday');
      }
      services.userMeta.setWeekStartsOn(args.value);
      return { success: true };
    },
    invalidates: [['weekStartsOn'], ['userPreferences']],
    undo: preferenceUndo('userPreferences.setWeekStartsOn', 'getWeekStartsOn'),
  },
  'userPreferences.setAllowOverAssignment': {
    execute: async (args) => {
      const services = S() as { userMeta?: { setAllowOverAssignment(value: boolean): void } };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setAllowOverAssignment(args.value as boolean);
      return { success: true };
    },
    invalidates: [['allowOverAssignment'], ['userPreferences']],
    undo: preferenceUndo('userPreferences.setAllowOverAssignment', 'getAllowOverAssignment'),
  },
  'userPreferences.setSuggestCategoryFromPayee': {
    execute: async (args) => {
      const services = S() as {
        userMeta?: { setSuggestCategoryFromPayee(value: boolean): void };
      };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setSuggestCategoryFromPayee(args.value as boolean);
      return { success: true };
    },
    invalidates: [['suggestCategoryFromPayee'], ['userPreferences']],
    undo: preferenceUndo(
      'userPreferences.setSuggestCategoryFromPayee',
      'getSuggestCategoryFromPayee'
    ),
  },
  'userPreferences.setShowGroupPercent': {
    execute: async (args) => {
      const services = S() as { userMeta?: { setShowGroupPercent(value: boolean): void } };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setShowGroupPercent(args.value as boolean);
      return { success: true };
    },
    invalidates: [['showGroupPercent'], ['userPreferences']],
    undo: preferenceUndo('userPreferences.setShowGroupPercent', 'getShowGroupPercent'),
  },
  'userPreferences.setPlanningNumberAnimations': {
    execute: async (args) => {
      const services = S() as {
        userMeta?: { setPlanningNumberAnimations(value: boolean): void };
      };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setPlanningNumberAnimations(args.value as boolean);
      return { success: true };
    },
    invalidates: [['planningNumberAnimations'], ['userPreferences']],
    undo: preferenceUndo(
      'userPreferences.setPlanningNumberAnimations',
      'getPlanningNumberAnimations'
    ),
  },
  'userPreferences.setDialogBackgroundBlur': {
    execute: async (args) => {
      const services = S() as {
        userMeta?: { setDialogBackgroundBlur(value: boolean): void };
      };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setDialogBackgroundBlur(args.value as boolean);
      return { success: true };
    },
    invalidates: [['dialogBackgroundBlur'], ['userPreferences']],
    undo: preferenceUndo('userPreferences.setDialogBackgroundBlur', 'getDialogBackgroundBlur'),
  },
  'userPreferences.setHideZeroAmounts': {
    execute: async (args) => {
      const services = S() as {
        userMeta?: { setHideZeroAmounts(value: boolean): void };
      };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setHideZeroAmounts(args.value as boolean);
      return { success: true };
    },
    invalidates: [['hideZeroAmounts'], ['userPreferences']],
    undo: preferenceUndo('userPreferences.setHideZeroAmounts', 'getHideZeroAmounts'),
  },
  'userPreferences.setInlineTransactionEntry': {
    execute: async (args) => {
      const services = S() as {
        userMeta?: { setInlineTransactionEntry(value: boolean): void };
      };
      if (!services.userMeta) {
        throw new Error('userMeta service not available');
      }
      services.userMeta.setInlineTransactionEntry(args.value as boolean);
      return { success: true };
    },
    invalidates: [['inlineTransactionEntry'], ['userPreferences']],
    undo: preferenceUndo('userPreferences.setInlineTransactionEntry', 'getInlineTransactionEntry'),
  },
} satisfies Record<string, OpCodeEntry>;
