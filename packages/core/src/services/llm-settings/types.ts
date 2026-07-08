export type LLMProvider = 'ollama' | 'lmstudio' | 'openai-compatible';

export interface LLMSettings {
  ID: number;
  BudgetID: number;
  Enabled: boolean;
  Provider: LLMProvider;
  EndpointURL: string;
  ApiKey: string;
  TextModel: string;
  VisionModel: string;
  ContextLength: number | null; // Model's context window size in tokens
  CreatedAt: string;
  UpdatedAt: string;
}

export interface LLMSettingsInput {
  Enabled?: boolean;
  Provider?: LLMProvider;
  EndpointURL?: string;
  ApiKey?: string;
  TextModel?: string;
  VisionModel?: string;
  ContextLength?: number | null;
}
