/**
 * Browser Agent (OSS)
 * Executes user-defined prompt instructions on an already-open browser page using an LLM.
 * Supports Anthropic, OpenAI-compatible, and Ollama providers.
 */

import { Page } from 'playwright-core';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import logger from '../logger';

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

interface AgentAction {
  action: 'click' | 'type' | 'navigate' | 'scroll' | 'wait' | 'press' | 'select' | 'check' | 'hover' | 'done';
  selector?: string;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  key?: string;
  value?: string;
  result?: string;
  reason?: string;
}

export interface AgentStep {
  stepNumber: number;
  action: string;
  description: string;
  timestamp: string;
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentResult {
  result: string;
  steps: AgentStep[];
  success: boolean;
  tokenUsage: TokenUsage;
}

interface LLMCallResult {
  action: AgentAction;
  tokens: TokenUsage;
}

const MAX_STEPS = 20;
const LLM_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `You are a browser automation agent. You receive the visible page text, a list of interactive elements, and a screenshot.

Respond with ONLY a JSON object — no explanation, no markdown, just raw JSON.

Action formats:
{"action":"done","result":"answer or result"}
{"action":"click","selector":"[data-agent-idx=\\"5\\"]","reason":"why"}
{"action":"type","selector":"[data-agent-idx=\\"3\\"]","text":"text to enter","reason":"why"}
{"action":"press","key":"Enter","reason":"why"}
{"action":"select","selector":"[data-agent-idx=\\"7\\"]","value":"option text or value","reason":"why"}
{"action":"check","selector":"[data-agent-idx=\\"9\\"]","reason":"why"}
{"action":"hover","selector":"[data-agent-idx=\\"2\\"]","reason":"why"}
{"action":"navigate","url":"https://...","reason":"why"}
{"action":"scroll","direction":"down","amount":400,"reason":"why"}
{"action":"wait","reason":"why"}
{"action":"wait","selector":"[data-agent-idx=\\"4\\"]","reason":"wait for element to appear"}

Rules:
1. If you can fulfil the instruction from the page text or screenshot without interacting with the page, use {"action":"done","result":"..."} immediately.
2. Only use actions when the page must change to fulfil the instruction.
3. For selectors always use [data-agent-idx="N"] from the element list — never invent class-based CSS selectors.
4. After typing into a search or form field, use {"action":"press","key":"Enter"} to submit it.
5. For dropdowns, use "select" not "click". For checkboxes/toggles, use "check" not "click".
6. If a previous step shows "← FAILED", that action did not work — try a different approach.
7. For ordinal/positional queries ("10th item", "first result", "last company"): use the screenshot to visually count and identify the item, then cross-reference with the page text to retrieve its full details. Return the result directly with {"action":"done","result":"..."}.
8. Maximum ${MAX_STEPS} total steps.`;

function extractJson(content: string): AgentAction {
  const cleaned = content.trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { action: 'done', result: cleaned || 'No result returned by LLM' };
  }
  try {
    const parsed = JSON.parse(cleaned.substring(start, end + 1));
    if (parsed.result !== undefined && typeof parsed.result !== 'string') {
      parsed.result = JSON.stringify(parsed.result, null, 2);
    }
    return parsed;
  } catch {
    return { action: 'done', result: cleaned };
  }
}

async function capturePageState(page: Page): Promise<{
  screenshotBase64: string;
  elements: string;
  pageText: string;
  structuredItems: string;
  url: string;
  title: string;
}> {
  const [screenshotBuffer, elementData, pageText, structuredItems, pageInfo] = await Promise.all([
    page.screenshot({ type: 'jpeg', quality: 50 }).catch(() => Buffer.from('')),
    page.evaluate(() => {
      const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex="0"]';
      const candidates = Array.from(document.querySelectorAll(selectors));
      let count = 0;
      const lines: string[] = [];
      for (const el of candidates as HTMLElement[]) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
        const text = (
          el.innerText || (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder ||
          el.getAttribute('aria-label') || el.getAttribute('title') || ''
        ).trim().substring(0, 70);
        if (!text) continue;
        el.setAttribute('data-agent-idx', String(count));
        const tag = el.tagName.toLowerCase();
        const type = (el as HTMLInputElement).type || null;
        const href = (el as HTMLAnchorElement).href
          ? ' → ' + (el as HTMLAnchorElement).href.substring(0, 80)
          : '';
        lines.push(`${count}. [${tag}${type ? `:${type}` : ''}] "${text}"${href}  (selector: [data-agent-idx="${count}"])`);
        count++;
        if (count >= 40) break;
      }
      return lines.join('\n');
    }).catch(() => ''),
    page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'meta', 'head'].includes(tag)) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const chunks: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode()) !== null) {
        const t = (node.textContent || '').trim();
        if (t.length > 1) chunks.push(t);
      }
      const deduped: string[] = [];
      for (const c of chunks) {
        if (deduped[deduped.length - 1] !== c) deduped.push(c);
      }
      return deduped.join('\n').substring(0, 12000);
    }).catch(() => ''),
    page.evaluate(() => {
      function isHidden(el: HTMLElement): boolean {
        const s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
      }
      let bestItems: HTMLElement[] = [];
      let bestScore = 0;
      const containers = Array.from(
        document.querySelectorAll('ul, ol, div, section, main, tbody, [role="list"]')
      ) as HTMLElement[];
      for (const parent of containers) {
        if (isHidden(parent)) continue;
        const children = Array.from(parent.children) as HTMLElement[];
        if (children.length < 3) continue;
        const contentChildren = children.filter(el => {
          if (isHidden(el)) return false;
          const text = el.innerText?.trim() ?? '';
          return text.length >= 40;
        });
        if (contentChildren.length < 3) continue;
        const totalLen = contentChildren.reduce((s, el) => s + (el.innerText?.trim().length ?? 0), 0);
        const avgLen = totalLen / contentChildren.length;
        const score = contentChildren.length * avgLen;
        if (score > bestScore) {
          bestScore = score;
          bestItems = contentChildren;
        }
      }
      if (bestItems.length === 0) return '';
      return bestItems.slice(0, 50).map((el, i) => {
        const text = el.innerText?.trim().replace(/\s+/g, ' ').substring(0, 400) || '';
        return text ? `[${i + 1}] ${text}` : null;
      }).filter(Boolean).join('\n\n');
    }).catch(() => ''),
    page.evaluate(() => ({
      url: window.location.href,
      title: document.title || ''
    })).catch(() => ({ url: '', title: '' })),
  ]);

  const info = pageInfo as { url: string; title: string };
  return {
    screenshotBase64: screenshotBuffer.length > 0 ? screenshotBuffer.toString('base64') : '',
    elements: elementData as string,
    pageText: pageText as string,
    structuredItems: structuredItems as string,
    url: info.url,
    title: info.title,
  };
}

function buildMessages(
  promptInstructions: string,
  pageState: { screenshotBase64: string; elements: string; pageText: string; structuredItems?: string; url: string; title: string },
  previousSteps: AgentStep[]
): any[] {
  const history = previousSteps.length > 0
    ? `\nPrevious steps:\n${previousSteps.map(s =>
      `  Step ${s.stepNumber}: ${s.action} — ${s.description}${s.error ? ` ← FAILED: ${s.error}` : ' ✓'}`
    ).join('\n')}`
    : '';

  const structuredSection = pageState.structuredItems
    ? `\nNumbered item list (USE THIS for any ordinal/positional queries — items are explicitly numbered [1], [2], etc.):\n${pageState.structuredItems}\n`
    : '';

  const userText = `Page URL: ${pageState.url}
Page title: ${pageState.title}
${history}
${structuredSection}
Page text content (use this to answer data extraction questions directly):
${pageState.pageText ? pageState.pageText.substring(0, 10000) : '(no text captured)'}

Interactive elements (only needed if you must click/type):
${pageState.elements || '(none detected)'}

Instruction: ${promptInstructions}

What is the next action? Respond with JSON only.`;

  if (pageState.screenshotBase64) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${pageState.screenshotBase64}` } },
          { type: 'text', text: userText },
        ],
      },
    ];
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userText },
  ];
}

async function callAnthropic(config: LLMConfig, messages: any[]): Promise<LLMCallResult> {
  const anthropic = new Anthropic({ apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY });
  const model = config.model || 'claude-sonnet-4-6';

  const systemMsg = messages.find((m: any) => m.role === 'system');
  const userMsg = messages.find((m: any) => m.role === 'user');

  const anthropicContent: any[] = [];
  if (Array.isArray(userMsg.content)) {
    for (const block of userMsg.content) {
      if (block.type === 'image_url') {
        const raw: string = block.image_url?.url || '';
        const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
        anthropicContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
      } else if (block.type === 'text') {
        anthropicContent.push({ type: 'text', text: block.text });
      }
    }
  } else {
    anthropicContent.push({ type: 'text', text: userMsg.content });
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 256,
    system: systemMsg?.content || SYSTEM_PROMPT,
    messages: [{ role: 'user', content: anthropicContent }],
  });

  const textContent = response.content.find((c: any) => c.type === 'text');
  const content = textContent?.type === 'text' ? textContent.text : '';
  return {
    action: extractJson(content),
    tokens: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

async function callOpenAI(config: LLMConfig, messages: any[]): Promise<LLMCallResult> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'gpt-4o';

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      { model, messages, max_tokens: 256, temperature: 0.1 },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey || process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal as any,
      }
    );

    const content = response.data.choices?.[0]?.message?.content || '';
    const promptTokens = response.data.usage?.prompt_tokens ?? 0;
    const completionTokens = response.data.usage?.completion_tokens ?? 0;
    return {
      action: extractJson(content),
      tokens: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  } finally {
    clearTimeout(tid);
  }
}

async function callOllama(config: LLMConfig, messages: any[]): Promise<LLMCallResult> {
  const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = config.model || 'llama3.2-vision';

  const ollamaMessages = messages.map((m: any) => {
    const images = Array.isArray(m.content)
      ? m.content
          .filter((c: any) => c.type === 'image_url')
          .map((c: any) => {
            const url: string = c.image_url?.url || '';
            return url.includes(',') ? url.split(',')[1] : url;
          })
      : [];
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
        : '';
    return { role: m.role, content: text, ...(images.length > 0 ? { images } : {}) };
  });

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await axios.post(
      `${baseUrl}/api/chat`,
      { model, messages: ollamaMessages, stream: false, format: 'json', options: { temperature: 0.1, num_predict: 256 } },
      { signal: controller.signal as any }
    );

    const content = response.data.message?.content || '';
    const promptTokens = response.data.prompt_eval_count ?? 0;
    const completionTokens = response.data.eval_count ?? 0;
    return {
      action: extractJson(content),
      tokens: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  } finally {
    clearTimeout(tid);
  }
}

async function callLLM(messages: any[], config: LLMConfig): Promise<LLMCallResult> {
  const provider = config.provider;

  if (provider === 'anthropic') {
    const result = await callAnthropic(config, messages);
    logger.info('[BrowserAgent] Anthropic responded');
    return result;
  }

  if (provider === 'openai') {
    const result = await callOpenAI(config, messages);
    logger.info('[BrowserAgent] OpenAI responded');
    return result;
  }

  if (provider === 'ollama') {
    const result = await callOllama(config, messages);
    logger.info('[BrowserAgent] Ollama responded');
    return result;
  }

  throw new Error(`[BrowserAgent] Unsupported LLM provider: ${provider}`);
}

async function callLLMRawText(messages: any[], config: LLMConfig): Promise<string | null> {
  try {
    const provider = config.provider;

    if (provider === 'anthropic') {
      const anthropic = new Anthropic({ apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY });
      const model = config.model || 'claude-sonnet-4-6';
      const systemMsg = messages.find((m: any) => m.role === 'system');
      const userMsgs = messages.filter((m: any) => m.role !== 'system');
      const response = await anthropic.messages.create({
        model,
        max_tokens: 512,
        system: systemMsg?.content,
        messages: userMsgs.map((m: any) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : '',
        })),
      });
      const textContent = response.content.find((c: any) => c.type === 'text');
      return textContent?.type === 'text' ? textContent.text : null;
    }

    if (provider === 'openai') {
      const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
      const model = config.model || 'gpt-4o';
      const textMessages = messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : '',
      }));
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        { model, messages: textMessages, max_tokens: 512, temperature: 0.1 },
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey || process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.choices?.[0]?.message?.content || null;
    }

    if (provider === 'ollama') {
      const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const model = config.model || 'llama3.2-vision';
      const textMessages = messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      }));
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await axios.post(
          `${baseUrl}/api/chat`,
          { model, messages: textMessages, stream: false },
          { signal: controller.signal as any }
        );
        return response.data.message?.content || null;
      } finally {
        clearTimeout(tid);
      }
    }

    return null;
  } catch (err: any) {
    logger.warn(`[BrowserAgent] Raw LLM call failed: ${err.message}`);
    return null;
  }
}

function looksLikeCSSSelector(s: string): boolean {
  return /^[.#\[*]/.test(s) || /[\s>~+]/.test(s) || /:nth|:first|:last|:not\(/.test(s);
}

async function executeAction(page: Page, action: AgentAction): Promise<void> {
  switch (action.action) {
    case 'click': {
      const sel = action.selector;
      if (!sel) throw new Error('click: missing selector');
      const isCSS = looksLikeCSSSelector(sel);
      try {
        await page.click(sel, { timeout: 5000 });
      } catch (cssErr: any) {
        if (isCSS) {
          throw new Error(`CSS selector did not match any element: "${sel}". Use a [data-agent-idx="N"] selector from the element list instead.`);
        }
        try {
          await page.getByText(sel, { exact: false }).first().click({ timeout: 5000 });
        } catch {
          throw new Error(`Could not click "${sel}" — element not found by CSS or by text.`);
        }
      }
      break;
    }
    case 'type': {
      if (!action.selector) throw new Error('type: missing selector');
      if (action.text === undefined) throw new Error('type: missing text');
      await page.click(action.selector, { timeout: 5000 });
      await page.fill(action.selector, action.text);
      break;
    }
    case 'navigate': {
      if (!action.url) throw new Error('navigate: missing url');
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    }
    case 'scroll': {
      const dy = (action.amount || 300) * (action.direction === 'up' ? -1 : 1);
      await page.evaluate((delta) => window.scrollBy(0, delta), dy);
      break;
    }
    case 'press': {
      if (!action.key) throw new Error('press: missing key');
      await page.keyboard.press(action.key);
      break;
    }
    case 'select': {
      if (!action.selector) throw new Error('select: missing selector');
      if (!action.value) throw new Error('select: missing value');
      await page.selectOption(action.selector, { label: action.value }).catch(async () => {
        await page.selectOption(action.selector!, { value: action.value! });
      });
      break;
    }
    case 'check': {
      if (!action.selector) throw new Error('check: missing selector');
      await page.click(action.selector, { timeout: 5000 });
      break;
    }
    case 'hover': {
      if (!action.selector) throw new Error('hover: missing selector');
      await page.hover(action.selector, { timeout: 5000 });
      break;
    }
    case 'wait': {
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: 10000 });
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      break;
    }
  }
}

const ORDINAL_QUERY_PATTERN = /\b(\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|bottom)\b/i;

async function tryDirectExtraction(
  pageState: { pageText: string; structuredItems?: string; url: string; title: string },
  promptInstructions: string,
  config: LLMConfig
): Promise<string | null> {
  if (!pageState.pageText) return null;

  const isOrdinal = ORDINAL_QUERY_PATTERN.test(promptInstructions);
  if (isOrdinal && !pageState.structuredItems) {
    logger.info('[BrowserAgent] Ordinal query detected, no structured items — falling back to action loop');
    return null;
  }

  const structuredSection = isOrdinal && pageState.structuredItems
    ? `Numbered item list (items are explicitly numbered — use this to answer the ordinal query):\n${pageState.structuredItems}\n\n`
    : '';

  const messages = [
    { role: 'system', content: 'You are a data extraction assistant. Follow the response format exactly as instructed.' },
    {
      role: 'user',
      content: `Page URL: ${pageState.url}
Page title: ${pageState.title}

${structuredSection}Page content:
${pageState.pageText.substring(0, 12000)}

Task: ${promptInstructions}

If you can fulfil this task using only the page content above, start your response with "ANSWER:" followed by your answer.
If the task requires interacting with the page (clicking buttons, filling forms, navigating), respond with only the word "INTERACT".`,
    },
  ];

  const raw = await callLLMRawText(messages, config);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().startsWith('ANSWER:')) {
    const answer = trimmed.substring(7).trim();
    if (answer.length > 0) {
      logger.info(`[BrowserAgent] Direct extraction succeeded: "${answer.substring(0, 200)}"`);
      return answer;
    }
  }
  logger.info('[BrowserAgent] Model indicated page interaction is needed');
  return null;
}

/**
 * Execute prompt instructions on an open browser page using an LLM agent.
 * First attempts direct extraction from page text; falls back to the full
 * observe → decide → act loop only when page interaction is genuinely needed.
 */
export async function executeBrowserAgent(
  page: Page,
  promptInstructions: string,
  llmConfig: LLMConfig
): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  let finalResult = '';
  const accTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  function addTokens(t: TokenUsage) {
    accTokens.promptTokens += t.promptTokens;
    accTokens.completionTokens += t.completionTokens;
    accTokens.totalTokens += t.totalTokens;
  }

  logger.info(`[BrowserAgent] Starting agent. Provider: ${llmConfig.provider}. Prompt: "${promptInstructions.substring(0, 120)}"`);

  const initialPageState = await capturePageState(page);
  const directResult = await tryDirectExtraction(initialPageState, promptInstructions, llmConfig);
  if (directResult !== null) {
    logger.info(`[BrowserAgent] Token usage — prompt: ${accTokens.promptTokens}, completion: ${accTokens.completionTokens}, total: ${accTokens.totalTokens}`);
    return { result: directResult, steps: [], success: true, tokenUsage: accTokens };
  }

  logger.info('[BrowserAgent] Direct extraction insufficient — starting action loop');

  for (let step = 0; step < MAX_STEPS; step++) {
    try {
      const pageState = step === 0 ? initialPageState : await capturePageState(page);
      const messages = buildMessages(promptInstructions, pageState, steps);

      const { action, tokens } = await callLLM(messages, llmConfig);
      addTokens(tokens);

      logger.info(`[BrowserAgent] Step ${step + 1}: ${JSON.stringify(action)}`);

      const agentStep: AgentStep = {
        stepNumber: step + 1,
        action: action.action,
        description: action.reason || action.result || action.selector || action.url || action.action,
        timestamp: new Date().toISOString(),
      };
      steps.push(agentStep);

      if (action.action === 'done') {
        finalResult = action.result || '';
        logger.info(`[BrowserAgent] Done in ${step + 1} step(s). Result: "${finalResult.substring(0, 200)}"`);
        break;
      }

      await executeAction(page, action);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
      await new Promise(resolve => setTimeout(resolve, 800));

    } catch (err: any) {
      const shortError = err.message.split('\n')[0].substring(0, 200);
      logger.warn(`[BrowserAgent] Step ${step + 1} error: ${shortError}`);

      if (steps.length > 0) {
        steps[steps.length - 1].error = shortError;
      }

      if (step === MAX_STEPS - 1) {
        finalResult = `Agent stopped after ${step + 1} steps. Last error: ${shortError}`;
      }
    }
  }

  if (!finalResult) {
    finalResult = `Agent completed ${steps.length} step(s) but did not return a final result.`;
  }

  logger.info(`[BrowserAgent] Token usage — prompt: ${accTokens.promptTokens}, completion: ${accTokens.completionTokens}, total: ${accTokens.totalTokens}`);
  return { result: finalResult, steps, success: true, tokenUsage: accTokens };
}
