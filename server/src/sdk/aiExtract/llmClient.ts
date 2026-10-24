/**
 * JSON-only LLM calls for AI Extract.
 *
 * Uses the provider the user configured for the robot (Anthropic, OpenAI or
 * an OpenAI-compatible server, or Ollama), text only. Replies are parsed
 * leniently: small and reasoning models often wrap JSON in prose, code
 * fences or <think> blocks.
 *
 * The pipeline takes a `JsonLLM` function rather than calling a provider
 * directly, so tests can answer with a deterministic script.
 */
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import logger from '../../logger';
import { resolveLlmModel } from '../../utils/llm-models';
import { LLM_AGENTS, guardLlmBaseUrl, resolveOpenAiApiKey } from '../../utils/llm-endpoint';

export interface AiExtractLlmConfig {
  provider?: 'anthropic' | 'openai' | 'ollama';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface JsonCallOptions {
  /** Short name for logs, e.g. "spec" or "extract". */
  label: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Epoch ms after which no new call starts and a running one is cut short. */
  deadline?: number;
}

export interface JsonCallResult {
  json: any;
  provider: string;
}

export type JsonLLM = (opts: JsonCallOptions) => Promise<JsonCallResult>;

const DEFAULT_TIMEOUT_MS = 90_000;

/** First balanced JSON object in `text`, ignoring reasoning blocks and code fences. */
export function parseJsonLoose(text: string): any {
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to scanning */
  }
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error(`No JSON object in model reply: ${cleaned.slice(0, 200)}`);
}

/** Time allowed for the next call: the per-call timeout, capped by the overall deadline. */
function callTimeout(opts: JsonCallOptions): number {
  if (!opts.deadline) return DEFAULT_TIMEOUT_MS;
  const remaining = opts.deadline - Date.now();
  if (remaining <= 1000) throw new Error(`[AiExtract] ${opts.label}: time budget exhausted`);
  return Math.min(DEFAULT_TIMEOUT_MS, remaining);
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  // Race as well as abort: not every client honours the signal.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider(config: AiExtractLlmConfig, opts: JsonCallOptions, signal: AbortSignal): Promise<{ text: string; provider: string }> {
  const provider = config.provider || 'ollama';
  const maxTokens = opts.maxTokens || 1024;

  if (provider === 'anthropic') {
    const model = resolveLlmModel(config.model, 'anthropic', { textOnly: true });
    const anthropic = new Anthropic({ apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }, { signal });
    const text = response.content.map((block: any) => (block.type === 'text' ? block.text : '')).join('');
    return { text, provider: `anthropic:${model}` };
  }

  if (provider === 'openai') {
    const baseUrl = guardLlmBaseUrl(config.baseUrl || 'https://api.openai.com/v1');
    const model = resolveLlmModel(config.model, 'openai', { textOnly: true });
    const response = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }, {
      headers: {
        Authorization: `Bearer ${resolveOpenAiApiKey(config.apiKey, config.baseUrl)}`,
        'Content-Type': 'application/json',
      },
      signal: signal as any,
      ...LLM_AGENTS,
    });
    return { text: response.data?.choices?.[0]?.message?.content || '', provider: `openai:${model}` };
  }

  if (provider === 'ollama') {
    const baseUrl = guardLlmBaseUrl((config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''));
    const model = resolveLlmModel(config.model || process.env.OLLAMA_MODEL, 'ollama', { textOnly: true });
    // Ollama Cloud (https://ollama.com) and authenticated proxies need a key; a local server ignores it.
    // The operator's OLLAMA_API_KEY is only sent to the operator's endpoint, never to a
    // base URL chosen per request.
    const operatorBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const usesOperatorEndpoint = !config.baseUrl || config.baseUrl.replace(/\/+$/, '') === operatorBaseUrl;
    const apiKey = config.apiKey || (usesOperatorEndpoint ? process.env.OLLAMA_API_KEY : undefined);
    const response = await axios.post(`${baseUrl}/api/chat`, {
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      stream: false,
      format: 'json',
      options: { temperature: 0, num_predict: maxTokens },
    }, {
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: signal as any,
      ...LLM_AGENTS,
    });
    const message = response.data?.message || {};
    return { text: message.content || message.thinking || '', provider: `ollama:${model}` };
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

/**
 * Turns a failed provider call into a message that says what to fix: the
 * provider's own error ("model 'x' not found", "unauthorized") and where the
 * request went, instead of axios's bare "Request failed with status code 404".
 */
export function describeLlmError(error: any, config: AiExtractLlmConfig): Error {
  const status = error?.response?.status ?? error?.status;
  if (!status) return error instanceof Error ? error : new Error(String(error));

  const body = error?.response?.data ?? error?.error;
  const detail = typeof body === 'string'
    ? body
    : body?.error?.message || body?.error || body?.message || '';
  const provider = config.provider || 'ollama';
  const target = error?.config?.url ? ` (${error.config.url})` : '';
  let hint = '';
  if (status === 401 || status === 403) {
    hint = provider === 'ollama'
      ? ' Check OLLAMA_API_KEY; Ollama Cloud requires it.'
      : ' Check the API key.';
  } else if (status === 404) {
    hint = provider === 'ollama'
      ? ' Check that the base URL is an Ollama server (Ollama Cloud is https://ollama.com) and that the model exists there; set it in Model settings or OLLAMA_MODEL (e.g. gpt-oss:20b on Ollama Cloud).'
      : ' Check the base URL and the model name.';
  }
  return new Error(`${provider} request failed with status ${status}${target}${detail ? `: ${String(detail).slice(0, 300)}` : ''}.${hint}`);
}

/** A JsonLLM backed by the robot's configured provider. */
export function createJsonLLM(config: AiExtractLlmConfig = {}): JsonLLM {
  return async (opts) => {
    if (opts.deadline && Date.now() >= opts.deadline) {
      throw new Error(`[AiExtract] ${opts.label}: time budget exhausted before the call`);
    }
    const { text, provider } = await withTimeout(callTimeout(opts), (signal) => callProvider(config, opts, signal))
      .catch((error) => { throw describeLlmError(error, config); });
    const json = parseJsonLoose(text);
    logger.info(`[AiExtract] ${opts.label}: answered by ${provider}`);
    return { json, provider };
  };
}
