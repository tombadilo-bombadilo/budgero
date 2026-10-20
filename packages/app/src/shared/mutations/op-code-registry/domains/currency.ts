import type { CustomCurrencyRate } from '@budgero/core/browser';
import {
  S,
  TRANSACTION_INVALIDATION_KEYS,
  executeJournaled,
  journaledUndo,
  redoWithIds,
  safeCapture,
  type OpCodeEntry,
} from '../shared';

const captureRate = (args: Record<string, unknown>) =>
  safeCapture(
    () =>
      S()
        .currency!.getCustomRatesForBudget(args.budgetId as number)
        .find((rate) => rate.ID === args.id) ?? null
  );

const CURRENCY_INVALIDATION_KEYS: string[][] = [
  ['customCurrencyRates'],
  ['customCurrencyRates', '*'],
  // Custom-rate changes revalue account balances (pinned-rate true-up).
  ['revaluationSummary'],
  ['revaluationSummary', '*'],
  ...TRANSACTION_INVALIDATION_KEYS,
];

export const currencyOps = {
  // Custom-rate ops re-convert the rows in their range and revalue foreign
  // accounts (dated today). All three are journaled: undo restores exactly
  // what they wrote instead of revaluing again.
  'currency.customRates.add': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().currency!.addCustomRate(
          args.fromCurrency as string,
          args.toCurrency as string,
          args.rate as number,
          args.startDate as string,
          (args.endDate as string | null) ?? null,
          args.budgetId as number,
          (args.alsoReverse as boolean | undefined) ?? false,
          {
            id: (args.id as number | undefined) ?? undefined,
            reverseId: (args.reverseId as number | null | undefined) ?? undefined,
          }
        )
      ),
    invalidates: CURRENCY_INVALIDATION_KEYS,
    undo: journaledUndo({
      build: (args, result) => {
        const { id, reverseId } = (result ?? {}) as { id?: number; reverseId?: number | null };
        return [id, reverseId]
          .filter((rateId): rateId is number => typeof rateId === 'number')
          .map((rateId) => ({
            op: 'currency.customRates.delete',
            args: { id: rateId, budgetId: args.budgetId },
          }));
      },
    }),
    redo: redoWithIds('currency.customRates.add', (args, result) => {
      const { id, reverseId } = (result ?? {}) as { id?: number; reverseId?: number | null };
      return typeof id === 'number' ? { ...args, id, reverseId } : null;
    }),
  },

  'currency.customRates.update': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().currency!.updateCustomRate(
          args.id as number,
          args.rate as number,
          args.startDate as string,
          (args.endDate as string | null) ?? null,
          args.budgetId as number
        )
      ),
    invalidates: CURRENCY_INVALIDATION_KEYS,
    undo: journaledUndo({
      capture: captureRate,
      build: (args, _result, before) => {
        const rate = before as CustomCurrencyRate | null;
        return rate
          ? [
              {
                op: 'currency.customRates.update',
                args: {
                  id: rate.ID,
                  rate: rate.Rate,
                  startDate: rate.StartDate,
                  endDate: rate.EndDate,
                  budgetId: args.budgetId,
                },
              },
            ]
          : [];
      },
    }),
  },

  'currency.customRates.delete': {
    execute: async (args, context) =>
      executeJournaled(args, context, () =>
        S().currency!.deleteCustomRate(args.id as number, args.budgetId as number)
      ),
    invalidates: CURRENCY_INVALIDATION_KEYS,
    undo: journaledUndo({
      capture: captureRate,
      build: (args, _result, before) => {
        const rate = before as CustomCurrencyRate | null;
        return rate
          ? [
              {
                op: 'currency.customRates.add',
                args: {
                  id: rate.ID,
                  fromCurrency: rate.FromCurrency,
                  toCurrency: rate.ToCurrency,
                  rate: rate.Rate,
                  startDate: rate.StartDate,
                  endDate: rate.EndDate,
                  budgetId: args.budgetId,
                },
              },
            ]
          : [];
      },
    }),
  },
} satisfies Record<string, OpCodeEntry>;
