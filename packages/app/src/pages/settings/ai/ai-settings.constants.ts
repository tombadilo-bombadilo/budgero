import type { LLMProvider } from '@budgero/core/browser';

export interface ProviderOption {
  value: LLMProvider;
  label: string;
  description: string;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'ollama',
    label: 'Ollama',
    description: 'Run models locally with Ollama',
  },
  {
    value: 'lmstudio',
    label: 'LM Studio',
    description: 'Connect to LM Studio server',
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI Compatible',
    description: 'Any OpenAI-compatible API',
  },
];

export const DEFAULT_ENDPOINTS: Record<LLMProvider, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  'openai-compatible': 'http://localhost:8080/v1',
};

export const DEFAULT_TEXT_MODEL = 'llama3.2';
export const DEFAULT_VISION_MODEL = 'qwen3-vl-8b';
export const DEFAULT_PROVIDER: LLMProvider = 'ollama';
export const DEFAULT_ENDPOINT = DEFAULT_ENDPOINTS[DEFAULT_PROVIDER];

/**
 * Returns true when the endpoint points at the local machine or a private
 * network (so financial data never leaves the user's network). Anything else
 * — a public hostname or IP — is treated as a third-party / cloud endpoint.
 */
export const isLocalEndpoint = (url: string): boolean => {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    // Unparseable / partial URL — assume local so we don't nag prematurely.
    return true;
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]') {
    return true;
  }

  // Private IPv4 ranges (RFC 1918) + link-local.
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;

  return false;
};

/**
 * Whether the current config sends data off the local network: either a
 * non-local endpoint or an API key is set (keys only matter for remote APIs).
 */
export const isCloudEndpoint = (url: string, apiKey: string): boolean =>
  Boolean(apiKey.trim()) || !isLocalEndpoint(url);

export const RECOMMENDED_TEXT_MODELS = [
  { name: 'qwen3', description: 'Excellent for structured outputs' },
  { name: 'llama3.2', description: 'Fast and accurate' },
  { name: 'mistral', description: 'Good balance of speed and quality' },
];

export const RECOMMENDED_VISION_MODELS = [
  { name: 'qwen3-vl-8b', description: 'Best for documents (~6GB)' },
  { name: 'qwen3-vl-4b', description: 'Lighter option (~3GB)' },
  { name: 'llava-llama3', description: 'Good general vision' },
];
