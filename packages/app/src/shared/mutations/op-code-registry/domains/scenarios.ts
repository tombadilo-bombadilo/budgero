import { S, type OpCodeEntry } from '../shared';

export const scenarioOps = {
  'scenarios.save': {
    execute: async (args) => {
      return S().scenarios!.saveScenario({
        id: args.id as string | undefined,
        budgetId: args.budgetId as number,
        name: args.name as string,
        payload: args.payload as string,
      });
    },
    invalidates: [['scenarios', '*']],
  },

  'scenarios.delete': {
    execute: async (args) => {
      S().scenarios!.deleteScenario(args.id as string);
    },
    invalidates: [['scenarios', '*']],
  },
} satisfies Record<string, OpCodeEntry>;
