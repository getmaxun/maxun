/**
 * Steps 2–3 of AI Extract: show the model the page as short id-tagged lines
 * and have it cite, for each requested field, the line its value comes from.
 * Code then checks every citation, so a value the page does not contain can
 * never reach a robot.
 */
import logger from '../../logger';
import { JsonLLM } from './llmClient';
import { ExtractionSpec } from './spec';
import { countStemMatches, promptKeywordStems } from './keywords';

export interface SnapshotLine {
  id: string;
  tag: string;
  depth: number;
  text: string;
  href?: string;
  src?: string;
}

export interface PageSnapshot {
  title: string;
  url: string;
  lines: SnapshotLine[];
  truncated: boolean;
}

/** A field value as cited by the model: the line id, plus the exact value when it is part of that line. */
export interface Citation {
  aid: string;
  value?: string;
}

export type CitedRow = Record<string, Citation>;

export interface GroundedExtraction {
  rows: CitedRow[];
  provider: string;
  chunkIndex: number;
}

const DEFAULT_CHUNK_CHARS = 18_000;
const MAX_CHUNKS_TRIED = 3;
const MAX_EXAMPLE_ITEMS = 8;

const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function formatLine(line: SnapshotLine, baseDepth: number, origin: string): string {
  const indent = ' '.repeat(Math.min(8, Math.max(0, line.depth - baseDepth)));
  const shortUrl = (u?: string) => (u && origin && u.startsWith(origin) ? u.slice(origin.length) || '/' : u);
  let out = `${indent}${line.id} ${line.tag} | ${line.text}`;
  if (line.href) out += ` -> ${shortUrl(line.href)}`;
  if (line.src) out += ` [image ${shortUrl(line.src)}]`;
  return out;
}

/** Splits the snapshot into prompt-sized chunks, most relevant to the request first. */
export interface SnapshotChunk {
  text: string;
  ids: Set<string>;
  /** The chunk's lines in page order, for locating values the model quotes. */
  lines: SnapshotLine[];
  index: number;
}

export function chunkSnapshot(snapshot: PageSnapshot, prompt: string, spec: ExtractionSpec): SnapshotChunk[] {
  const budget = Number(process.env.AI_EXTRACT_CHUNK_CHARS) || DEFAULT_CHUNK_CHARS;
  const baseDepth = snapshot.lines.reduce((m, l) => Math.min(m, l.depth), Infinity);
  let origin = '';
  try { origin = new URL(snapshot.url).origin; } catch { /* keep absolute urls */ }

  const chunks: SnapshotChunk[] = [];
  let current: string[] = [];
  let lines: SnapshotLine[] = [];
  let ids = new Set<string>();
  let size = 0;
  for (const line of snapshot.lines) {
    const formatted = formatLine(line, baseDepth, origin);
    if (size + formatted.length > budget && current.length > 0) {
      chunks.push({ text: current.join('\n'), ids, lines, index: chunks.length });
      current = [];
      lines = [];
      ids = new Set();
      size = 0;
    }
    current.push(formatted);
    lines.push(line);
    ids.add(line.id);
    size += formatted.length + 1;
  }
  if (current.length > 0) chunks.push({ text: current.join('\n'), ids, lines, index: chunks.length });

  if (chunks.length <= 1) return chunks;
  const stems = promptKeywordStems(`${prompt} ${spec.fields.map((f) => f.name).join(' ')}`);
  return chunks
    .map((c) => ({ c, hits: countStemMatches(c.text, stems) }))
    .sort((a, b) => b.hits - a.hits || a.c.index - b.c.index)
    .map(({ c }) => c);
}

const SYSTEM = 'You extract data from one web page. You only cite lines that exist in the page content you are given; you never refer to other pages. Reply with JSON only.';

function buildUserPrompt(prompt: string, spec: ExtractionSpec, chunk: string): string {
  const fieldList = spec.fields.map((f) => `- "${f.name}" (${f.type})${f.description ? `: ${f.description}` : ''}`).join('\n');
  const exampleFields = spec.fields.slice(0, 2).map((f, i) => `"${f.name}": {"value": "<text copied from line n${12 + i * 3}>", "id": "n${12 + i * 3}"}`).join(', ');
  const shapeRules = spec.shape === 'list'
    ? `Return the first ${MAX_EXAMPLE_ITEMS} (or fewer) items that answer the request, in page order. Skip navigation, ads, footers and unrelated lists.
JSON shape: {"items": [{${exampleFields}}, ...]}
If nothing on the page answers the request, return {"items": []}.`
    : `JSON shape: {"values": {${exampleFields}}}
If nothing on the page answers the request, return {"values": {}}.`;

  return `Request: "${prompt}"

Fields:
${fieldList}

Page content. Each line is: <id> <tag> | <text>. Links end with "-> url", images with [image url]. Indentation shows nesting.
${chunk}

Task: find the data that answers the request, using only this page content. Do not guess values that are not shown.
For each field give "value": the text copied EXACTLY from one line of the page content (do not reword, total or translate it), and "id": that line's id. Use null for a field an item does not have.
For "url" fields give the link's url as the value; for "image" fields the image url.
${shapeRules}

Reminder - request: "${prompt}"; fields: ${spec.fields.map((f) => `"${f.name}"`).join(', ')}.`;
}

/** Rows from whatever container the model used: {"items": [...]}, {"plans": [...]}, a bare array, or one object. */
function entriesFrom(raw: any, shape: ExtractionSpec['shape']): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (shape === 'single') {
    if (raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values)) return [raw.values];
    if (Array.isArray(raw.values)) return raw.values.slice(0, 1);
    return [raw];
  }
  if (Array.isArray(raw.items)) return raw.items;
  const arrays = Object.values(raw).filter((v) => Array.isArray(v)) as any[][];
  return arrays.sort((a, b) => b.length - a.length)[0] || [];
}

const LINE_ID = /^\[?n?(\d+)\]?$/i;

/** The line id and quoted value in one cell, whatever shape the model used. */
function readCell(cell: any): { id?: string; value?: string } {
  if (cell == null) return {};
  if (typeof cell === 'number') return { id: `n${cell}` };
  if (typeof cell === 'string') {
    const m = cell.trim().match(LINE_ID);
    return m ? { id: `n${m[1]}` } : { value: cell };
  }
  if (typeof cell === 'object') {
    const rawId = cell.id ?? cell.line ?? cell.lineId ?? cell.line_id;
    const idMatch = rawId != null ? String(rawId).trim().match(LINE_ID) : null;
    const rawValue = cell.value ?? cell.text;
    return {
      id: idMatch ? `n${idMatch[1]}` : undefined,
      value: typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : undefined,
    };
  }
  return {};
}

function lineMatches(line: SnapshotLine, value: string, type: string): 'exact' | 'contains' | null {
  const wanted = norm(value);
  if (!wanted) return null;
  if (type === 'url' || type === 'image') {
    const target = type === 'url' ? line.href : line.src;
    if (target && (target === value || target.endsWith(value) || (value.startsWith('/') && target.includes(value)))) return 'exact';
    return null;
  }
  const text = norm(line.text);
  if (text === wanted) return 'exact';
  // Whole words only: "$1" must not be found inside "$160k".
  const at = text.indexOf(wanted);
  if (at === -1) return null;
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  for (let i = at; i !== -1; i = text.indexOf(wanted, i + 1)) {
    if (!isWordChar(text[i - 1]) && !isWordChar(text[i + wanted.length])) return 'contains';
  }
  return null;
}

/**
 * Pins every field value of every row to a real line of the page.
 *
 * A cited id is kept when the quoted value is in that line (or no value was
 * given). Otherwise the quoted value is looked up in the page text: small
 * models often return values but skip or garble ids. Lookups prefer the line
 * nearest the row's most distinctive value, so a value repeated across items
 * ("Included", "$0") is taken from the right item. Anything not found on the
 * page is dropped, so nothing invented reaches a robot.
 */
export function groundRows(raw: any, spec: ExtractionSpec, chunkLines: SnapshotLine[], allowedIds: Set<string>): CitedRow[] {
  const typeOf = new Map(spec.fields.map((f) => [f.name, f.type]));
  const indexOf = new Map(chunkLines.map((l, i) => [l.id, i]));
  const fieldKeys = new Map(spec.fields.map((f) => [norm(f.name).replace(/[^a-z0-9]/g, ''), f.name]));
  const rows: CitedRow[] = [];
  const seen = new Set<string>();
  const minFields = spec.shape === 'list' ? Math.max(1, Math.ceil(spec.fields.length / 2)) : 1;
  let previousAnchor = 0;

  for (const entry of entriesFrom(raw, spec.shape).slice(0, spec.shape === 'list' ? MAX_EXAMPLE_ITEMS * 2 : 1)) {
    if (!entry || typeof entry !== 'object') continue;

    // Match the model's keys to spec fields loosely ("plan_name" → "Plan Name").
    const cells: Array<{ field: string; id?: string; value?: string }> = [];
    for (const [key, cell] of Object.entries(entry)) {
      const k = norm(key).replace(/[^a-z0-9]/g, '');
      let field = fieldKeys.get(k);
      if (!field && k) {
        // "job_title" → "Title", "name" → "Plan Name": only when exactly one field fits.
        const fits = Array.from(fieldKeys.entries()).filter(([fk]) => fk && (k.includes(fk) || fk.includes(k)));
        if (fits.length === 1) field = fits[0][1];
      }
      if (!field || cells.some((c) => c.field === field)) continue;
      const c = readCell(cell);
      if (c.id || c.value) cells.push({ field, ...c });
    }

    const row: CitedRow = {};
    let anchor: number | null = null;
    // Most distinctive values first: they place the row on the page.
    cells.sort((a, b) => (b.value || '').length - (a.value || '').length);
    for (const cell of cells) {
      const type = typeOf.get(cell.field) || 'text';
      let aid: string | undefined;
      let value: string | undefined;

      if (cell.id && allowedIds.has(cell.id)) {
        const line = chunkLines[indexOf.get(cell.id)!];
        if (!cell.value) aid = cell.id;
        else if (lineMatches(line, cell.value, type)) { aid = cell.id; value = cell.value; }
      }
      if (!aid && cell.value) {
        const origin = anchor ?? previousAnchor;
        let best: { i: number; score: number } | null = null;
        chunkLines.forEach((line, i) => {
          const match = lineMatches(line, cell.value!, type);
          if (!match) return;
          // Exact beats containing; then nearest to the row (ahead of it, before it).
          const distance = i >= origin ? i - origin : (origin - i) * 1.5;
          const score = (match === 'exact' ? 0 : 1000) + distance;
          if (!best || score < best.score) best = { i, score };
        });
        if (best) {
          aid = chunkLines[(best as { i: number }).i].id;
          value = type === 'url' || type === 'image' ? undefined : cell.value;
        }
      }
      if (!aid) continue;
      row[cell.field] = value && norm(value) !== norm(chunkLines[indexOf.get(aid)!].text) ? { aid, value } : { aid };
      if (anchor === null) anchor = indexOf.get(aid)!;
    }

    if (Object.keys(row).length < minFields) continue;
    const key = Object.values(row).map((c) => c.aid).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
    if (anchor !== null) previousAnchor = anchor;
  }
  return spec.shape === 'list' ? rows.slice(0, MAX_EXAMPLE_ITEMS) : rows.slice(0, 1);
}

export async function extractGrounded(
  llm: JsonLLM,
  snapshot: PageSnapshot,
  prompt: string,
  spec: ExtractionSpec,
  deadline?: number,
): Promise<GroundedExtraction | null> {
  const chunks = chunkSnapshot(snapshot, prompt, spec).slice(0, MAX_CHUNKS_TRIED);
  let lastError: unknown = null;

  for (const chunk of chunks) {
    try {
      if (deadline && Date.now() >= deadline) break;
      const { json, provider } = await llm({
        label: 'extract',
        deadline,
        system: SYSTEM,
        user: buildUserPrompt(prompt, spec, chunk.text),
        maxTokens: 2048,
      });
      const rows = groundRows(json, spec, chunk.lines, chunk.ids);
      if (rows.length > 0) return { rows, provider, chunkIndex: chunk.index };
      logger.warn(`[AiExtract] Chunk ${chunk.index}: no usable rows in the model's reply: ${JSON.stringify(json).slice(0, 600)}`);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}
