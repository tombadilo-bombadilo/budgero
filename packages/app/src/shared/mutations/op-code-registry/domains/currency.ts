import { S, TRANSACTION_INVALIDATION_KEYS, type OpCodeEntry } from '../shared';

const CURRENCY_INVALIDATION_KEYS: string[][] = [
  ['customCurrencyRates'],
  ['customCurrencyRates', '*'],
  ...TRANSACTION_INVALIDATION_KEYS,
];

export const currencyOps = {
  'currency.customRates.add': {
    execute: async (args) => {
      return await S().currency!.addCustomRate(
        args.fromCurrency as string,
        args.toCurrency as string,
        args.rate as number,
        args.startDate as string,
        (args.endDate as string | null) ?? null,
        args.budgetId as number,
        (args.alsoReverse as boolean | undefined) ?? false
      );
    },
    invalidates: CURRENCY_INVALIDATION_KEYS,
  },

  'currency.customRates.update': {
    execute: async (args) => {
      return await S().currency!.updateCustomRate(
        args.id as number,
        args.rate as number,
        args.startDate as string,
        (args.endDate as string | null) ?? null,
        args.budgetId as number
      );
    },
    invalidates: CURRENCY_INVALIDATION_KEYS,
  },

  'currency.customRates.delete': {
    execute: async (args) => {
      return await S().currency!.deleteCustomRate(args.id as number, args.budgetId as number);
    },
    invalidates: CURRENCY_INVALIDATION_KEYS,
  },
} satisfies Record<string, OpCodeEntry>;
