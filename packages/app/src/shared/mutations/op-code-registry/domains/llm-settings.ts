import type { LLMSettingsInput } from '@budgero/core/browser';
import { S, type OpCodeEntry } from '../shared';

export const llmSettingsOps = {
  'llmSettings.update': {
    execute: async (args) => {
      return await S().llmSettings!.updateSettings(
        args.budgetId as number,
        args.input as LLMSettingsInput
      );
    },
    invalidates: [['llmSettings', '*']],
  },
  'llmSettings.delete': {
    execute: async (args) => {
      await S().llmSettings!.deleteSettings(args.budgetId as number);
      return { success: true };
    },
    invalidates: [['llmSettings', '*']],
  },
} satisfies Record<string, OpCodeEntry>;
