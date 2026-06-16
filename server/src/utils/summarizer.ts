import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import logger from '../logger';
import { LLMConfig } from '../sdk/browserAgent';

const SYSTEM_PROMPT = `You are a web page summarizer. Your output is plain text only.

STRICT RULES — violating any of these is an error:
- Output ONLY the summary. Do not write any preamble, intro, or closing. Do not say "Here is", "Here's", "Sure", "This page", "In summary", "Conclusion", or anything like that. Start immediately with the content.
- NO markdown of any kind: no ** bold **, no * italic *, no ## headers, no \`code\`, no > quotes, no --- dividers, no code fences.
- NO section headers or titles. Do not label sections like "Benefits:", "Top Tools:", "Conclusion:", etc.
- Write 2–4 plain sentences covering the main point. Then, only if there is a genuine list (features, named items, steps), add plain bullet points using a hyphen (-). No bold inside bullet points.
- Keep it short and factual. Do not pad, repeat, or editorialize.`;

const USER_PROMPT_PREFIX = `Summarize the following web page in plain text. Start directly with the summary — no intro, no headings, no bold, no markdown.\n\n`;

const MAX_TOKENS = 1500;

function cleanOutput(text: string): string {
  let out = text.trim();

  // Strip code fences
  const fenceMatch = out.match(/^```(?:markdown)?\r?\n([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    out = fenceMatch[1].trim();
  } else if (out.startsWith('```')) {
    out = out.replace(/^```[^\n]*\n/, '').replace(/```\s*$/, '').trim();
  }

  // Strip markdown bold/italic (**text**, *text*, __text__, _text_)
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/_([^_]+)_/g, '$1');

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
    const model = config.model || 'claude-haiku-4-5-20251001';
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
    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const model = config.model || 'gpt-4o-mini';
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
          'Authorization': `Bearer ${config.apiKey || process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );
    const content = response.data.choices?.[0]?.message?.content || '';
    if (!content || content.trim().length === 0) {
      throw new Error('OpenAI returned empty summary');
    }
    return cleanOutput(content);
  }

  if (provider === 'ollama') {
    const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = config.model || 'llama3.2';
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
          options: { temperature: 0.1, num_predict: MAX_TOKENS },
        },
        { signal: controller.signal as any }
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
