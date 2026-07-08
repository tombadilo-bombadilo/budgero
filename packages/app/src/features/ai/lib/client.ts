import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import type { LLMProvider } from '@budgero/core/browser';
import { getErrorMessage } from '@shared/lib/errors';
import { buildCategorizationPrompt, buildExtractionPrompt } from '@features/ai/lib/prompts';

export interface AIClientConfig {
  provider: LLMProvider;
  endpointURL: string;
  apiKey?: string;
  textModel: string;
  visionModel: string;
}

/** Common model info shape from various AI providers */
interface AIModelInfo {
  id?: string;
  name?: string;
  model?: string;
  path?: string;
  state?: string;
  loaded_context_length?: number;
  max_context_length?: number;
  context_length?: number;
}

export function createAIClient(config: AIClientConfig) {
  const baseURL = normalizeEndpointURL(config.endpointURL, config.provider);

  return createOpenAI({
    baseURL,
    apiKey: config.apiKey || 'ollama',
  });
}

function getJsonHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

function normalizeEndpointURL(url: string, provider: LLMProvider): string {
  let normalized = url.trim();

  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // For Ollama and LM Studio, ensure we use the OpenAI-compatible /v1 endpoint
  if ((provider === 'ollama' || provider === 'lmstudio') && !normalized.includes('/v1')) {
    normalized = `${normalized}/v1`;
  }

  return normalized;
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  models?: string[];
  contextLength?: number; // loaded_context_length from LM Studio, context_length from others
}

export async function testConnection(config: AIClientConfig): Promise<ConnectionTestResult> {
  try {
    const baseURL = normalizeEndpointURL(config.endpointURL, config.provider);
    const headers = getJsonHeaders(config.apiKey);
    let models: string[] = [];
    let contextLength: number | undefined;

    // First try to list models
    try {
      let modelsURL: string;

      if (config.provider === 'ollama') {
        // Ollama uses /api/tags at the base (not /v1)
        const baseEndpoint = config.endpointURL.replace(/\/v1\/?$/, '').replace(/\/$/, '');
        modelsURL = `${baseEndpoint}/api/tags`;
      } else if (config.provider === 'lmstudio') {
        // LM Studio native API has more info (including context length)
        // User should provide base URL like localhost:1234, we strip any /v1 or /api paths
        const baseEndpoint = config.endpointURL
          .replace(/\/v1\/?$/, '')
          .replace(/\/api\/v0\/?$/, '')
          .replace(/\/$/, '');
        modelsURL = `${baseEndpoint}/api/v0/models`;
      } else {
        // OpenAI-compatible use /v1/models
        modelsURL = `${baseURL}/models`;
      }

      const response = await fetch(modelsURL, { headers });

      if (response.ok) {
        const data = await response.json();

        if (config.provider === 'ollama' && data.models) {
          models = data.models
            .map((m: AIModelInfo) => m.name || m.model)
            .filter(Boolean) as string[];

          // Fetch context length from Ollama's /api/show for the selected text model
          if (config.textModel) {
            try {
              const baseEndpoint = config.endpointURL.replace(/\/v1\/?$/, '').replace(/\/$/, '');
              const showResponse = await fetch(`${baseEndpoint}/api/show`, {
                method: 'POST',
                headers: getJsonHeaders(config.apiKey),
                body: JSON.stringify({ name: config.textModel }),
              });
              if (showResponse.ok) {
                const showData = await showResponse.json();
                // Ollama returns model_info with context length fields
                const modelInfo = showData.model_info || {};
                const numCtx = Object.entries(modelInfo).find(([key]) =>
                  key.endsWith('.context_length')
                );
                if (numCtx) {
                  contextLength = numCtx[1] as number;
                }
              }
            } catch {
              // Context length is best-effort; ignore if /api/show fails.
            }
          }
        } else if (config.provider === 'lmstudio' && data.data) {
          // LM Studio /api/v0/models format
          const lmModels = data.data as AIModelInfo[];
          models = lmModels.map((m) => m.id || m.path).filter(Boolean) as string[];
          // Get context length - try loaded model first, then any model with loaded_context_length
          const loadedModel = lmModels.find((m) => m.state === 'loaded');
          const modelWithContext = loadedModel || lmModels.find((m) => m.loaded_context_length);
          if (modelWithContext?.loaded_context_length) {
            contextLength = modelWithContext.loaded_context_length;
          } else if (modelWithContext?.max_context_length) {
            // Fallback to max_context_length if loaded_context_length not available
            contextLength = modelWithContext.max_context_length;
          }
        } else if (data.data) {
          // Generic OpenAI-compatible
          models = (data.data as AIModelInfo[])
            .map((m) => m.id || m.name || m.model)
            .filter(Boolean) as string[];
        } else if (Array.isArray(data)) {
          // Some providers return array directly
          models = (data as AIModelInfo[])
            .map((m) => m.id || m.name || m.model || String(m))
            .filter(Boolean) as string[];
        } else if (data.models) {
          // Alternative format
          models = (data.models as AIModelInfo[])
            .map((m) => m.id || m.name || m.model)
            .filter(Boolean) as string[];
        }

        if (models.length > 0) {
          return { success: true, models, contextLength };
        }
      }
    } catch {
      // Models endpoint failed, will try completion test
    }

    // Fallback: test with a minimal completion request
    const testResponse = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.textModel || 'test',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      }),
    });

    if (testResponse.ok) {
      return {
        success: true,
        models: [config.textModel, config.visionModel].filter(Boolean),
      };
    }

    const errorData = await testResponse.text();
    throw new Error(errorData || `HTTP ${testResponse.status}`);
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to connect. Check your API key and endpoint.');
    return {
      success: false,
      error: message,
    };
  }
}

function extractTextContent(data: unknown): string {
  const d = data as Record<string, unknown>;
  if (d.choices) {
    const choices = d.choices as { message?: { content?: string } }[];
    if (choices[0]?.message?.content) {
      return choices[0].message.content;
    }
  }
  if (d.output) {
    for (const item of d.output as {
      type?: string;
      content?: { type?: string; text?: string }[];
    }[]) {
      if (item.type === 'message' && item.content) {
        for (const c of item.content) {
          if (c.type === 'output_text' || c.type === 'text') {
            return c.text ?? '';
          }
        }
      }
    }
  }
  return '';
}

function stripJsonFences(s: string): string {
  let result = s.trim();
  if (result.startsWith('```')) {
    result = result.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return result;
}

/**
 * POST an OpenAI-compatible chat completion, extract the JSON object from the
 * response text, and validate it against `schema`.
 *
 * HTTP failures throw; unparseable model output logs and returns `fallback`.
 * The former inline copies differed slightly here — including the status in
 * the thrown message and always regex-extracting the outermost JSON object
 * (some models wrap it in prose) is the deliberate, unified behavior.
 */
async function callChatCompletion<T>(
  config: AIClientConfig,
  options: {
    /** Tags console diagnostics, e.g. 'categorizeTransactions'. */
    label: string;
    model: string;
    messages: { role: string; content: unknown }[];
    schema: z.ZodType<T>;
    fallback: T;
  }
): Promise<T> {
  const { label, model, messages, schema, fallback } = options;
  const baseURL = normalizeEndpointURL(config.endpointURL, config.provider);
  const headers = getJsonHeaders(config.apiKey);

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens: 2048 }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AI Output] ${label} error:`, response.status, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // Extract text from various response formats, then parse the JSON payload.
  const content = extractTextContent(data);
  const jsonStr = stripJsonFences(content);

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return schema.parse(JSON.parse(jsonMatch[0]));
    } catch (e) {
      console.error(`[AI Output] ${label} parse error:`, e, 'content:', content);
    }
  }

  console.error(`[AI Output] ${label} failed to parse, returning fallback`);
  return fallback;
}

const categorizationResultSchema = z.object({
  categorizations: z.array(
    z.object({
      transactionId: z.number(),
      categoryName: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
    })
  ),
});

export type CategorizationResult = z.infer<typeof categorizationResultSchema>;

export interface TransactionForCategorization {
  id: number;
  memo: string;
  payee: string;
  /** DECIMAL currency amount — this shape is LLM-facing (callers convert from milliunits). */
  inflow: number;
  /** DECIMAL currency amount — this shape is LLM-facing (callers convert from milliunits). */
  outflow: number;
  date: string;
  accountName?: string;
  accountType?: string;
}

export interface CategoryWithGroup {
  name: string;
  groupName: string;
}

export interface HistoricalPattern {
  payee: string;
  memo: string;
  categoryName: string;
  count: number;
}

export interface CategorizationContext {
  categories: CategoryWithGroup[];
  historicalPatterns: HistoricalPattern[];
  currencyCode: string;
}

export async function categorizeTransactions(
  config: AIClientConfig,
  transactions: TransactionForCategorization[],
  context: CategorizationContext
): Promise<CategorizationResult> {
  const prompt = buildCategorizationPrompt(transactions, context);

  return callChatCompletion(config, {
    label: 'categorizeTransactions',
    model: config.textModel,
    messages: [{ role: 'user', content: prompt }],
    schema: categorizationResultSchema,
    fallback: { categorizations: [] },
  });
}

const extractedTransactionSchema = z.object({
  transactions: z.array(
    z.object({
      date: z.string().describe('Date in YYYY-MM-DD format'),
      payee: z.string().describe('Merchant or payee name'),
      memo: z.string().describe('Description or memo'),
      amount: z.number().describe('Transaction amount (positive number)'),
      isExpense: z.boolean().describe('True if this is an expense/outflow, false if income/inflow'),
      suggestedCategory: z.string().optional().describe('Suggested category name'),
    })
  ),
  confidence: z.number().min(0).max(1).describe('Overall confidence in the extraction'),
});

export type ExtractedTransactions = z.infer<typeof extractedTransactionSchema>;

export async function extractTransactionsFromImage(
  config: AIClientConfig,
  imageBase64: string,
  mimeType = 'image/jpeg',
  availableCategories: string[] = []
): Promise<ExtractedTransactions> {
  const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;

  const prompt = buildExtractionPrompt(availableCategories);

  // Uses the OpenAI-compatible chat-completions format for vision
  return callChatCompletion(config, {
    label: 'extractTransactionsFromImage',
    model: config.visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    schema: extractedTransactionSchema,
    fallback: { transactions: [], confidence: 0 },
  });
}
