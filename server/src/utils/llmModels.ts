/**
 * Default model per provider, used when a robot does not specify one.
 *
 * Model IDs were previously hardcoded at ~37 call sites, which let them drift:
 * two different Anthropic defaults and three different OpenAI ones coexisted, so
 * the same robot could run on a different model depending on which code path
 * executed. These constants are now the only place a model name appears.
 *
 * A default is required rather than making the field mandatory: robots created
 * before model selection existed have no model stored, and they must keep
 * running without the operator migrating anything.
 */

export type LlmProviderName = 'anthropic' | 'openai' | 'ollama';

/**
 * Anthropic and OpenAI defaults are multimodal, so one entry each covers both
 * text and screenshot work. Ollama is split because its vision and text models
 * are separate downloads and an operator may only have pulled one.
 */
export const DEFAULT_LLM_MODELS: Record<LlmProviderName, string> = {
  // Anthropic's balanced tier: "the best combination of speed and intelligence".
  // Opus 5 and Fable 5 sit above it but cost 1.7x and 3.3x more per token.
  anthropic: 'claude-sonnet-5',
  // OpenAI's balanced tier, chosen over gpt-5.6-sol on the same cost reasoning.
  openai: 'gpt-5.6-terra',
  ollama: 'llama3.2-vision',
};

/**
 * Text-only default. Falls back to the main default for providers whose model
 * handles both.
 */
export const DEFAULT_LLM_TEXT_MODELS: Record<LlmProviderName, string> = {
  anthropic: DEFAULT_LLM_MODELS.anthropic,
  openai: DEFAULT_LLM_MODELS.openai,
  ollama: 'llama3.2',
};

/**
 * Returns the model to use: whatever the robot stored, or this provider's
 * default. `requireVision` is only meaningful for Ollama.
 */
export function resolveLlmModel(
  model: string | undefined,
  provider: string,
  options: { textOnly?: boolean } = {}
): string {
  const explicit = typeof model === 'string' ? model.trim() : '';
  if (explicit) return explicit;

  const table = options.textOnly ? DEFAULT_LLM_TEXT_MODELS : DEFAULT_LLM_MODELS;
  return table[provider as LlmProviderName] ?? DEFAULT_LLM_MODELS.ollama;
}
