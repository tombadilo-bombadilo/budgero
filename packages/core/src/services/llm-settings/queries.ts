import type { DatabaseAdapter } from '../../database/interface.js';
import { getRow, run } from '../../database/sql.js';
import type { LLMSettings, LLMSettingsInput, LLMProvider } from './types.js';

/** Database row structure for llm_settings table */
interface LLMSettingsRow {
  ID: number;
  BudgetID: number;
  Enabled: number | boolean;
  Provider: string;
  EndpointURL: string;
  ApiKey: string | null;
  TextModel: string;
  VisionModel: string;
  ContextLength: number | null;
  CreatedAt: string;
  UpdatedAt: string;
}

/**
 * LLMSettingsQueries - All SQL queries for LLM settings
 */
export class LLMSettingsQueries {
  constructor(private db: DatabaseAdapter) {}

  getLLMSettings(budgetId: number): LLMSettings | null {
    const row = getRow<LLMSettingsRow>(
      this.db,
      `
      SELECT ID, BudgetID, Enabled, Provider, EndpointURL, ApiKey, TextModel, VisionModel, ContextLength, CreatedAt, UpdatedAt
      FROM llm_settings
      WHERE BudgetID = ?
    `,
      budgetId
    );

    if (!row) return null;

    return {
      ID: row.ID,
      BudgetID: row.BudgetID,
      Enabled: Boolean(row.Enabled),
      Provider: row.Provider as LLMProvider,
      EndpointURL: row.EndpointURL,
      ApiKey: row.ApiKey || '',
      TextModel: row.TextModel,
      VisionModel: row.VisionModel,
      ContextLength: row.ContextLength ?? null,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
    };
  }

  upsertLLMSettings(budgetId: number, input: LLMSettingsInput): LLMSettings {
    const existing = this.getLLMSettings(budgetId);

    if (existing) {
      run(
        this.db,
        `
        UPDATE llm_settings
        SET Enabled = ?,
            Provider = ?,
            EndpointURL = ?,
            ApiKey = ?,
            TextModel = ?,
            VisionModel = ?,
            ContextLength = ?,
            UpdatedAt = datetime('now')
        WHERE BudgetID = ?
      `,
        input.Enabled !== undefined ? (input.Enabled ? 1 : 0) : existing.Enabled ? 1 : 0,
        input.Provider ?? existing.Provider,
        input.EndpointURL ?? existing.EndpointURL,
        input.ApiKey ?? existing.ApiKey,
        input.TextModel ?? existing.TextModel,
        input.VisionModel ?? existing.VisionModel,
        input.ContextLength !== undefined ? input.ContextLength : existing.ContextLength,
        budgetId
      );
    } else {
      run(
        this.db,
        `
        INSERT INTO llm_settings (BudgetID, Enabled, Provider, EndpointURL, ApiKey, TextModel, VisionModel, ContextLength)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        budgetId,
        input.Enabled ? 1 : 0,
        input.Provider ?? 'ollama',
        input.EndpointURL ?? 'http://localhost:11434',
        input.ApiKey ?? '',
        input.TextModel ?? 'llama3.2',
        input.VisionModel ?? 'llava',
        input.ContextLength ?? null
      );
    }

    const result = this.getLLMSettings(budgetId);
    if (!result) {
      throw new Error(`Failed to retrieve LLM settings for budget ${budgetId}`);
    }
    return result;
  }

  deleteLLMSettings(budgetId: number): void {
    run(this.db, `DELETE FROM llm_settings WHERE BudgetID = ?`, budgetId);
  }
}
