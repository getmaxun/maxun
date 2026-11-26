import Anthropic from '@anthropic-ai/sdk';
import { resolveLlmModel } from './llm-models';
import axios from 'axios';
import logger from '../logger';
import { LLMConfig } from '../sdk/browserAgent';
import { resolveOpenAiApiKey } from './llm-endpoint';
import { LLM_AGENTS, guardLlmBaseUrl } from './llm-endpoint';

const SYSTEM_PROMPT = `You are a web page summarizer. Your output is plain text only.

STRICT RULES — violating any of these is an error:
- Output ONLY the summary. Do not write any preamble, intro, or closing. Do not say "Here is", "Here's", "Sure", "This page", "In summary", "Conclusion", or anything like that. Start immediately with the content.
- NO markdown of any kind: no ** bold **, no * italic *, no ## headers, no \`code\`, no > quotes, no --- dividers, no code fences.
- NO section headers or titles. Do not label sections like "Benefits:", "Top Tools:", "Conclusion:", etc.
- Write 2–4 plain sentences covering the main point. Then, only if there is a genuine list (features, named items, steps), add plain bullet points using a hyphen (-). No bold inside bullet points.
- Keep it short and factual. Do not pad, repeat, or editorialize.`;

const USER_PROMPT_PREFIX = `Summarize the following web page in plain text. Start directly with the summary — no intro, no headings, no bold, no markdown.\n\n`;

const MAX_TOKENS = 1500;

function stripUnderscoreEmphasis(input: string, width: 1 | 2): string {
  const tokens = Array.from(input.matchAll(/\S+/gu))
    .filter((match) => match[0].includes('/') || match[0].includes('\\'))
    .map((match) => {
      const value = match[0];
      const start = match.index;
      const trailing = /(_+)(?:(?![_\\/])\p{P})*$/u.exec(value);
      const leading = /(^|[^\p{L}\p{M}\p{N}_\\/])(_{1,3})(?!_)/iu.exec(value);
      let opening: { index: number; width: number } | undefined;
      if (leading) {
        const index = leading.index + leading[1].length;
        const prefix = value.slice(0, index);
        const body = value.slice(index + leading[2].length);
        const knownPath = /^(?:[a-z][a-z\d+.-]*:\/\/|[a-z]:[\\/]|\.{1,2}[\\/]|[\\/])/iu.test(body);
        const paired = trailing && trailing.index > index + leading[2].length && trailing[1].length >= leading[2].length;
        if (!prefix.includes('/') && !prefix.includes('\\') && (knownPath || paired)) {
          opening = { index: start + index, width: leading[2].length };
        }
      }
      let closing: { start: number; end: number; literal: boolean } | undefined;
      if (trailing) {
        const before = value.slice(0, trailing.index);
        const segment = before.slice(Math.max(before.lastIndexOf('/'), before.lastIndexOf('\\')) + 1);
        const literalWidth = /^_+/.exec(segment)?.[0].length || 0;
        closing = {
          start: start + trailing.index,
          end: start + trailing.index + trailing[1].length,
          literal: literalWidth >= width && trailing[1].length <= literalWidth,
        };
      }
      return { start, end: start + value.length, opening, closing };
    });
  const marker = '_'.repeat(width);
  const markers: { index: number; canOpen: boolean; canClose: boolean; token: (typeof tokens)[number] | undefined }[] = [];
  let tokenIndex = 0;
  for (let index = 0; index <= input.length - width; index++) {
    if (!input.startsWith(marker, index)) continue;
    while (tokenIndex < tokens.length && index >= tokens[tokenIndex].end) tokenIndex++;
    const token = tokens[tokenIndex];
    const protectedToken = token && index >= token.start ? token : undefined;
    const canOpen = !/[\p{L}\p{M}\p{N}_]$/u.test(input.slice(Math.max(0, index - 2), index)) &&
      (!protectedToken || (protectedToken.opening?.index === index && width <= protectedToken.opening.width));
    const canClose = !/^[\p{L}\p{M}\p{N}_]/u.test(input.slice(index + width, index + width + 2)) &&
      (!protectedToken || (protectedToken.closing !== undefined && index >= protectedToken.closing.start && index + width <= protectedToken.closing.end));
    if (canOpen || canClose) markers.push({ index, canOpen, canClose, token: protectedToken });
  }
  const nextDefinite: ((typeof markers)[number] | undefined)[] = new Array(markers.length);
  let upcoming: (typeof markers)[number] | undefined;
  for (let index = markers.length - 1; index >= 0; index--) {
    nextDefinite[index] = upcoming;
    const candidate = markers[index];
    if (candidate.canOpen || (candidate.canClose && !candidate.token)) upcoming = candidate;
  }
  const removed = new Set<number>();
  let opener: (typeof markers)[number] | undefined;
  let consumedUntil = 0;
  for (let index = 0; index < markers.length; index++) {
    const candidate = markers[index];
    if (candidate.index < consumedUntil) continue;
    if (opener && candidate.canClose && candidate.index > opener.index + width) {
      // Prefer an external closer over a URL's literal suffix. A new opener
      // instead confirms that the earlier URL already ended the emphasis.
      if (candidate.token) {
        if (nextDefinite[index]?.canClose) continue;
        const ownWrapper = opener.token === candidate.token && candidate.token.opening?.index === opener.index;
        if (candidate.token.closing?.literal && !ownWrapper) continue;
      }
      for (let offset = 0; offset < width; offset++) {
        removed.add(opener.index + offset);
        removed.add(candidate.index + offset);
      }
      opener = undefined;
      consumedUntil = candidate.index + width;
    } else if (!opener && candidate.canOpen) {
      opener = candidate;
      consumedUntil = candidate.index + width;
    }
  }
  return removed.size ? input.split('').filter((_char, index) => !removed.has(index)).join('') : input;
}

function cleanOutput(text: string): string {
  let out = text.trim();

  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();

  // Strip code fences
  const fenceMatch = out.match(/^```(?:markdown)?\r?\n([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    out = fenceMatch[1].trim();
  } else if (out.startsWith('```')) {
    out = out.replace(/^```[^\n]*\n/, '').replace(/```\s*$/, '').trim();
  }

  // Strip markdown bold/italic while preserving literal URL/path markers.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = stripUnderscoreEmphasis(out, 2);
  out = stripUnderscoreEmphasis(out, 1);

  // Strip ATX headers (## Heading)
  out = out.replace(/^#{1,6}\s+/gm, '');

  // Strip inline code
  out = out.replace(/`([^`]+)`/g, '$1');

  // Strip preamble lines like "Here is...", "Sure!", "This is a summary of..."
  out = out.replace(/^(here(?:'s| is)\b[^\n]*\n+|sure[!,.]?\s*\n+|in summary[,:]?\s*\n+)/i, '');

  return out.trim();
}

/**
 * Summarizes markdown/text content using the robot's configured LLM provider.
 * Supports: anthropic, openai (and compatible), ollama (local).
 */
export async function summarizeMarkdown(markdown: string, llmConfig?: LLMConfig): Promise<string> {
  if (!markdown || markdown.trim().length === 0) {
    throw new Error('Content is empty');
  }

  const truncated = markdown.substring(0, 40000);
  const userPrompt = USER_PROMPT_PREFIX + truncated;

  const config: LLMConfig = llmConfig || { provider: 'ollama' };
  const { provider } = config;

  if (provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY });
    const model = resolveLlmModel(config.model, config.provider);
    logger.info(`[Summarizer] Using Anthropic (${model})`);

    const response = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textContent = response.content.find((c: any) => c.type === 'text');
    const content = textContent?.type === 'text' ? textContent.text : '';
    if (!content || content.trim().length === 0) {
      throw new Error('Anthropic returned empty summary');
    }
    return cleanOutput(content);
  }

  if (provider === 'openai') {
    const baseUrl = guardLlmBaseUrl(config.baseUrl || 'https://api.openai.com/v1');
    const model = resolveLlmModel(config.model, config.provider);
    logger.info(`[Summarizer] Using OpenAI-compatible at ${baseUrl} (${model})`);

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.1,
      },
      {
        headers: {
          'Authorization': `Bearer ${resolveOpenAiApiKey(config.apiKey, config.baseUrl)}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
        ...LLM_AGENTS,
      }
    );
    const content = response.data.choices?.[0]?.message?.content || '';
    if (!content || content.trim().length === 0) {
      throw new Error('OpenAI returned empty summary');
    }
    return cleanOutput(content);
  }

  if (provider === 'ollama') {
    const baseUrl = guardLlmBaseUrl((config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''));
    const model = resolveLlmModel(config.model, config.provider);
    // Match AI Extract: operator credentials only belong to the operator's endpoint.
    const operatorBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const usesOperatorEndpoint = !config.baseUrl || config.baseUrl.replace(/\/+$/, '') === operatorBaseUrl;
    const apiKey = config.apiKey || (usesOperatorEndpoint ? process.env.OLLAMA_API_KEY : undefined);
    logger.info(`[Summarizer] Using Ollama at ${baseUrl} (${model})`);

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await axios.post(
        `${baseUrl}/api/chat`,
        {
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          think: false,
          options: { temperature: 0.1, num_predict: MAX_TOKENS },
        },
        {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: controller.signal as any,
          ...LLM_AGENTS,
        }
      );
      const content = response.data.message?.content || '';
      if (!content || content.trim().length === 0) {
        throw new Error('Ollama returned empty summary');
      }
      return cleanOutput(content);
    } finally {
      clearTimeout(tid);
    }
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
