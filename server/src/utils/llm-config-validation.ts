import { OutputFormats } from '../constants/output-formats';

export const LLM_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const PROVIDERS_REQUIRING_API_KEY: ReadonlySet<string> = new Set(['anthropic', 'openai']);

export interface LlmConfigInput {
  provider?: unknown;
  model?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
}

export interface LlmConfigValidationError {
  error: string;
  details: string;
  requiredFields: string[];
}

/**
 * True when the requested output formats include `summary`
 */
export function formatsRequireLlm(formats: unknown): boolean {
  return Array.isArray(formats) && formats.includes('summary' as OutputFormats);
}

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Reads an LLM configuration from a request body or workflow meta.
 *
 * Every public surface takes the same `llmProvider` / `llmModel` / `llmApiKey` /
 * `llmBaseUrl` names, matching the extract and document endpoints. The
 * `promptLlm*` spelling is still accepted because it is the key these values are
 * stored under in `recording_meta`, and the frontend and existing API callers
 * send it.
 */
export function readLlmConfig(source: any): LlmConfigInput {
  const from = source ?? {};
  return {
    provider: from.llmProvider ?? from.promptLlmProvider,
    model: from.llmModel ?? from.promptLlmModel,
    apiKey: from.llmApiKey ?? from.promptLlmApiKey,
    baseUrl: from.llmBaseUrl ?? from.promptLlmBaseUrl,
  };
}

/**
 * Maps a validated config onto the `promptLlm*` keys used inside
 * `recording_meta`. `encryptApiKey` is supplied by the caller so this module
 * stays free of crypto and storage concerns.
 */
export function toPromptLlmMeta(
  config: LlmConfigInput,
  encryptApiKey: (value: string) => string
): Record<string, string> {
  const meta: Record<string, string> = {};
  const provider = asTrimmedString(config.provider);
  const model = asTrimmedString(config.model);
  const apiKey = asTrimmedString(config.apiKey);
  const baseUrl = asTrimmedString(config.baseUrl);

  if (provider) meta.promptLlmProvider = provider;
  if (model) meta.promptLlmModel = model;
  if (apiKey) meta.promptLlmApiKey = encryptApiKey(apiKey);
  if (baseUrl) meta.promptLlmBaseUrl = baseUrl;

  return meta;
}


/**
 * Validates an LLM configuration that is mandatory for this request.
 *
 * `fieldNames` lets a caller report the parameter names its own surface uses —
 * the extract endpoint takes `llmProvider`, while robot creation takes
 * `promptLlmProvider` — so the error names fields the caller actually sent.
 *
 * Returns `null` when valid.
 */
export function validateRequiredLlmConfig(
  config: LlmConfigInput,
  reason: string,
  fieldNames: { provider: string; apiKey: string } = {
    provider: 'llmProvider',
    apiKey: 'llmApiKey',
  }
): LlmConfigValidationError | null {
  const provider = asTrimmedString(config.provider);

  if (!provider) {
    return {
      error: `${fieldNames.provider} is required`,
      details: `${reason} requires an LLM. Self-hosted Maxun has no managed models, so specify ${fieldNames.provider} as one of: ${LLM_PROVIDERS.join(', ')}.`,
      requiredFields: [fieldNames.provider],
    };
  }

  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      error: `Unsupported ${fieldNames.provider}: ${provider}`,
      details: `${fieldNames.provider} must be one of: ${LLM_PROVIDERS.join(', ')}.`,
      requiredFields: [fieldNames.provider],
    };
  }

  if (PROVIDERS_REQUIRING_API_KEY.has(provider) && !asTrimmedString(config.apiKey)) {
    return {
      error: `${fieldNames.apiKey} is required for provider "${provider}"`,
      details: `${reason} requires an LLM. The "${provider}" provider is reached over its hosted API, so ${fieldNames.apiKey} must be supplied. Use provider "ollama" to run locally without a key.`,
      requiredFields: [fieldNames.apiKey],
    };
  }


  return null;
}
