/**
 * Step 1 of AI Extract: turn the user's prompt into an extraction spec
 * (what to extract) before looking at page structure. The spec, not any
 * group or list the page happens to contain, is what the rest of the
 * pipeline extracts.
 *
 * The spec is saved with the robot in recording_meta.aiExtract.
 */
import { JsonLLM } from './llmClient';

export type FieldType = 'text' | 'number' | 'price' | 'date' | 'url' | 'image' | 'email' | 'phone';

export interface SpecField {
  name: string;
  type: FieldType;
  description: string;
}

export interface ExtractionSpec {
  /** "list" → scrapeList, "single" → scrapeSchema. */
  shape: 'list' | 'single';
  /** Short name for the data, used as the action name. */
  name: string;
  fields: SpecField[];
  /** Only when the user asked for a specific number of items. */
  limit: number | null;
}

const FIELD_TYPES: FieldType[] = ['text', 'number', 'price', 'date', 'url', 'image', 'email', 'phone'];
const MAX_FIELDS = 12;

const SYSTEM = 'You turn a web data extraction request into a JSON extraction spec. Reply with JSON only.';

function buildUserPrompt(prompt: string, pageTitle: string): string {
  return `Request: "${prompt}"
Page title: "${pageTitle}"

Return JSON only, in this shape:
{"shape": "list", "name": "Job Listings", "fields": [{"name": "Job Title", "type": "text", "description": "the job's title"}], "limit": null}

Rules:
- shape: "list" when the request is about several similar items (jobs, products, rows, tags, articles, results). "single" when it asks for one or a few specific values (one price, a date, an address).
- fields: the values the user asked for, named in the user's own words, in Title Case. If the user named no fields, choose the 2 to 6 most useful values of each item.
- type: one of ${FIELD_TYPES.join(', ')}. Use "url" only for links and "image" only for pictures.
- Do not add a field for something the user did not ask for unless no fields were named.
- limit: a number only if the user asked for a specific count, otherwise null.`;
}

/** Normalizes whatever the model returned into a valid spec, or throws. */
export function normalizeSpec(raw: any): ExtractionSpec {
  const shape = raw?.shape === 'single' ? 'single' : 'list';
  const seen = new Set<string>();
  const fields: SpecField[] = [];
  for (const f of Array.isArray(raw?.fields) ? raw.fields : []) {
    const name = String(f?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const type = FIELD_TYPES.includes(f?.type) ? f.type : 'text';
    fields.push({ name, type, description: String(f?.description || '').slice(0, 200) });
    if (fields.length >= MAX_FIELDS) break;
  }
  if (fields.length === 0) throw new Error('The request could not be turned into fields to extract');
  const limit = Number.isInteger(raw?.limit) && raw.limit > 0 ? raw.limit : null;
  const name = String(raw?.name || '').trim().slice(0, 60) || (shape === 'list' ? 'List' : 'Values');
  return { shape, name, fields, limit };
}

export async function buildExtractionSpec(
  llm: JsonLLM,
  prompt: string,
  pageTitle: string,
  deadline?: number,
): Promise<{ spec: ExtractionSpec; provider: string }> {
  const { json, provider } = await llm({
    label: 'spec',
    deadline,
    system: SYSTEM,
    user: buildUserPrompt(prompt, pageTitle),
    maxTokens: 800,
  });
  return { spec: normalizeSpec(json), provider };
}
