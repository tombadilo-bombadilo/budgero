import { S, type OpCodeEntry } from '../shared';

export const budgetOps = {
  'budgets.create': {
    execute: async (args) => {
      return await S().budgets!.createBudget({
        name: args.name as string,
        space_id: (args.spaceId as string | undefined) ?? (args.space_id as string | undefined),
        display_currency: args.displayCurrency as string,
        badge_icon: args.badgeIcon as string,
        number_format: args.numberFormat as string,
        create_default_categories: args.createDefaultCategories as boolean,
      });
    },
    invalidates: [
      ['budgets'],
      ['accounts', '*'],
      ['transactions', '*'],
      ['categoryGroups', '*'],
      ['monthlyBudget', '*'],
    ],
  },

  // useUpdateBudgetName
  'budgets.updateName': {
    execute: async (args) => {
      return await S().budgets!.updateBudgetName(args.id as number, args.name as string);
    },
    invalidates: [['budgets']],
  },

  // useUpdateBudgetCurrency
  'budgets.updateCurrency': {
    execute: async (args) => {
      return await S().budgets!.updateBudgetCurrency(args.id as number, args.currency as string);
    },
    invalidates: [['budgets']],
  },

  // useUpdateBudgetIcon
  'budgets.updateIcon': {
    execute: async (args) => {
      return await S().budgets!.updateBudgetIcon(args.id as number, args.icon as string);
    },
    invalidates: [['budgets']],
  },

  // useUpdateBudgetNumberFormat
  'budgets.updateNumberFormat': {
    execute: async (args) => {
      return await S().budgets!.updateBudgetNumberFormat(args.id as number, args.format as string);
    },
    invalidates: [['budgets']],
  },

  // useDeleteBudget
  'budgets.delete': {
    execute: async (args) => {
      return await S().budgets!.deleteBudget(args.id as number);
    },
    invalidates: [
      ['budgets'],
      ['accounts'],
      ['transactions'],
      ['categoryGroups'],
      ['monthlyBudget', '*'],
    ],
  },

  // useInsertDefaultCategories (if exists)
  'budgets.insertDefaultCategories': {
    execute: async (args) => {
      return await S().budgets!.insertDefaultCategories(args.budgetId as number);
    },
    invalidates: [['categoryGroups']],
  },
} satisfies Record<string, OpCodeEntry>;
