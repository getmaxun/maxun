/**
 * Validates the inputs of an AI Extract request. The website URL is required:
 * it is the only page the robot reads, and there is no search or guessing of
 * a site from the prompt.
 */
import { normalizeRobotUrl } from '../../utils/robot-updates';

export const MIN_EXTRACT_PROMPT_LENGTH = 15;

export type ExtractInputCheck =
  | { ok: true; url: string; prompt: string }
  | { ok: false; error: string };

export function checkAiExtractInput(
  rawUrl: unknown,
  rawPrompt: unknown,
  options: { requireDetailedPrompt?: boolean } = {},
): ExtractInputCheck {
  const requireDetailedPrompt = options.requireDetailedPrompt ?? true;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      ok: false,
      error: 'The "url" field is required. Enter the web page to extract from, e.g. https://example.com/products.',
    };
  }

  let url: string;
  try {
    url = normalizeRobotUrl(rawUrl);
  } catch (error: any) {
    return { ok: false, error: `Invalid URL: ${error.message}` };
  }

  if (typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return { ok: false, error: 'The "prompt" field is required. Describe the data to extract from the page.' };
  }
  const prompt = rawPrompt.trim();
  if (requireDetailedPrompt && prompt.length < MIN_EXTRACT_PROMPT_LENGTH) {
    return {
      ok: false,
      error: 'Extraction prompt is too short. Describe what you want to extract (e.g., "Extract the product names, prices and ratings").',
    };
  }
  if (requireDetailedPrompt && /field_\d+/i.test(prompt)) {
    return {
      ok: false,
      error: 'Extraction prompt looks like a template placeholder. Please replace it with a specific description of what you want to extract.',
    };
  }
  return { ok: true, url, prompt };
}
