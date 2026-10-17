/**
 * Anthropic Tool Call Helper
 * Calls Anthropic with tool_choice forced to a single named tool (or left to
 * the model, for models that reject forcing) and returns the tool's structured
 * input directly, instead of parsing JSON out of a free-form text completion.
 *
 * None of the tools this helper is used with set `strict: true`, so
 * `tool_use.input` is never validated server-side against the schema.
 * Callers must keep their own field-level checks (throw / typeof guard /
 * fallback) on the returned value - the `T` cast below is a compile-time
 * hint, not a runtime guarantee, unless a `zodSchema` is supplied.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Tool,
  ToolChoice,
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';

// Prefixes of models that answer `temperature` (and other sampling settings) with a 400.
const MODELS_REJECTING_SAMPLING = [
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-5-5',
];

// Prefixes of models that answer a forced `tool_choice` (`tool` or `any`) with a 400.
const MODELS_REJECTING_FORCED_TOOL_CHOICE = [
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
];

function matchesAny(model: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => model.startsWith(prefix));
}

export class AnthropicToolCallError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AnthropicToolCallError';
  }
}

export class AnthropicToolCallTruncatedError extends AnthropicToolCallError {
  constructor(stopReason: string | null) {
    super(`Anthropic response truncated before tool call completed (stop_reason: ${stopReason})`);
    this.name = 'AnthropicToolCallTruncatedError';
  }
}

export interface CallAnthropicWithToolOptions<T> {
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature?: number;
  system?: string;
  userMessage: MessageParam['content'];
  tool: Tool;
  /**
   * Optional Zod schema for runtime validation of tool_use.input. Its
   * absence does NOT mean the result is safe to trust blindly - it means
   * the call site's own pre-existing field-level checks are doing that job
   * instead, and must not be removed when migrating a call site onto this
   * helper.
   */
  zodSchema?: z.ZodType<T>;
}

/**
 * Calls Anthropic with a single tool forced via tool_choice (with parallel
 * tool use disabled, so the model cannot invoke the forced tool more than
 * once), and returns the tool's `input`, cast - or, if `zodSchema` is
 * supplied, validated and parsed - as T.
 *
 * Throws AnthropicToolCallError (or the AnthropicToolCallTruncatedError
 * subclass) only for structural failures: no tool_use block returned,
 * response truncated by max_tokens, or zod validation failure. It does not
 * validate T's field-level shape/values unless zodSchema is supplied.
 */
export async function callAnthropicWithTool<T>(
  opts: CallAnthropicWithToolOptions<T>
): Promise<T> {
  const anthropic = new Anthropic({ apiKey: opts.apiKey || process.env.ANTHROPIC_API_KEY });

  // Models that reject forcing pick the tool themselves; a reply without it
  // still raises AnthropicToolCallError below.
  const toolChoice: ToolChoice = matchesAny(opts.model, MODELS_REJECTING_FORCED_TOOL_CHOICE)
    ? { type: 'auto', disable_parallel_tool_use: true }
    : { type: 'tool', name: opts.tool.name, disable_parallel_tool_use: true };

  const messages: MessageParam[] = [
    { role: 'user', content: opts.userMessage },
  ];

  const response = await anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    ...(matchesAny(opts.model, MODELS_REJECTING_SAMPLING) ? {} : { temperature: opts.temperature }),
    system: opts.system,
    messages,
    tools: [opts.tool],
    tool_choice: toolChoice,
  });

  if (response.stop_reason === 'max_tokens') {
    throw new AnthropicToolCallTruncatedError(response.stop_reason);
  }

  const toolUseBlock = response.content.find(
    (block): block is ToolUseBlock => block.type === 'tool_use' && block.name === opts.tool.name
  );

  if (!toolUseBlock) {
    throw new AnthropicToolCallError(
      `Anthropic did not return a tool_use block for "${opts.tool.name}" (stop_reason: ${response.stop_reason})`
    );
  }

  const rawInput = toolUseBlock.input;

  if (opts.zodSchema) {
    const result = opts.zodSchema.safeParse(rawInput);
    if (!result.success) {
      throw new AnthropicToolCallError(
        `Tool input for "${opts.tool.name}" failed schema validation: ${result.error.message}`
      );
    }
    return result.data;
  }

  return rawInput as T;
}
