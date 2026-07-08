import type {
  CreateRecurringTransactionInput,
  MarkOccurrenceReadyOptions,
  MarkOccurrenceReadyResult,
  UpdateRecurringTransactionInput,
} from '@budgero/core/browser';
import {
  S,
  RECURRING_OCCURRENCE_INVALIDATIONS,
  RECURRING_TEMPLATE_INVALIDATIONS,
  TRANSACTION_INVALIDATION_KEYS,
  type OpCodeEntry,
} from '../shared';

// Analytics/projection queries union scheduled occurrences in as projections when
// their range extends past today, so changing recurring rules must refresh them.
const PROJECTION_CONSUMER_INVALIDATIONS: string[][] = [
  ['spendingByDates', '*'],
  ['spendingByDatesByCategories', '*'],
  ['spendingByCategoriesInGroup', '*'],
  ['analyticsPeriodSummary', '*'],
  ['topSpendingCategories', '*'],
  ['incomeExpenseByPeriod', '*'],
  ['spendingTotalsByPeriod', '*'],
  ['categoryTotalsByPeriod', '*'],
  ['spendingByLabels', '*'],
  ['spendingByPayees', '*'],
];

export const recurringOps = {
  'recurring.create': {
    execute: async (args) => {
      return await S().recurring!.createRecurringTransaction(
        args.input as CreateRecurringTransactionInput
      );
    },
    invalidates: [
      ...RECURRING_TEMPLATE_INVALIDATIONS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...PROJECTION_CONSUMER_INVALIDATIONS,
    ],
  },
  'recurring.update': {
    execute: async (args) => {
      return await S().recurring!.updateRecurringTransaction(
        args.id as number,
        args.patch as UpdateRecurringTransactionInput
      );
    },
    invalidates: [
      ...RECURRING_TEMPLATE_INVALIDATIONS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...PROJECTION_CONSUMER_INVALIDATIONS,
    ],
  },
  'recurring.delete': {
    execute: async (args) => {
      return await S().recurring!.deleteRecurringTransaction(args.id as number);
    },
    invalidates: [
      ...RECURRING_TEMPLATE_INVALIDATIONS,
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...PROJECTION_CONSUMER_INVALIDATIONS,
    ],
  },
  'recurring.markReady': {
    execute: async (args) => {
      return await S().recurring!.markOccurrenceReady(args.options as MarkOccurrenceReadyOptions);
    },
    invalidates: [
      ...RECURRING_OCCURRENCE_INVALIDATIONS,
      ...TRANSACTION_INVALIDATION_KEYS,
      ...RECURRING_TEMPLATE_INVALIDATIONS,
    ],
    undo: {
      capture: async (args) => {
        try {
          const occurrenceId = (args.options as MarkOccurrenceReadyOptions)?.occurrenceId;
          if (!occurrenceId) return null;
          const occurrence = await S().recurring!.getOccurrenceWithTemplate(occurrenceId);
          return { occurrence };
        } catch (error) {
          console.warn(
            '[OpCodeRegistry] Unable to capture occurrence before markReady undo',
            error
          );
          return null;
        }
      },
      build: (args, result, _before) => {
        const options = args.options as MarkOccurrenceReadyOptions;
        const occurrenceId = options?.occurrenceId;
        const transactionId = (result as MarkOccurrenceReadyResult)?.transactionId;
        if (!occurrenceId || !Number.isFinite(transactionId)) {
          return [];
        }
        const ops: { op: string; args: Record<string, unknown> }[] = [];
        ops.push({ op: 'transactions.delete', args: { id: transactionId } });
        ops.push({ op: 'recurring.resetOccurrence', args: { id: occurrenceId } });
        return ops;
      },
    },
  },
  'recurring.skip': {
    execute: async (args) => {
      return await S().recurring!.skipOccurrence(args.id as number);
    },
    invalidates: [...RECURRING_OCCURRENCE_INVALIDATIONS, ...PROJECTION_CONSUMER_INVALIDATIONS],
  },
  'recurring.markNotified': {
    execute: async (args) => {
      return await S().recurring!.markOccurrenceNotified(args.id as number);
    },
    invalidates: [...RECURRING_OCCURRENCE_INVALIDATIONS],
  },
  'recurring.resetOccurrence': {
    execute: async (args) => {
      return await S().recurring!.resetOccurrence(args.id as number);
    },
    invalidates: [...RECURRING_OCCURRENCE_INVALIDATIONS, ...RECURRING_TEMPLATE_INVALIDATIONS],
  },
} satisfies Record<string, OpCodeEntry>;
