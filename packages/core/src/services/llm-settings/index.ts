import type { DatabaseAdapter } from '../../database/interface.js';
import { LLMSettingsQueries } from './queries.js';
import type { LLMSettings, LLMSettingsInput } from './types.js';

export * from './types.js';

export class LLMSettingsService {
  private queries: LLMSettingsQueries;

  constructor(db: DatabaseAdapter) {
    this.queries = new LLMSettingsQueries(db);
  }

  getSettings(budgetId: number): LLMSettings | null {
    return this.queries.getLLMSettings(budgetId);
  }

  updateSettings(budgetId: number, input: LLMSettingsInput): LLMSettings {
    return this.queries.upsertLLMSettings(budgetId, input);
  }

  deleteSettings(budgetId: number): void {
    this.queries.deleteLLMSettings(budgetId);
  }

  getDefaultSettings(): Omit<LLMSettings, 'ID' | 'BudgetID' | 'CreatedAt' | 'UpdatedAt'> {
    return {
      Enabled: false,
      Provider: 'ollama',
      EndpointURL: 'http://localhost:11434',
      ApiKey: '',
      TextModel: 'llama3.2',
      VisionModel: 'llava',
      ContextLength: null,
    };
  }
}
