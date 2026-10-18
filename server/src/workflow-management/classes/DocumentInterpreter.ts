import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { PaddleOcrResult } from 'ppu-paddle-ocr';
import logger from '../../logger';
import { OutputFormats } from '../../constants/output-formats';
import { parseMarkdown } from '../../markdownify/markdown';
import { DOCX_MIME_TYPE, PDF_MIME_TYPE, XLSX_MIME_TYPE, CSV_MIME_TYPE, 
  PNG_MIME_TYPE, isImageMimeType } from '../../utils/document/documentFile';
import { assertLlmBaseUrlAllowed, resolveOpenAiApiKey } from '../../utils/llm-endpoint';
import { resolveLlmModel } from '../../utils/llm-models';

import * as XLSX from 'xlsx';

const MAX_SCHEMA_SAMPLE_CHARS = 16000;
const MAX_CHUNK_CHARS = 12000;
/**
 * Chunk size when the schema collects records (an array of objects). The JSON
 * for a table is about as long as the table, and the models stop at ~4k
 * output tokens (~12k chars), so 12k-char chunks of rows were routinely cut
 * off. Smaller chunks fit in one answer instead of being redone in halves.
 */
const MAX_RECORD_CHUNK_CHARS = 6000;
/** Target answer size per chunk, under the ~12k-char (4k-token) output cap. */
const TARGET_OUTPUT_CHARS = 9000;
const MIN_CHUNK_CHARS = 2500;
const MAX_FILE_SIZE_MB = 10;
const MAX_TABLES_IN_CONTEXT = 5;
const MAX_TABLE_ROWS_IN_CONTEXT = 50;
const MAX_TABLE_CONTEXT_CHARS = 8000;
const CHUNK_HEADER_ALLOWANCE = 64;
const MAX_PROMPT_CHUNK_HEADROOM = 2000;
const SCANNED_THRESHOLD_CHARS_PER_PAGE = 30;
const MAX_TABLE_DETECTION_PAGES = 200;
const EXTRACTION_CONCURRENCY = 3;
const MAX_TRUNCATION_SPLITS = 3;

export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';

interface ExtractionSchemaField {
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  items?: ExtractionSchemaField;
  fields?: Record<string, ExtractionSchemaField>;
}

type ExtractionSchema = Record<string, ExtractionSchemaField>;

/** Page content in reading order: running text and tables, kept apart so tables keep their columns. */
type ContentBlock = { type: 'text'; text: string } | { type: 'table'; rows: string[][] };

interface ParsedPage {
  pageNumber: number;
  /** Markdown-ish text of the page; tables are rendered as Markdown tables. */
  text: string;
  /** Sheet name for spreadsheets. */
  label?: string;
  blocks?: ContentBlock[];
}

interface ParsedDocument {
  text: string;
  pageCount: number;
  pages: ParsedPage[];
  /** Document-level tables that aren't tied to a page block (OCR key/value tables). */
  tables: string[][][];
  sourceHtml?: string;
  /** True when the document came from a flat image, which has no page structure. */
  isImage?: boolean;
  /** XLSX/CSV: every page is one table. */
  isSpreadsheet?: boolean;
}

interface ExtractionResult {
  data: Record<string, any>;
  pageCount: number;
  model: string;
  extractedAt: string;
  tabName: string;
}

export interface ParsedOutput {
  markdown?: string;
  html?: string;
  links?: string[];
  summary?: string;
  pageCount: number;
}

interface ProviderResult {
  payload: any;
  provider: string;
  /** The model hit its output limit; the payload (if any) was salvaged from cut-off JSON. */
  truncated?: boolean;
}

const normalizeWhitespace = (value: string): string =>
  value.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const cleanText = (value: string): string =>
  normalizeWhitespace(value.replace(/\x00/g, ''));

const escapeTableCell = (cell: string): string =>
  String(cell ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Markdown table from rows; the first row is the header. Ragged rows are padded. */
const renderMarkdownTable = (rows: string[][]): string => {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const cells = (row: string[]) => Array.from({ length: width }, (_, i) => escapeTableCell(row[i] ?? '') || ' ');
  const [head, ...body] = rows;
  return [
    `| ${cells(head || []).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((row) => `| ${cells(row).join(' | ')} |`),
  ].join('\n');
};

const escapeHtml = (value: string): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderHtmlTable = (rows: string[][]): string => {
  const [head, ...body] = rows;
  const headHtml = `<thead><tr>${(head || []).map((cell) => `<th>${escapeHtml(cell.trim())}</th>`).join('')}</tr></thead>`;
  const bodyHtml = `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell.trim())}</td>`).join('')}</tr>`).join('\n')}</tbody>`;
  return `<table>\n${headHtml}\n${bodyHtml}\n</table>`;
};

/**
 * Word tables rarely mark a header row, so HTML→Markdown gives them an empty
 * header (`|  |  |` + separator) above the real first row. Promote that row.
 */
const promoteEmptyTableHeaders = (markdown: string): string =>
  markdown.replace(
    /^\|(?:[ \t]*\|)+[ \t]*\n(\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+)[ \t]*\n(\|.*\|)[ \t]*$/gm,
    '$2\n$1'
  );

const renderBlocksMarkdown = (blocks: ContentBlock[]): string =>
  blocks
    .map((block) => (block.type === 'text' ? block.text : renderMarkdownTable(block.rows)))
    .filter((part) => part.trim())
    .join('\n\n');

const renderBlocksHtml = (blocks: ContentBlock[]): string =>
  blocks
    .map((block) =>
      block.type === 'text'
        ? block.text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n')
        : renderHtmlTable(block.rows)
    )
    .join('\n');

/** Trim every line (PDF text lines carry padding) and collapse blank runs. */
const tidyLines = (value: string): string =>
  cleanText(value)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeCellForMatch = (cell: string): string => cell.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Lays out a PDF page as text and tables in reading order.
 *
 * pdf-parse returns the page text with a table's cells separated only by
 * runs of spaces, which cleanText then collapsed into single spaces, so
 * "Widget B1 | 6 | $379.41" reached the model as "Widget B1 6 $379.41". The
 * detected tables are matched back to their text lines (a line whose
 * space-separated cells equal a table row) and replace them in place, so
 * each table appears once, with its columns, where it sits on the page.
 * A table whose rows can't be found in the text is appended to the page.
 */
const buildPdfPageBlocks = (rawText: string, tables: string[][][]): ContentBlock[] => {
  const signature = (cells: string[]) => {
    const parts = cells.map(normalizeCellForMatch).filter(Boolean);
    return parts.length >= 2 ? parts.join('\u0001') : '';
  };
  const rowOwner = new Map<string, number>();
  tables.forEach((table, tableIndex) => {
    table.forEach((row) => {
      const sig = signature(row);
      if (sig && !rowOwner.has(sig)) rowOwner.set(sig, tableIndex);
    });
  });

  const blocks: ContentBlock[] = [];
  const emitted = new Set<number>();
  let textLines: string[] = [];
  const flushText = () => {
    const text = tidyLines(textLines.join('\n'));
    if (text) blocks.push({ type: 'text', text });
    textLines = [];
  };

  for (const line of rawText.replace(/\r/g, '').replace(/\u0000/g, '').split('\n')) {
    const owner = rowOwner.get(signature(line.trim().split(/\t|\s{2,}/)));
    if (owner === undefined) {
      textLines.push(line);
      continue;
    }
    if (!emitted.has(owner)) {
      flushText();
      blocks.push({ type: 'table', rows: tables[owner] });
      emitted.add(owner);
    }
  }
  flushText();

  tables.forEach((table, tableIndex) => {
    if (!emitted.has(tableIndex) && table.length > 0) blocks.push({ type: 'table', rows: table });
  });
  return blocks;
};

const OCR_ASCII_NOISE_THRESHOLD = 0.80;

const asciiRatio = (value: string): number => {
  if (!value.length) return 1;
  return (value.match(/[ -~]/g) || []).length / value.length;
};

const looksLikeGarbledLabel = (s: string): boolean => {
  const seg = s.trim();
  if (!seg) return true;
  if (asciiRatio(seg) < 0.75) return true;
  if (/^\d+$/.test(seg)) return false;
  if (seg.length <= 3) return true;
  if (seg.length <= 7 && !/[aeiouAEIOU]/.test(seg)) return true;
  if (seg.length <= 8 && /[0-9]/.test(seg) && /[a-zA-Z]/.test(seg)) return true;
  const tokens = seg.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3 && tokens.filter((t) => t.length <= 2).length / tokens.length >= 0.5) return true;
  return false;
};

const extractEnglishFromMixedLine = (line: string): string => {
  const segments = line.split('/').map((s) => s.trim());
  if (segments.length <= 1) {
    const trailing = line.match(/([A-Za-z][A-Za-z0-9 ,.'()\-]{4,})$/);
    return trailing ? trailing[1].trim() : '';
  }

  const cleanSegments = segments.filter(
    (seg) => seg.length >= 3 && asciiRatio(seg) >= OCR_ASCII_NOISE_THRESHOLD && !looksLikeGarbledLabel(seg),
  );
  if (cleanSegments.length > 0) return cleanSegments.join(' ').trim();

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.length >= 3 && asciiRatio(seg) >= OCR_ASCII_NOISE_THRESHOLD) return seg;
  }
  return '';
};

const filterOCRLine = (line: string): string => {
  const trimmed = line.trim();
  if (!trimmed) return '';

  if (asciiRatio(trimmed) < OCR_ASCII_NOISE_THRESHOLD) {
    return extractEnglishFromMixedLine(trimmed);
  }

  if (trimmed.includes('/')) {
    const firstSlashIdx = trimmed.indexOf('/');
    const firstSegment = trimmed.slice(0, firstSlashIdx);
    if (looksLikeGarbledLabel(firstSegment)) {
      const extracted = extractEnglishFromMixedLine(trimmed);
      if (extracted && extracted.length >= 3) return extracted;
    }
  }

  return trimmed;
};

const filterOCRText = (text: string): string =>
  text
    .split('\n')
    .map(filterOCRLine)
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const buildCleanTextFromOCRData = (data: any): string => {
  const LINE_CONF = 55;
  const WORD_CONF = 60;
  const MIN_LINE_CHARS = 3;
  const MIN_WORD_CHARS = 2;

  if (!Array.isArray(data?.lines) || data.lines.length === 0) {
    return filterOCRText(cleanText(data?.text || ''));
  }

  const resultLines: string[] = [];

  for (const line of data.lines as any[]) {
    if (typeof line.confidence === 'number' && line.confidence < LINE_CONF) continue;

    let lineText: string;

    if (Array.isArray(line.words) && line.words.length > 0) {
      const goodWords = (line.words as any[])
        .filter((w: any) =>
          (typeof w.confidence !== 'number' || w.confidence >= WORD_CONF) &&
          ((w.text as string)?.trim().length ?? 0) >= MIN_WORD_CHARS
        )
        .map((w: any) => (w.text as string)?.trim())
        .filter(Boolean);

      if (goodWords.length === 0) continue;
      lineText = goodWords.join(' ');
    } else {
      lineText = (line.text as string)?.trim() || '';
    }

    lineText = filterOCRLine(cleanText(lineText));
    if (lineText.length >= MIN_LINE_CHARS) resultLines.push(lineText);
  }

  return resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const MAX_OCR_PIXELS = 25_000_000; // ~25 MP, 5000x5000 pixels

const downscaleIfOversized = async (imagePath: string): Promise<void> => {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(imagePath).metadata();
  const pixelCount = (meta.width || 0) * (meta.height || 0);
  if (pixelCount <= MAX_OCR_PIXELS) return;

  const scale = Math.sqrt(MAX_OCR_PIXELS / pixelCount);
  const isPng = meta.format === 'png';
  const tmp = `${imagePath}.resized.${isPng ? 'png' : 'jpg'}`;
  const resized = sharp(imagePath).resize(
    Math.max(1, Math.floor(meta.width! * scale)),
    Math.max(1, Math.floor(meta.height! * scale))
  );
  await (isPng ? resized.png() : resized.jpeg()).toFile(tmp);
  await fs.promises.rename(tmp, imagePath);
  logger.info(`[DocumentInterpreter] Downscaled ${meta.width}×${meta.height} image to fit OCR pixel budget`);
};

const preprocessPageImage = async (imagePath: string): Promise<void> => {
  await downscaleIfOversized(imagePath);

  try {
    const { createCanvas, loadImage } = await import('canvas');
    const img = await loadImage(imagePath);
    const { width, height } = img;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const n = width * height;

    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
    }

    const W1 = width + 1;
    const intSum = new Float64Array(W1 * (height + 1));
    const intSumSq = new Float64Array(W1 * (height + 1));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const g = gray[y * width + x];
        intSum[(y + 1) * W1 + (x + 1)] = g + intSum[y * W1 + (x + 1)] + intSum[(y + 1) * W1 + x] - intSum[y * W1 + x];
        intSumSq[(y + 1) * W1 + (x + 1)] = g * g + intSumSq[y * W1 + (x + 1)] + intSumSq[(y + 1) * W1 + x] - intSumSq[y * W1 + x];
      }
    }

    const hw = 40;
    const k = 0.2;
    const R = 128;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - hw), y1 = Math.max(0, y - hw);
        const x2 = Math.min(width - 1, x + hw), y2 = Math.min(height - 1, y + hw);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);

        const s = intSum[(y2 + 1) * W1 + (x2 + 1)] - intSum[y1 * W1 + (x2 + 1)] - intSum[(y2 + 1) * W1 + x1] + intSum[y1 * W1 + x1];
        const sq = intSumSq[(y2 + 1) * W1 + (x2 + 1)] - intSumSq[y1 * W1 + (x2 + 1)] - intSumSq[(y2 + 1) * W1 + x1] + intSumSq[y1 * W1 + x1];

        const mean = s / count;
        const std = Math.sqrt(Math.max(0, sq / count - mean * mean));
        const thresh = mean * (1.0 + k * (std / R - 1.0));

        const v = gray[y * width + x] < thresh ? 0 : 255;
        const idx = (y * width + x) * 4;
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = v;
        pixels[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    await fs.promises.writeFile(imagePath, canvas.toBuffer('image/png'));
  } catch (err: any) {
    logger.warn(`[DocumentInterpreter] Image preprocessing failed (${err.message}), using original`);
  }
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;

const toFieldKey = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';

const splitPromptFields = (prompt: string): string[] => {
  const cleanedPrompt = prompt
    .replace(/^extract\b/i, '')
    .replace(/\band\b/gi, ',')
    .replace(/\bfrom\b.*$/i, '')
    .trim();

  const fields = cleanedPrompt
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return fields.length > 0 ? fields : ['document text'];
};

const stripCodeFences = (value: string): string => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : value.trim();
};

const stripReasoning = (value: string): string =>
  value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();

const extractBalancedJson = (value: string): string | null => {
  const closerFor: Record<string, string> = { '{': '}', '[': ']' };

  for (let start = 0; start < value.length; start += 1) {
    const opener = value[start];
    if (opener !== '{' && opener !== '[') continue;
    // "[see below]"-style brackets in prose aren't JSON; keep scanning.
    if (!/^\s*(?:["{\[\]}\d-]|$)/.test(value.slice(start + 1, start + 20))) continue;

    const closer = closerFor[opener];
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < value.length; i += 1) {
      const char = value[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === opener) depth += 1;
      else if (char === closer) {
        depth -= 1;
        if (depth === 0) return value.slice(start, i + 1);
      }
    }
    // The outermost JSON value never closed: the output was cut off. Don't fall
    // through to the first complete *inner* object, which silently turned a
    // truncated 100-item list into a single item.
    return null;
  }
  return null;
};

/**
 * Recovers the complete part of JSON that was cut off mid-output: drops the
 * partial trailing element and closes the open brackets.
 * `{"items":[{"a":1},{"a":2` → `{"items":[{"a":1}]}`.
 */
const salvageTruncatedJson = (value: string): any | null => {
  // Cut only between array elements or top-level fields, so a record that
  // was still being written is dropped rather than kept with missing fields.
  const isElementBoundary = (stack: string[]) => stack.length === 1 || stack[stack.length - 1] === ']';
  const start = value.search(/[{[]/);
  if (start < 0) return null;
  const text = value.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastCut = -1;
  let stackAtCut: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      stack.pop();
      if (stack.length === 0) return null; // complete, not truncated
      if (isElementBoundary(stack)) {
        lastCut = i + 1;
        stackAtCut = [...stack];
      }
    } else if (char === ',' && isElementBoundary(stack)) {
      lastCut = i;
      stackAtCut = [...stack];
    }
  }

  if (lastCut < 0) return null;
  const candidate = text.slice(0, lastCut).replace(/,\s*$/, '') + [...stackAtCut].reverse().join('');
  try {
    return JSON.parse(repairJsonText(candidate));
  } catch {
    return null;
  }
};

const extractJsonText = (value: string): string => {
  const stripped = stripCodeFences(stripReasoning(value));
  return extractBalancedJson(stripped) ?? stripped;
};

const repairJsonText = (value: string): string =>
  value
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

const parseJsonLoose = (value: string): any => {
  const jsonText = extractJsonText(value);

  try {
    return JSON.parse(jsonText);
  } catch {
    return JSON.parse(repairJsonText(jsonText));
  }
};

/** Parse model output; salvage the complete part when it was cut off. */
const parseModelJson = (content: string, hitOutputLimit: boolean): { payload: any; truncated: boolean } => {
  const cleaned = stripCodeFences(stripReasoning(content));
  if (hitOutputLimit) {
    const salvaged = salvageTruncatedJson(cleaned);
    if (salvaged !== null) return { payload: salvaged, truncated: true };
  }
  try {
    return { payload: parseJsonLoose(content), truncated: hitOutputLimit };
  } catch (error) {
    const salvaged = salvageTruncatedJson(cleaned);
    if (salvaged !== null) return { payload: salvaged, truncated: true };
    throw error;
  }
};

const isMeaningful = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isMeaningful);
  if (typeof value === 'object') return Object.values(value).some(isMeaningful);
  return true;
};

/**
 * Numbers as written in documents: currency symbols and codes, thousands
 * separators in western (1,234,567.89), European (1.234.567,89) and Indian
 * (1,23,456) styles, accounting negatives "(1,200.00)" and trailing minus.
 * The old version stripped everything but digits, dots and minus, so
 * "1.234,56" became 1.23456 and "(500)" became +500. Ranges ("10-20") give null.
 */
const parseNumericValue = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const negative = /^\(.*\)$/.test(raw) || /^[^\d]*-/.test(raw) || /-\s*$/.test(raw);
  let cleaned = raw.replace(/[^0-9.,-]/g, '');
  if (/\d-\d/.test(cleaned)) return null;
  cleaned = cleaned.replace(/-/g, '');
  if (!/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    cleaned = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma > -1) {
    const parts = cleaned.split(',');
    // One comma followed by other than 3 digits is a decimal comma ("12,5").
    cleaned = parts.length === 2 && parts[1].length !== 3 ? parts.join('.') : parts.join('');
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    cleaned = cleaned.replace(/\./g, '');
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * ISO date for a date as written. Date-only values stay dates: "March 15,
 * 2024" used to go through toISOString(), which on a server east of UTC
 * gave "2024-03-14T18:30:00.000Z", a day early.
 */
const normalizeDateValue = (value: string): string => {
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || !/\d/.test(normalized)) return normalized;
  if (/\d{1,2}:\d{2}/.test(normalized)) return parsed.toISOString();
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
};

const parseBooleanValue = (value: any): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return null;
};

const sanitizeSchemaField = (input: any, fallbackLabel: string): ExtractionSchemaField => {
  const inputType = typeof input?.type === 'string' ? input.type.toLowerCase() : 'string';
  const type: FieldType =
    inputType === 'integer' || inputType === 'float' || inputType === 'currency'
      ? 'number'
      : inputType === 'list'
        ? 'array'
        : inputType === 'map'
          ? 'object'
          : ['string', 'number', 'boolean', 'date', 'array', 'object'].includes(inputType)
            ? (inputType as FieldType)
            : 'string';

  const field: ExtractionSchemaField = {
    label: typeof input?.label === 'string' && input.label.trim() ? input.label.trim() : fallbackLabel,
    type,
    description: typeof input?.description === 'string' ? input.description.trim() : undefined,
    required: Boolean(input?.required),
  };

  if (type === 'array') {
    field.items = sanitizeSchemaField(input?.items || { type: 'string', label: fallbackLabel }, fallbackLabel);
  }

  if (type === 'object') {
    const rawFields = input?.fields && typeof input.fields === 'object' ? input.fields : {};
    field.fields = Object.entries(rawFields).reduce<Record<string, ExtractionSchemaField>>((acc, [key, value]) => {
      acc[toFieldKey(key)] = sanitizeSchemaField(value, key);
      return acc;
    }, {});
  }

  return field;
};

/**
 * Final result shape. This used to keep only the list fields whenever the
 * result had any, so an invoice came back as its line items without the
 * invoice number, date, vendor or totals. The run view, API and integrations
 * all handle scalar fields next to lists, so the result is kept whole.
 */
const normalizeExtractionData = (data: any): any => data;

const sanitizeSchema = (input: any, prompt?: string): ExtractionSchema => {
  const candidate =
    input?.schema && typeof input.schema === 'object'
      ? input.schema
      : input?.fields && !Array.isArray(input.fields) && typeof input.fields === 'object'
        ? input.fields
        : Array.isArray(input?.fields)
          ? input.fields.reduce((acc: Record<string, any>, field: any) => {
              const key = toFieldKey(field?.key || field?.label || 'value');
              acc[key] = field;
              return acc;
            }, {})
          : input && typeof input === 'object'
            ? input
            : {};

  const schema = Object.entries(candidate).reduce<ExtractionSchema>((acc, [key, value]) => {
    const normalizedKey = toFieldKey(key);
    acc[normalizedKey] = sanitizeSchemaField(value, key);
    return acc;
  }, {});

  if (Object.keys(schema).length > 0) return schema;

  return splitPromptFields(prompt || '').reduce<ExtractionSchema>((acc, label) => {
    acc[toFieldKey(label)] = { label, type: 'string', required: false };
    return acc;
  }, {});
};

const GENERIC_SCHEMA_LABELS = [
  'details', 'detail', 'information', 'info', 'data', 'document',
  'document details', 'document information', 'document data', 'summary', 'content', 'fields',
];

const isGenericSchemaLabel = (value: string): boolean => {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return GENERIC_SCHEMA_LABELS.some((label) => normalized === label || normalized.endsWith(` ${label}`));
};

const inferFieldTypeFromSample = (sample: string): FieldType => {
  if (parseNumericValue(sample) !== null) return 'number';
  if (parseBooleanValue(sample) !== null) return 'boolean';
  const parsedDate = new Date(sample);
  if (!Number.isNaN(parsedDate.getTime()) && /\d/.test(sample)) return 'date';
  return 'string';
};

const inferAtomicFieldsFromSampleText = (sampleText: string, prompt: string): ExtractionSchema => {
  const schema: ExtractionSchema = {};
  const lines = sampleText.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9&/(),.' -]{2,60}?):\s*(.+)$/);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    const key = toFieldKey(label);
    if (!key || isGenericSchemaLabel(label) || schema[key]) continue;
    schema[key] = { label, type: inferFieldTypeFromSample(value), required: false };
    if (Object.keys(schema).length >= 15) break;
  }

  return Object.keys(schema).length > 0 ? schema : buildHeuristicSchema(prompt);
};

const isCoarseSchema = (schema: ExtractionSchema, prompt: string): boolean => {
  const entries = Object.entries(schema);
  if (entries.length === 0) return true;
  if (entries.length === 1) {
    const [key, field] = entries[0];
    if (isGenericSchemaLabel(key) || isGenericSchemaLabel(field.label)) return true;
    const enumeratedPromptFields = splitPromptFields(prompt).length;
    if (enumeratedPromptFields <= 1 && /(details?|information|info|data|summary|content)/i.test(field.label)) return true;
  }
  return false;
};

const schemaToJsonDefinition = (schema: ExtractionSchema): Record<string, any> =>
  Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    const definition: Record<string, any> = { label: field.label, type: field.type };
    if (field.description) definition.description = field.description;
    if (field.required) definition.required = true;
    if (field.type === 'array' && field.items) definition.items = schemaToJsonDefinition({ item: field.items }).item;
    if (field.type === 'object' && field.fields) definition.fields = schemaToJsonDefinition(field.fields);
    acc[key] = definition;
    return acc;
  }, {});

const normalizeValueBySchema = (value: any, field: ExtractionSchemaField): any => {
  if (value === undefined || value === null) return field.type === 'array' ? [] : null;

  switch (field.type) {
    case 'number': return parseNumericValue(value);
    case 'boolean': return parseBooleanValue(value);
    case 'date': {
      if (typeof value !== 'string') return null;
      return normalizeDateValue(value) || null;
    }
    case 'array': {
      const items = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(/\n|,/).map((item) => item.trim()).filter(Boolean)
          : [value];

      if (!field.items) return items;

      return items
        .map((item) =>
          item !== null && typeof item === 'object' && field.items!.type !== 'object'
            ? item
            : normalizeValueBySchema(item, field.items!)
        )
        .filter(isMeaningful);
    }
    case 'object': {
      const raw = typeof value === 'object' && !Array.isArray(value) ? value : {};
      if (!field.fields || Object.keys(field.fields).length === 0) return raw;
      return Object.entries(field.fields).reduce<Record<string, any>>((acc, [key, childField]) => {
        acc[key] = normalizeValueBySchema(raw[key], childField);
        return acc;
      }, {});
    }
    default:
      if (value !== null && typeof value === 'object') return value;
      return typeof value === 'string' ? cleanText(value) : String(value);
  }
};

/**
 * Models often wrap the answer ({"data": {...}}, {"result": {...}},
 * {"extracted": {...}}). Unwrap single-key envelopes until the schema keys
 * show up.
 */
const unwrapPayload = (payload: any, schema: ExtractionSchema): any => {
  const schemaKeys = Object.keys(schema).map(toFieldKey);
  let current = payload;
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) break;
    const keys = Object.keys(current);
    if (keys.some((key) => schemaKeys.includes(toFieldKey(key)))) return current;
    if (keys.length !== 1 || !current[keys[0]] || typeof current[keys[0]] !== 'object') break;
    current = current[keys[0]];
  }
  return payload;
};

const normalizeResultToSchema = (raw: any, schema: ExtractionSchema): Record<string, any> => {
  // Match keys loosely too: "Invoice Number", "invoiceNumber", "invoice-number".
  const byLooseKey = new Map<string, any>();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      byLooseKey.set(toFieldKey(key.replace(/([a-z])([A-Z])/g, '$1_$2')), value);
    }
  }
  return Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    const sourceValue =
      raw?.[key] ??
      raw?.[field.label] ??
      raw?.[field.label.toLowerCase()] ??
      byLooseKey.get(key) ??
      byLooseKey.get(toFieldKey(field.label)) ??
      null;
    acc[key] = normalizeValueBySchema(sourceValue, field);
    return acc;
  }, {});
};

/** Comparison key for an extracted item: case, spacing and number formatting don't make a new item. */
const itemKey = (item: any): string => {
  const norm = (value: any): any => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const numeric = /\d/.test(value) && /^[\s$€£₹¥(+-]*[\d.,\s]+[)%]?\s*$/.test(value) ? parseNumericValue(value) : null;
      return numeric !== null ? numeric : value.replace(/\s+/g, ' ').trim().toLowerCase();
    }
    if (Array.isArray(value)) return value.map(norm);
    if (typeof value === 'object') {
      return Object.keys(value).sort().reduce<Record<string, any>>((acc, key) => {
        acc[key] = norm(value[key]);
        return acc;
      }, {});
    }
    return value;
  };
  return JSON.stringify(norm(item));
};

/**
 * Chunks are merged in document order.
 *  - Scalars: the first chunk that has the value wins (headers, parties and
 *    dates sit early). Previously the longest string from any chunk won,
 *    which let a later chunk's rambling or wrong value replace a correct one.
 *  - Arrays: items are appended in order. An item already collected from an
 *    earlier chunk isn't added again, but genuinely repeated items within one
 *    chunk (two identical line items) are kept.
 */
const mergeValues = (current: any, incoming: any, field: ExtractionSchemaField): any => {
  if (!isMeaningful(current)) return incoming;
  if (!isMeaningful(incoming)) return current;

  if (field.type === 'array') {
    const base = Array.isArray(current) ? current : [];
    const additions = Array.isArray(incoming) ? incoming : [];
    const collected = new Map<string, number>();
    base.forEach((item) => {
      const key = itemKey(item);
      collected.set(key, (collected.get(key) ?? 0) + 1);
    });
    const seenInChunk = new Map<string, number>();
    const merged = [...base];
    for (const item of additions) {
      const key = itemKey(item);
      const n = (seenInChunk.get(key) ?? 0) + 1;
      seenInChunk.set(key, n);
      if (n > (collected.get(key) ?? 0)) merged.push(item);
    }
    return merged;
  }

  if (field.type === 'object' && field.fields) {
    return Object.entries(field.fields).reduce<Record<string, any>>((acc, [key, childField]) => {
      acc[key] = mergeValues(current?.[key], incoming?.[key], childField);
      return acc;
    }, {});
  }

  return current;
};

const mergeExtractionResults = (
  base: Record<string, any>,
  incoming: Record<string, any>,
  schema: ExtractionSchema
): Record<string, any> =>
  Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    acc[key] = mergeValues(base[key], incoming[key], field);
    return acc;
  }, {});

const buildHeuristicSchema = (prompt: string): ExtractionSchema =>
  splitPromptFields(prompt).reduce<ExtractionSchema>((acc, field) => {
    acc[toFieldKey(field)] = { label: field, type: 'string', required: false };
    return acc;
  }, {});

const fallbackExtractByLabel = (text: string, label: string): string | null => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const pattern of [
    new RegExp(`${escaped}\\s*[:#-]\\s*([^\\n\\r]+)`, 'i'),
    new RegExp(`${escaped}\\s+([^\\n\\r]{1,120})`, 'i'),
  ]) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
};

const fallbackExtract = (text: string, schema: ExtractionSchema): Record<string, any> =>
  Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    acc[key] = normalizeValueBySchema(fallbackExtractByLabel(text, field.label), field);
    return acc;
  }, {});

/**
 * Splits a single page whose text exceeds the chunk budget into ordered
 * segments, preferring paragraph boundaries, then line boundaries, then word
 * boundaries, and only cutting mid-word when the text has no whitespace at all.
 *
 * Formats without intrinsic pagination (DOCX, CSV) parse to one page holding
 * the entire document, so without this every such document was silently
 * truncated to the first MAX_CHUNK_CHARS characters before extraction.
 * There is no segment cap: a capped last segment held the rest of the page
 * and the prompt cut it, silently dropping the end of large CSVs and sheets.
 */
const splitOversizedPageText = (text: string, limit: number): string[] => {
  if (text.length <= limit) return [text];

  const segments: string[] = [];
  let remaining = text;
  const minimumCut = Math.floor(limit / 2);

  while (remaining.length > limit) {
    const candidates = [
      remaining.lastIndexOf('\n\n', limit),
      remaining.lastIndexOf('\n', limit),
      remaining.lastIndexOf(' ', limit),
    ];
    const cut = candidates.find((index) => index >= minimumCut) ?? limit;

    segments.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) segments.push(remaining);
  return segments.filter(Boolean);
};

const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;

/**
 * When a Markdown table is split across segments, repeat its header row at
 * the top of the next segment. Without it a later chunk of a spreadsheet or
 * a long PDF table reached the model as bare rows with no column names.
 */
const carryTableHeaders = (segments: string[]): string[] => {
  let header: string[] | null = null;
  return segments.map((segment) => {
    const lines = segment.split('\n');
    const continuesTable = header && TABLE_ROW.test(lines[0] || '') && !TABLE_SEPARATOR.test(lines[1] || '');
    const out = continuesTable ? [...header!, ...lines] : lines;
    for (let i = 0; i < lines.length; i++) {
      if (TABLE_SEPARATOR.test(lines[i]) && i > 0 && TABLE_ROW.test(lines[i - 1])) header = [lines[i - 1], lines[i]];
      else if (!TABLE_ROW.test(lines[i])) header = lines[i].trim() ? null : header;
    }
    return out.join('\n');
  });
};

const buildChunks = (pages: ParsedPage[], budget: number = MAX_CHUNK_CHARS): Array<{ pageRange: string; text: string }> => {
  const chunks: Array<{ pageRange: string; text: string }> = [];
  const segmentBudget = budget - CHUNK_HEADER_ALLOWANCE;

  let currentUnits: Array<{ label: string; text: string }> = [];
  let currentLength = 0;

  const flushCurrentUnits = () => {
    if (currentUnits.length === 0) return;

    const firstLabel = currentUnits[0].label;
    const lastLabel = currentUnits[currentUnits.length - 1].label;

    chunks.push({
      pageRange: firstLabel === lastLabel ? firstLabel : `${firstLabel} to ${lastLabel}`,
      text: currentUnits.map((unit) => `${unit.label}\n${unit.text}`).join('\n\n'),
    });

    currentUnits = [];
    currentLength = 0;
  };

  for (const page of pages) {
    const pageText = cleanText(page.text);
    if (!pageText) continue;
    const pageName = page.label ? `Sheet "${page.label}"` : `Page ${page.pageNumber}`;

    const segments = carryTableHeaders(splitOversizedPageText(pageText, segmentBudget));

    segments.forEach((segment, index) => {
      const label = segments.length > 1
        ? `${pageName} (part ${index + 1}/${segments.length})`
        : pageName;

      // Count the label and separator each unit adds to the chunk text.
      const unitLength = label.length + 1 + segment.length + 2;
      if (currentUnits.length > 0 && currentLength + unitLength > budget) {
        flushCurrentUnits();
      }

      currentUnits.push({ label, text: segment });
      currentLength += unitLength;
    });
  }

  flushCurrentUnits();

  return chunks.length > 0 ? chunks : [{ pageRange: '1-1', text: '' }];
};

type DocumentChunk = { pageRange: string; text: string };

/**
 * Halves a chunk whose extraction was cut off by the model's output limit,
 * at a blank line near the middle where possible; a table split in two keeps
 * its header in both halves.
 */
const splitChunkInTwo = (chunk: DocumentChunk): [DocumentChunk, DocumentChunk] | null => {
  if (chunk.text.length < 1500) return null;
  const lines = chunk.text.split('\n');
  if (lines.length < 4) return null;
  const mid = Math.floor(lines.length / 2);
  let cut = mid;
  for (let d = 0; d < lines.length / 4; d++) {
    if (lines[mid + d] !== undefined && !lines[mid + d].trim()) { cut = mid + d; break; }
    if (lines[mid - d] !== undefined && !lines[mid - d].trim()) { cut = mid - d; break; }
  }
  const [first, second] = carryTableHeaders([lines.slice(0, cut).join('\n'), lines.slice(cut).join('\n')]);
  if (!first.trim() || !second.trim()) return null;
  return [
    { pageRange: `${chunk.pageRange} (first half)`, text: first },
    { pageRange: `${chunk.pageRange} (second half)`, text: second },
  ];
};

const mapWithConcurrency = async <T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

/** The JSON shape the model should return, with placeholder types. */
const schemaSkeleton = (schema: ExtractionSchema): Record<string, any> =>
  Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    if (field.type === 'array') {
      const items = field.items;
      acc[key] = [items?.type === 'object' && items.fields ? schemaSkeleton(items.fields) : `${items?.type || 'string'}`];
    } else if (field.type === 'object' && field.fields) {
      acc[key] = schemaSkeleton(field.fields);
    } else {
      acc[key] = `${field.type} or null`;
    }
    return acc;
  }, {});

/**
 * Input chunk size for record extraction, from the document's own tables:
 * each table row comes back as a JSON object holding the same values plus
 * every field name and quoting, so narrow rows with long field names produce
 * output twice the size of the input.
 */
const recordChunkBudget = (pages: ParsedPage[], schema: ExtractionSchema): number => {
  const itemFields = Object.values(schema)
    .filter((field) => field.type === 'array' && field.items?.type === 'object' && field.items.fields)
    .map((field) => Object.keys(field.items!.fields!));
  if (itemFields.length === 0) return MAX_RECORD_CHUNK_CHARS;
  const overheadPerItem = Math.max(...itemFields.map((keys) => keys.reduce((sum, key) => sum + key.length + 9, 4)));

  let rowChars = 0;
  let rowCount = 0;
  for (const page of pages) {
    for (const block of page.blocks || []) {
      if (block.type !== 'table') continue;
      for (const row of block.rows.slice(1)) {
        rowChars += row.reduce((sum, cell) => sum + String(cell).length + 3, 2);
        rowCount++;
      }
    }
  }
  if (rowCount === 0) return MAX_RECORD_CHUNK_CHARS;

  const avgRow = rowChars / rowCount;
  const rowsPerChunk = TARGET_OUTPUT_CHARS / (avgRow + overheadPerItem);
  return Math.round(Math.min(MAX_CHUNK_CHARS, Math.max(MIN_CHUNK_CHARS, rowsPerChunk * avgRow)));
};

const scalarsOnly = (data: Record<string, any>, schema: ExtractionSchema): Record<string, any> =>
  Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    acc[key] = field.type === 'array' ? [] : data[key];
    return acc;
  }, {});

const PADDLE_MODEL_BASE = 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';
const PADDLE_DICT_BASE  = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';
const PADDLE_DETECTION  = `${PADDLE_MODEL_BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`;

const PADDLE_SCRIPT_MODELS: Record<string, { recognition: string; dict: string }> = {
  Latin:      { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`,           dict: `${PADDLE_DICT_BASE}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt` },
  Devanagari: { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/devanagari/v5/devanagari_PP-OCRv5_mobile_rec_infer.onnx`, dict: `${PADDLE_DICT_BASE}/recognition/multi/devanagari/v5/ppocrv5_devanagari_dict.txt` },
  Arabic:     { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/arabic/v5/arabic_PP-OCRv5_mobile_rec_infer.onnx`,         dict: `${PADDLE_DICT_BASE}/recognition/multi/arabic/v5/ppocrv5_arabic_dict.txt` },
  Cyrillic:   { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/cyrillic/v5/cyrillic_PP-OCRv5_mobile_rec_infer.onnx`,     dict: `${PADDLE_DICT_BASE}/recognition/multi/cyrillic/v5/ppocrv5_cyrillic_dict.txt` },
  Han:        { recognition: `${PADDLE_MODEL_BASE}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,                                dict: `${PADDLE_DICT_BASE}/recognition/ppocrv5_dict.txt` },
  Japanese:   { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/japan/v3/japan_PP-OCRv3_mobile_rec_infer.onnx`,           dict: `${PADDLE_DICT_BASE}/recognition/multi/japan/v3/japan_dict.txt` },
  Korean:     { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/korean/v5/korean_PP-OCRv5_mobile_rec_infer.onnx`,         dict: `${PADDLE_DICT_BASE}/recognition/multi/korean/v5/ppocrv5_korean_dict.txt` },
  Greek:      { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/el/v5/el_PP-OCRv5_mobile_rec_infer.onnx`,                 dict: `${PADDLE_DICT_BASE}/recognition/multi/el/v5/ppocrv5_el_dict.txt` },
  Tamil:      { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/ta/v5/ta_PP-OCRv5_mobile_rec_infer.onnx`,                 dict: `${PADDLE_DICT_BASE}/recognition/multi/ta/v5/ppocrv5_ta_dict.txt` },
  Telugu:     { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/te/v5/te_PP-OCRv5_mobile_rec_infer.onnx`,                 dict: `${PADDLE_DICT_BASE}/recognition/multi/te/v5/ppocrv5_te_dict.txt` },
  Thai:       { recognition: `${PADDLE_MODEL_BASE}/recognition/multi/th/v5/th_PP-OCRv5_mobile_rec_infer.onnx`,                 dict: `${PADDLE_DICT_BASE}/recognition/multi/th/v5/ppocrv5_th_dict.txt` },
};

const PADDLE_SECONDARY_SCRIPT: Partial<Record<string, string>> = {
  Latin: 'Devanagari',
};

const PADDLE_BILINGUAL_CONF_THRESHOLD = 0.80;

class PaddleOCRProvider {
  private static readonly services = new Map<string, any>();

  private static async getService(script: string): Promise<any> {
    const cacheKey = `${script}:1280:0.15`;
    const cached = this.services.get(cacheKey);
    if (cached) return cached;

    const cfg = PADDLE_SCRIPT_MODELS[script];
    if (!cfg) throw new Error(`No PaddleOCR model for script: ${script}`);

    logger.info(`[PaddleOCR] Loading model for "${script}" (downloads to cache on first run)`);
    const { PaddleOcrService } = await import('ppu-paddle-ocr');
    const svc = new PaddleOcrService({
      model: { detection: PADDLE_DETECTION, recognition: cfg.recognition, charactersDictionary: cfg.dict },
      detection: {
        maxSideLength: 1280,
        paddingVertical: 0.15,
      },
    });
    await svc.initialize();
    this.services.set(cacheKey, svc);
    logger.info(`[PaddleOCR] Model ready for "${script}"`);
    return svc;
  }

  static async recognizePage(
    imagePath: string,
    script: string,
  ): Promise<{ text: string; lines: PaddleOcrResult['lines'] }> {
    const primaryScript = PADDLE_SCRIPT_MODELS[script] ? script : 'Latin';
    const svc = await this.getService(primaryScript);

    const imageBuffer = await fs.promises.readFile(imagePath);
    const arrayBuffer = imageBuffer.buffer.slice(
      imageBuffer.byteOffset,
      imageBuffer.byteOffset + imageBuffer.byteLength,
    ) as ArrayBuffer;

    const result = await svc.recognize(arrayBuffer) as PaddleOcrResult;

    const secondaryScript = PADDLE_SECONDARY_SCRIPT[primaryScript];
    if (secondaryScript && result.confidence < PADDLE_BILINGUAL_CONF_THRESHOLD) {
      try {
        const secondarySvc = await this.getService(secondaryScript);
        const secondaryResult = await secondarySvc.recognize(arrayBuffer) as PaddleOcrResult;
        return mergePaddleResults(result, secondaryResult);
      } catch (err: any) {
        logger.warn(`[PaddleOCR] Secondary model (${secondaryScript}) failed: ${err.message}`);
      }
    }

    return { text: result.text, lines: result.lines };
  }
}

const mergePaddleResults = (
  primary: PaddleOcrResult,
  secondary: PaddleOcrResult,
): { text: string; lines: PaddleOcrResult['lines'] } => {
  const primaryBoxes = primary.lines.flat();

  const boxOverlaps = (a: { box: { x: number; y: number; width: number; height: number } }, b: { box: { x: number; y: number; width: number; height: number } }): boolean =>
    a.box.x < b.box.x + b.box.width  &&
    a.box.x + a.box.width  > b.box.x &&
    a.box.y < b.box.y + b.box.height &&
    a.box.y + a.box.height > b.box.y;

  const addedLines: PaddleOcrResult['lines'] = secondary.lines.filter((secondaryLine) =>
    secondaryLine.every((item) =>
      !primaryBoxes.some((p) => boxOverlaps(p, item))
    )
  );

  const mergedLines = [...primary.lines, ...addedLines];
  const mergedText  = mergedLines.map((line) => line.map((w) => w.text).join(' ')).join('\n');
  return { text: mergedText, lines: mergedLines };
};

const PADDLE_WORD_CONF_THRESHOLD = 0.76;
const PADDLE_WORD_CONF_LOW_QUALITY = 0.45;
const PADDLE_QUALITY_MEDIAN_CUTOFF = 0.65;

const reconstructTextFromPaddleLines = (lines: PaddleOcrResult['lines']): string => {
  const allWords = lines.flat().filter((w) => w.text.trim());
  if (allWords.length === 0) return '';

  const confs = allWords.map((w) => w.confidence).sort((a, b) => a - b);
  const medianConf = confs[Math.floor(confs.length / 2)] ?? 1;
  const threshold = medianConf < PADDLE_QUALITY_MEDIAN_CUTOFF
    ? PADDLE_WORD_CONF_LOW_QUALITY
    : PADDLE_WORD_CONF_THRESHOLD;

  const words = allWords.filter((w) => w.confidence >= threshold);

  const heights = words.map((w) => w.box.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
  const rowTolerance = medianHeight * 0.6;

  const sorted = [...words].sort((a, b) => a.box.y - b.box.y);

  const rows: typeof words[] = [];
  let currentRow: typeof words = [];
  let rowBaseY = sorted[0]?.box.y ?? 0;

  for (const word of sorted) {
    if (word.box.y - rowBaseY > rowTolerance && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [word];
      rowBaseY = word.box.y;
    } else {
      currentRow.push(word);
      rowBaseY = Math.min(rowBaseY, word.box.y);
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  const resultLines: string[] = [];
  for (const row of rows) {
    const rowText = row
      .sort((a, b) => a.box.x - b.box.x)
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' ');
    const cleaned = filterOCRLine(cleanText(rowText));
    if (cleaned && cleaned.length >= 3) resultLines.push(cleaned);
  }

  return resultLines.join('\n');
};

const extractTablesFromPaddleLines = (
  pagesLines: PaddleOcrResult['lines'][],
): string[][][] => {
  const tables: string[][][] = [];

  for (const lines of pagesLines) {
    const tableRows: string[][] = [];

    for (const line of lines) {
      if (line.length < 2) continue;

      const sorted = [...line].sort((a, b) => a.box.x - b.box.x);

      const lineLeft  = sorted[0].box.x;
      const lineRight = sorted[sorted.length - 1].box.x + sorted[sorted.length - 1].box.width;
      const lineWidth = lineRight - lineLeft;
      if (lineWidth < 10) continue;

      let maxGap = 0;
      let splitIdx = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].box.x - (sorted[i].box.x + sorted[i].box.width);
        if (gap > maxGap) { maxGap = gap; splitIdx = i + 1; }
      }

      if (maxGap > lineWidth * 0.40 && splitIdx > 0) {
        const leftText  = sorted.slice(0, splitIdx).map((w) => w.text).join(' ').trim();
        const rightText = sorted.slice(splitIdx).map((w) => w.text).join(' ').trim();
        const leftClean  = filterOCRLine(leftText);
        const rightClean = filterOCRLine(rightText);
        const alphaLen = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').length;
        if (leftClean && rightClean && alphaLen(leftClean) >= 3 && alphaLen(rightClean) >= 3) {
          tableRows.push([leftClean, rightClean]);
        }
      }
    }

    if (tableRows.length >= 3) tables.push(tableRows);
  }

  return tables.slice(0, MAX_TABLES_IN_CONTEXT);
};

class DocumentLLMClient {
  private static async callOllama(
    systemPrompt: string,
    userPrompt: string,
    config: LLMConfig
  ): Promise<ProviderResult> {
    const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    await assertLlmBaseUrlAllowed(baseUrl);

    const model = config.model || process.env.OLLAMA_DEFAULT_MODEL || 'llama3.2:latest';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          think: false,
          format: 'json',
          options: { temperature: 0.1, num_predict: 4096 },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const parsed = parseModelJson(data.message?.content || '', data.done_reason === 'length');
      return {
        payload: parsed.payload,
        provider: `ollama:${model}`,
        truncated: parsed.truncated,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static async callOpenAI(
    systemPrompt: string,
    userPrompt: string,
    config: LLMConfig
  ): Promise<ProviderResult> {
    const apiKey = resolveOpenAiApiKey(config.apiKey, config.baseUrl);
    if (!apiKey && !config.baseUrl) throw new Error('OpenAI API key not configured');

    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    await assertLlmBaseUrlAllowed(baseUrl);
    const model = config.model || 'gpt-4o-mini';

    const requestOpenAI = async (useJsonMode: boolean): Promise<Response> => {
      const body: Record<string, any> = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      };

      if (useJsonMode) {
        body.response_format = { type: 'json_object' };
      }

      return fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
        body: JSON.stringify(body),
      });
    };

    let response = await requestOpenAI(true);

    if (!response.ok) {
      response = await requestOpenAI(false);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const parsed = parseModelJson(
      data.choices?.[0]?.message?.content || '',
      data.choices?.[0]?.finish_reason === 'length'
    );
    return {
      payload: parsed.payload,
      provider: `openai:${model}`,
      truncated: parsed.truncated,
    };
  }

  private static async callAnthropic(
    systemPrompt: string,
    userPrompt: string,
    config: LLMConfig
  ): Promise<ProviderResult> {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const model = resolveLlmModel(config.model, 'anthropic', { textOnly: true });
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = (response.content?.[0] as any)?.text || '';
    const parsed = parseModelJson(content, response.stop_reason === 'max_tokens');
    return {
      payload: parsed.payload,
      provider: `anthropic:${model}`,
      truncated: parsed.truncated,
    };
  }

  static async callStructuredJson(
    systemPrompt: string,
    userPrompt: string,
    llmConfig?: LLMConfig
  ): Promise<ProviderResult> {
    const config: LLMConfig = llmConfig || { provider: 'ollama' };

    switch (config.provider) {
      case 'anthropic':
        return this.callAnthropic(systemPrompt, userPrompt, config);
      case 'openai':
        return this.callOpenAI(systemPrompt, userPrompt, config);
      case 'ollama':
      default:
        return this.callOllama(systemPrompt, userPrompt, config);
    }
  }
}

export class DocumentInterpreter {
  private static readonly SCRIPT_TO_LANGS: Record<string, string[]> = {
    Latin: ['eng', 'fra', 'deu', 'spa', 'por', 'ita'],
    Devanagari: ['hin', 'eng'],
    Han: ['chi_sim', 'chi_tra'],
    Arabic: ['ara', 'fas', 'urd'],
    Cyrillic: ['rus', 'ukr'],
    Japanese: ['jpn'],
    Korean: ['kor'],
    Bengali: ['ben'],
    Tamil: ['tam'],
    Thai: ['tha'],
    Greek: ['ell'],
    Hebrew: ['heb'],
    Georgian: ['kat'],
    Armenian: ['hye'],
    Myanmar: ['mya'],
    Ethiopic: ['amh'],
  };

  private static isScannedDocument(text: string, pageCount: number): boolean {
    if (pageCount === 0) return false;
    return text.length / pageCount < SCANNED_THRESHOLD_CHARS_PER_PAGE;
  }

  private static async detectScript(imagePath: string): Promise<string> {
    let osdWorker: any;
    try {
      const { createWorker } = await import('tesseract.js');
      osdWorker = await createWorker('osd', 1, {
        cachePath: process.env.TESSERACT_CACHE_PATH || '/tmp/tesseract-cache',
        logger: () => {},
      } as any);
      const { data } = await (osdWorker as any).detect(imagePath);
      const script: string = data?.script || 'Latin';
      logger.info(`[DocumentInterpreter] OSD detected script: ${script}`);
      return script;
    } catch (err: any) {
      logger.warn(`[DocumentInterpreter] Script detection failed (${err.message}), defaulting to Latin`);
      return 'Latin';
    } finally {
      await osdWorker?.terminate().catch(() => undefined);
    }
  }

  private static async paddleOCRPDF(buffer: Buffer, pageCount: number, script: string): Promise<ParsedDocument> {
    logger.info(`[DocumentInterpreter] Starting PaddleOCR on ${pageCount}-page scanned PDF (script: ${script})`);

    const mupdf: any = await (Function('return import("mupdf")')() as Promise<any>);
    const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
    const actualPageCount: number = doc.countPages();
    const scale = 4.0;
    const matrix: [number, number, number, number, number, number] = [scale, 0, 0, scale, 0, 0];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxun-paddle-'));

    const pages: ParsedPage[] = [];
    const pagesLines: PaddleOcrResult['lines'][] = [];

    try {
      for (let pageNum = 1; pageNum <= actualPageCount; pageNum++) {
        const page = doc.loadPage(pageNum - 1);
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
        const pngBytes = pixmap.asPNG();
        pixmap.destroy?.();
        page.destroy?.();

        const tmpFile = path.join(tmpDir, `page-${pageNum}.png`);
        await fs.promises.writeFile(tmpFile, Buffer.from(pngBytes));

        const { lines } = await PaddleOCRProvider.recognizePage(tmpFile, script);
        const pageText = reconstructTextFromPaddleLines(lines);
        pages.push({ pageNumber: pageNum, text: cleanText(pageText) });
        pagesLines.push(lines);
        logger.info(`[DocumentInterpreter] PaddleOCR page ${pageNum}/${actualPageCount} complete (${pageText.length} chars)`);
      }
    } finally {
      doc.destroy?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const tables = extractTablesFromPaddleLines(pagesLines);
    const combinedText = pages.map((p) => p.text).join('\n\n');
    logger.info(`[DocumentInterpreter] PaddleOCR complete — ${combinedText.length} chars, ${pages.length} pages, ${tables.length} tables`);
    return { text: combinedText, pageCount: actualPageCount, pages, tables };
  }

  private static async ocrPDF(buffer: Buffer, pageCount: number): Promise<ParsedDocument> {
    logger.info(`[DocumentInterpreter] Starting OCR on ${pageCount}-page scanned PDF`);

    const mupdf: any = await (Function('return import("mupdf")')() as Promise<any>);

    const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
    const actualPageCount: number = doc.countPages();

    const scale = 4.0;
    const matrix: [number, number, number, number, number, number] = [scale, 0, 0, scale, 0, 0];

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxun-ocr-'));

    let detectedLangs: string[] = ['eng'];

    try {
      const firstPage = doc.loadPage(0);
      const osdScale = 1.5;
      const osdMatrix: [number, number, number, number, number, number] = [osdScale, 0, 0, osdScale, 0, 0];
      const osdPixmap = firstPage.toPixmap(osdMatrix, mupdf.ColorSpace.DeviceRGB, false);
      const osdPng = osdPixmap.asPNG();
      osdPixmap.destroy?.();
      firstPage.destroy?.();

      const osdFile = path.join(tmpDir, 'osd-page.png');
      await fs.promises.writeFile(osdFile, Buffer.from(osdPng));

      const script = await this.detectScript(osdFile);
      detectedLangs = this.SCRIPT_TO_LANGS[script] || ['eng'];
      logger.info(`[DocumentInterpreter] Using languages: ${detectedLangs.join('+')}`);
    } catch (err: any) {
      logger.warn(`[DocumentInterpreter] OSD pre-render failed (${err.message}), defaulting to eng`);
    }

    const ocrLangs = detectedLangs.join('+');
    let ocrWorker: any;
    try {
      const { createWorker } = await import('tesseract.js');
      ocrWorker = await createWorker(ocrLangs, 1, {
        cachePath: process.env.TESSERACT_CACHE_PATH || '/tmp/tesseract-cache',
        logger: () => {},
      } as any);
    } catch {
      logger.warn(`[DocumentInterpreter] Language pack "${ocrLangs}" unavailable, falling back to eng`);
      const { createWorker } = await import('tesseract.js');
      ocrWorker = await createWorker('eng', 1, {
        cachePath: process.env.TESSERACT_CACHE_PATH || '/tmp/tesseract-cache',
        logger: () => {},
      } as any);
    }

    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '3',
      preserve_interword_spaces: '1',
    });

    const pages: ParsedPage[] = [];

    try {
      for (let pageNum = 1; pageNum <= actualPageCount; pageNum++) {
        const page = doc.loadPage(pageNum - 1);
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
        const pngBytes = pixmap.asPNG();
        pixmap.destroy?.();
        page.destroy?.();

        const tmpFile = path.join(tmpDir, `page-${pageNum}.png`);
        await fs.promises.writeFile(tmpFile, Buffer.from(pngBytes));
        await preprocessPageImage(tmpFile);

        const { data } = await ocrWorker.recognize(tmpFile);

        pages.push({ pageNumber: pageNum, text: buildCleanTextFromOCRData(data) });
        logger.info(`[DocumentInterpreter] OCR page ${pageNum}/${actualPageCount} complete`);
      }
    } finally {
      await ocrWorker.terminate();
      doc.destroy?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const combinedText = pages.map((p) => p.text).join('\n\n');
    logger.info(`[DocumentInterpreter] OCR complete — ${combinedText.length} chars across ${pages.length} pages (langs: ${ocrLangs})`);

    return { text: combinedText, pageCount: actualPageCount, pages, tables: [] };
  }

  private static async parsePDF(buffer: Buffer): Promise<ParsedDocument> {
    const parser = new PDFParse({ data: buffer });

    try {
      const textResult = await parser.getText({
        pageJoiner: '\n\n',
        itemJoiner: ' ',
        lineEnforce: true,
        cellSeparator: '\t',
        parseHyperlinks: true,
      });

      const combinedText = cleanText(textResult.text);
      const pageCount = textResult.total;

      if (this.isScannedDocument(combinedText, pageCount)) {
        logger.info(`[DocumentInterpreter] Scanned PDF detected (avg ${Math.round(combinedText.length / Math.max(pageCount, 1))} chars/page), trying PaddleOCR then Tesseract fallback`);
        await parser.destroy().catch(() => undefined);

        let script = 'Latin';
        try {
          const mupdf: any = await (Function('return import("mupdf")')() as Promise<any>);
          const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxun-osd-'));
          try {
            const firstPage = doc.loadPage(0);
            const osdScale = 1.5;
            const osdMatrix: [number, number, number, number, number, number] = [osdScale, 0, 0, osdScale, 0, 0];
            const osdPixmap = firstPage.toPixmap(osdMatrix, mupdf.ColorSpace.DeviceRGB, false);
            const osdPng = osdPixmap.asPNG();
            osdPixmap.destroy?.();
            firstPage.destroy?.();
            const osdFile = path.join(tmpDir, 'osd.png');
            await fs.promises.writeFile(osdFile, Buffer.from(osdPng));
            script = await this.detectScript(osdFile);
          } finally {
            doc.destroy?.();
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        } catch (err: any) {
          logger.warn(`[DocumentInterpreter] Script pre-detection failed (${err.message}), defaulting to Latin`);
        }

        try {
          return await this.paddleOCRPDF(buffer, pageCount, script);
        } catch (paddleErr: any) {
          logger.warn(`[DocumentInterpreter] PaddleOCR failed (${paddleErr.message}), falling back to Tesseract`);
          return await this.ocrPDF(buffer, pageCount);
        }
      }

      // Tables per page. This used to read `mergedTables`, which is only
      // filled for tables merged across pages and is empty otherwise, and only
      // looked at the first 5 pages, so ordinary tables never reached the
      // model or the Markdown.
      const tablesByPage = new Map<number, string[][][]>();
      try {
        const tableResult = await parser.getTable(
          pageCount > MAX_TABLE_DETECTION_PAGES ? { first: MAX_TABLE_DETECTION_PAGES } : undefined
        );
        for (const page of tableResult.pages || []) {
          const tables = (page.tables || []).filter((table) => table.length > 0);
          if (tables.length > 0) tablesByPage.set(page.num, tables);
        }
      } catch (error: any) {
        logger.warn(`[DocumentInterpreter] Table extraction skipped: ${error.message}`);
      }

      const pages: ParsedPage[] = textResult.pages.map((page) => {
        const blocks = buildPdfPageBlocks(page.text, tablesByPage.get(page.num) || []);
        return { pageNumber: page.num, text: renderBlocksMarkdown(blocks), blocks };
      });

      return {
        text: pages.map((page) => page.text).filter(Boolean).join('\n\n'),
        pageCount,
        pages,
        tables: [],
      };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  private static async parseXLSX(buffer: Buffer): Promise<ParsedDocument>{

    // conver the excel file into a Javascript object called "workbook"
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      raw: false,
    });

    // create tables and pages arrays to hold the extracted data
    const tables: string[][][] = [];

    // create pages array to hold the extracted data from each sheet
    const pages: ParsedPage[] = [];

    // loop through every worksheet SheetNames
    for (const sheetName of workbook.SheetNames) {

      // retrieve worksheet Sheets by name 
      const worksheet = workbook.Sheets[sheetName];

      // Defensive check: this prevents crashing if workbook.SheetNames somehow contains a sheet that can not be retrieved
      if (!worksheet) {
        continue;
      }

      // convert worksheet into rows (Javascript arrays)
      const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
        header: 1,
        blankrows: false, // throws away empty rows
        defval: '', // replace empty values/cells with an empty string
      });

      const normalizedRows = rows
        .filter(Array.isArray) // Defensive check: if the row is not an array, throw it away
        .map((row: any[]) => // visit every row
          row.map((cell: any) => { // visit every cell
            if (cell === undefined || cell === null) {
              return ''; // convert missing cell values into empty strings
            }

            // Edge case: turn excel date values into ISO format
            if (cell instanceof Date) {
              const hasTime =
                cell.getUTCHours() !== 0 ||
                cell.getUTCMinutes() !== 0 ||
                cell.getUTCSeconds() !== 0;

            return hasTime
              ? cell.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
              : cell.toISOString().split('T')[0];
            }

            // Edge case: convert int and boolean values into strings
            if (typeof cell === 'number' || typeof cell === 'boolean') {
              return String(cell);
            }
            
            // Edge case: trim off spaces from start and end of string values
            return String(cell).trim();
          })
        )
        // remove rows that ONLY contain empty strings - as in rows that are completely empty
        .filter((row) => row.some((cell) => cell !== ''));

      tables.push(normalizedRows);

      if (normalizedRows.length > 0) {
        const blocks: ContentBlock[] = [{ type: 'table', rows: normalizedRows }];
        pages.push({ pageNumber: pages.length + 1, label: sheetName, text: renderBlocksMarkdown(blocks), blocks });
      }
    }

    return {
      text: pages.map((page) => `Sheet "${page.label}"\n${page.text}`).join('\n\n'),
      pageCount: pages.length || workbook.SheetNames.length,
      pages,
      tables: [],
      isSpreadsheet: true,
    };
  }

  private static async parseCSV(buffer: Buffer): Promise<ParsedDocument> {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      raw: false,
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;

    if (!worksheet) {
      return {
        text: '',
        pageCount: 1,
        pages: [{ pageNumber: 1, text: '' }],
        tables: [],
      };
    }

    const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: true,
    });

    const normalizedRows = rows
      .filter(Array.isArray)
      .map((row: any[]) =>
        row.map((cell: any) => {
          if (cell === undefined || cell === null) {
            return '';
          }

          if (cell instanceof Date) {
            const hasTime =
              cell.getUTCHours() !== 0 ||
              cell.getUTCMinutes() !== 0 ||
              cell.getUTCSeconds() !== 0;

            return hasTime
              ? cell.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
              : cell.toISOString().split('T')[0];
          }

          if (typeof cell === 'number' || typeof cell === 'boolean') {
            return String(cell);
          }

          return String(cell).trim();
        })
      )
      .filter((row: string[]) => row.some((cell) => cell !== ''));

    if (normalizedRows.length === 0) {
      return {
        text: '',
        pageCount: 1,
        pages: [{ pageNumber: 1, text: '' }],
        tables: [],
      };
    }

    const blocks: ContentBlock[] = [{ type: 'table', rows: normalizedRows }];
    const text = renderBlocksMarkdown(blocks);

    return {
      text,
      pageCount: 1,
      pages: [{ pageNumber: 1, text, blocks }],
      tables: [],
      isSpreadsheet: true,
    };
  }

  private static async parseDOCX(buffer: Buffer): Promise<ParsedDocument> {
    const [rawTextResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      mammoth.convertToHtml({ buffer }),
    ]);

    const rawText = cleanText(rawTextResult.value || '');
    const sourceHtml = (htmlResult.value || '').trim();

    // Raw text flattens tables to one cell per line; Markdown keeps rows and
    // columns, headings and lists for the model and the schema sample.
    let text = rawText;
    if (sourceHtml) {
      try {
        const markdown = promoteEmptyTableHeaders(await parseMarkdown(sourceHtml)).trim();
        if (markdown.length >= rawText.length * 0.6) text = markdown;
      } catch (error: any) {
        logger.warn(`[DocumentInterpreter] DOCX Markdown conversion failed, using raw text: ${error.message}`);
      }
    }

    return {
      text,
      pageCount: 1,
      pages: [{ pageNumber: 1, text }],
      tables: [],
      sourceHtml,
    };
  }

  private static async parseImage(buffer: Buffer, documentMimeType: string): Promise<ParsedDocument> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxun-img-'));
    const tempFile = path.join(tmpDir, documentMimeType === PNG_MIME_TYPE ? 'image.png' : 'image.jpg');

    try {
      await fs.promises.writeFile(tempFile, buffer);
      await downscaleIfOversized(tempFile);

      let script = 'Latin';
      try {
        script = await this.detectScript(tempFile);
      } catch (detectErr: any) {
        logger.warn(`[DocumentInterpreter] Script detection failed (${detectErr.message}), defaulting to Latin`);
      }
      logger.info(`[DocumentInterpreter] OCR on uploaded image (mimeType: ${documentMimeType}) script: ${script}`);

      let text = '';
      let tables: string[][][] = [];
      let paddleSucceeded = false;

      try {
        const { lines } = await PaddleOCRProvider.recognizePage(tempFile, script);
        tables = extractTablesFromPaddleLines([lines]);
        text = cleanText(reconstructTextFromPaddleLines(lines));
        // Treat an empty PaddleOCR result as a failure, not a success.
        if (text) {          
          paddleSucceeded = true;
        }
      } catch (paddleErr: any) {
        logger.warn(`[DocumentInterpreter] PaddleOCR failed (${paddleErr.message}), falling back to Tesseract`);
      }

      if (!paddleSucceeded) {
        try {
          text = cleanText(await this.ocrImageWithTesseract(tempFile, script));
        } catch (tesseractErr: any) {
          logger.error(`[DocumentInterpreter] Tesseract also failed on image (${tesseractErr.message})`);
          throw new Error('Could not read the image. The file may be corrupt, truncated, or an unsupported image variant.');
        }
      }

      const pages: ParsedPage[] = [{ pageNumber: 1, text }];
      logger.info(`[DocumentInterpreter] OCR complete — ${text.length} chars from image (mimeType: ${documentMimeType})`);
      return { text, pageCount: 1, pages, tables, isImage: true };
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  }

  private static async ocrImageWithTesseract(imagePath: string, script: string): Promise<string> {
    const langs = (this.SCRIPT_TO_LANGS[script] || ['eng']).join('+');
    const { createWorker } = await import('tesseract.js');
    let worker: any;
    try {
      worker = await createWorker(langs, 1, {
        cachePath: process.env.TESSERACT_CACHE_PATH || '/tmp/tesseract-cache',
        logger: () => {},
      } as any);
    } catch {
      worker = await createWorker('eng', 1, {
        cachePath: process.env.TESSERACT_CACHE_PATH || '/tmp/tesseract-cache',
        logger: () => {},
      } as any);
    }
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
        preserve_interword_spaces: '1',
      });
      await preprocessPageImage(imagePath);
      const { data } = await worker.recognize(imagePath);
      return buildCleanTextFromOCRData(data);
    } finally {
      await worker.terminate();
    }
  }

  private static buildSchemaPrompt(
    prompt: string,
    sampleText: string
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = [
      'You design robust extraction schemas for business documents.',
      'Return only valid JSON.',
      'Output format:',
      '{"schema":{"field_key":{"label":"Field Label","type":"string|number|boolean|date|array|object","description":"...","required":true,"items":{"label":"...","type":"string"},"fields":{"nested_key":{"label":"...","type":"string"}}}}}',
      'Use concise snake_case keys.',
      'Prefer simple flat schemas unless the prompt clearly implies nested objects or arrays.',
      'When the goal covers repeated records (line items, transactions, rows of a table, a list of people or products), model them as one array field whose items are objects with one field per column or attribute; keep header-level facts (numbers, dates, parties, totals) as separate top-level fields.',
      'Tables in the sample are Markdown tables; use their column headers to name item fields.',
    ].join('\n');

    const userPrompt = [
      `Extraction goal: ${prompt}`,
      '',
      'Sample document text:',
      truncate(sampleText, MAX_SCHEMA_SAMPLE_CHARS),
    ].join('\n');

    return { systemPrompt, userPrompt };
  }

  private static buildAtomicSchemaExpansionPrompt(
    prompt: string,
    sampleText: string,
    currentSchema: ExtractionSchema
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = [
      'You refine document extraction schemas.',
      'Return only valid JSON.',
      'Do not return a single catch-all field such as details, information, data, summary, or content.',
      'Break the extraction goal into atomic reusable business fields.',
      'Output format:',
      '{"schema":{"field_key":{"label":"Field Label","type":"string|number|boolean|date|array|object","description":"...","required":true}}}',
    ].join('\n');

    const userPrompt = [
      `Extraction goal: ${prompt}`,
      '',
      `Current schema: ${JSON.stringify(schemaToJsonDefinition(currentSchema), null, 2)}`,
      '',
      'Sample document text:',
      truncate(sampleText, MAX_SCHEMA_SAMPLE_CHARS),
      '',
      'Expand the schema into specific fields that can be extracted directly from the document.',
    ].join('\n');

    return { systemPrompt, userPrompt };
  }

  private static buildExtractionPrompt(
    prompt: string,
    schema: ExtractionSchema,
    chunk: DocumentChunk,
    partIndex: number,
    partCount: number,
    tables: string[][][]
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = [
      'You extract structured JSON from one part of a business document.',
      'Return only a JSON object whose keys are exactly the schema keys.',
      'Copy values as they appear in the text (keep currency, separators and date formats as written); do not calculate, convert or summarize.',
      'For array fields, return every matching item that appears in this part, in document order. Never sample, summarize or stop early. In a Markdown table, each body row is one item; the header row is not an item.',
      'If a value does not appear in this part, return null (an empty array for arrays). Do not invent values or carry them over from other parts.',
    ].join('\n');

    const boundedTables = tables
      .slice(0, MAX_TABLES_IN_CONTEXT)
      .map((table: string[][], index: number) => {
        const rows = table.slice(0, MAX_TABLE_ROWS_IN_CONTEXT);
        const omitted = table.length > MAX_TABLE_ROWS_IN_CONTEXT
          ? `\n... (${table.length - MAX_TABLE_ROWS_IN_CONTEXT} more rows omitted)`
          : '';
        return `Table ${index + 1}\n${renderMarkdownTable(rows)}${omitted}`;
      })
      .join('\n\n');

    const tableContext = boundedTables
      ? truncate(`\nDetected tables:\n${boundedTables}`, MAX_TABLE_CONTEXT_CHARS)
      : '';

    const userPrompt = [
      `Extraction goal: ${prompt}`,
      '',
      `Schema: ${JSON.stringify(schemaToJsonDefinition(schema), null, 2)}`,
      '',
      `Return JSON shaped like: ${JSON.stringify(schemaSkeleton(schema))}`,
      '',
      partCount > 1
        ? `Document part ${partIndex + 1} of ${partCount} (${chunk.pageRange}):`
        : `Document (${chunk.pageRange}):`,
      // Safety cap only: chunks are packed to the budget, but a carried table
      // header can push one past it, and cutting here would drop its last rows.
      truncate(chunk.text, MAX_CHUNK_CHARS + MAX_PROMPT_CHUNK_HEADROOM),
      tableContext,
    ].join('\n');

    return { systemPrompt, userPrompt };
  }

  static async extractText(buffer: Buffer, documentMimeType: string = PDF_MIME_TYPE): Promise<{ text: string; pageCount: number }> {
    const parsed = await this.parseDocument(buffer, documentMimeType);
    return { text: parsed.text, pageCount: parsed.pageCount };
  }

  static async generateExtractionSchema(
    prompt: string,
    sampleText: string,
    llmConfig?: LLMConfig
  ): Promise<Record<string, any>> {
    const { systemPrompt, userPrompt } = this.buildSchemaPrompt(prompt, sampleText);

    try {
      const result = await DocumentLLMClient.callStructuredJson(systemPrompt, userPrompt, llmConfig);
      let schema = sanitizeSchema(result.payload, prompt);

      if (isCoarseSchema(schema, prompt)) {
        logger.info('[DocumentInterpreter] Coarse schema detected, expanding into atomic fields');
        try {
          const expansionPrompt = this.buildAtomicSchemaExpansionPrompt(prompt, sampleText, schema);
          const expanded = await DocumentLLMClient.callStructuredJson(
            expansionPrompt.systemPrompt,
            expansionPrompt.userPrompt,
            llmConfig
          );
          schema = sanitizeSchema(expanded.payload, prompt);
        } catch (expansionError: any) {
          logger.warn(`[DocumentInterpreter] Atomic schema expansion failed: ${expansionError.message}`);
        }
      }

      if (isCoarseSchema(schema, prompt)) {
        schema = inferAtomicFieldsFromSampleText(sampleText, prompt);
      }

      logger.info(
        `[DocumentInterpreter] Generated schema with ${Object.keys(schema).length} field(s) using ${result.provider}`
      );
      return schema;
    } catch (error: any) {
      logger.warn(`[DocumentInterpreter] Schema generation failed, using heuristic schema: ${error.message}`);
      return inferAtomicFieldsFromSampleText(sampleText, prompt);
    }
  }

  private static async parseDocument(buffer: Buffer, documentMimeType: string = PDF_MIME_TYPE): Promise<ParsedDocument> {
    if (documentMimeType === DOCX_MIME_TYPE) {
      return this.parseDOCX(buffer);
    }
    if (documentMimeType === XLSX_MIME_TYPE) {
      return this.parseXLSX(buffer);
    }
    if (documentMimeType === CSV_MIME_TYPE) {
      return this.parseCSV(buffer);
    }
    if (isImageMimeType(documentMimeType)) {
      return this.parseImage(buffer, documentMimeType);
    }
    return this.parsePDF(buffer);
  }

  static async extractData(
    buffer: Buffer,
    prompt: string,
    extractionSchema: Record<string, any>,
    llmConfig?: LLMConfig,
    documentMimeType: string = PDF_MIME_TYPE
  ): Promise<ExtractionResult> {
    const parsedDocument = await this.parseDocument(buffer, documentMimeType);
    const schema = sanitizeSchema(extractionSchema, prompt);
    const collectsRecords = Object.values(schema).some(
      (field) => field.type === 'array' && field.items?.type === 'object'
    );
    const chunks = buildChunks(parsedDocument.pages, collectsRecords ? recordChunkBudget(parsedDocument.pages, schema) : MAX_CHUNK_CHARS)
      .filter((chunk) => chunk.text.trim());

    // Tables now sit inside the page text where they belong. Only OCR'd
    // single-page documents (images) still carry separate key/value tables;
    // every chunk used to get the first 5 tables of the whole document, so
    // models re-extracted page 1's rows in every chunk.
    const contextTables = chunks.length <= 1 ? parsedDocument.tables : [];
    if (chunks.length === 0 && contextTables.length > 0) {
      chunks.push({ pageRange: '1', text: '' });
    }
    const providers: string[] = [];

    // Chunks run in parallel (they were sequential) and merge in page order.
    const results = await mapWithConcurrency(chunks, EXTRACTION_CONCURRENCY, (chunk, index) =>
      this.extractChunk(prompt, schema, chunk, index, chunks.length, contextTables, 0, providers, llmConfig)
    );

    let mergedData: Record<string, any> = {};
    for (const result of results) {
      if (result) mergedData = mergeExtractionResults(mergedData, result, schema);
    }

    if (!Object.values(mergedData).some(isMeaningful)) {
      mergedData = fallbackExtract(parsedDocument.text, schema);
    }

    return {
      data: normalizeExtractionData(mergedData),
      pageCount: parsedDocument.pageCount,
      model: providers[providers.length - 1] || 'heuristic-fallback',
      extractedAt: new Date().toISOString(),
      tabName: 'Document Data',
    };
  }

  /**
   * Extracts one chunk. When the model's answer was cut off by its output
   * limit (long tables), the chunk is re-extracted as two halves, up to
   * MAX_TRUNCATION_SPLITS levels deep. Previously the cut-off JSON failed to
   * parse and every value in that chunk was lost.
   */
  private static async extractChunk(
    prompt: string,
    schema: ExtractionSchema,
    chunk: DocumentChunk,
    partIndex: number,
    partCount: number,
    contextTables: string[][][],
    depth: number,
    providers: string[],
    llmConfig?: LLMConfig
  ): Promise<Record<string, any> | null> {
    const { systemPrompt, userPrompt } = this.buildExtractionPrompt(prompt, schema, chunk, partIndex, partCount, contextTables);

    let result: ProviderResult;
    try {
      result = await DocumentLLMClient.callStructuredJson(systemPrompt, userPrompt, llmConfig);
    } catch (error: any) {
      logger.warn(`[DocumentInterpreter] Chunk extraction failed for ${chunk.pageRange}: ${error.message}`);
      return null;
    }
    providers.push(result.provider);

    const normalized = normalizeResultToSchema(unwrapPayload(result.payload, schema), schema);

    if (result.truncated && depth < MAX_TRUNCATION_SPLITS) {
      const halves = splitChunkInTwo(chunk);
      if (halves) {
        logger.info(`[DocumentInterpreter] Output cut off for ${chunk.pageRange}; re-extracting in two halves`);
        // One half at a time, so retries stay within EXTRACTION_CONCURRENCY.
        const parts: Array<Record<string, any> | null> = [];
        for (const half of halves) {
          parts.push(
            await this.extractChunk(prompt, schema, half, partIndex, partCount, contextTables, depth + 1, providers, llmConfig)
          );
        }
        let merged: Record<string, any> = {};
        for (const part of parts) {
          if (part) merged = mergeExtractionResults(merged, part, schema);
        }
        // Keep scalars from the cut-off answer where the halves found none.
        return mergeExtractionResults(merged, scalarsOnly(normalized, schema), schema);
      }
      logger.warn(`[DocumentInterpreter] Output cut off for ${chunk.pageRange}; keeping the complete part`);
    }

    return normalized;
  }

  /**
   * Markdown for parse robots. PDF tables appear where they sit on the page
   * (they were missing entirely before); spreadsheets render as one table per
   * sheet instead of a tab-separated dump followed by the same data again as
   * a table.
   */
  private static async toMarkdown(doc: ParsedDocument): Promise<string> {
    if (doc.sourceHtml) {
      return promoteEmptyTableHeaders(await parseMarkdown(doc.sourceHtml));
    }

    const parts: string[] = [];

    for (const page of doc.pages) {
      const body = page.blocks ? renderBlocksMarkdown(page.blocks) : tidyLines(page.text);
      if (!body) continue;
      if (doc.isSpreadsheet) {
        parts.push(page.label && doc.pages.length > 1 ? `## ${page.label}\n\n${body}` : body);
      } else {
        parts.push(doc.isImage ? body : `## Page ${page.pageNumber}\n\n${body}`);
      }
    }

    doc.tables.forEach((table, index) => {
      if (table.length > 0) parts.push(`### Table ${index + 1}\n\n${renderMarkdownTable(table)}`);
    });

    return parts.join('\n\n');
  }

  private static toHtml(doc: ParsedDocument): string {
    if (doc.sourceHtml) return doc.sourceHtml;

    const parts: string[] = ['<article>'];

    for (const page of doc.pages) {
      const blocks: ContentBlock[] = page.blocks || [{ type: 'text', text: tidyLines(page.text) }];
      const body = renderBlocksHtml(blocks);
      if (!body.trim()) continue;
      if (doc.isSpreadsheet) {
        parts.push(page.label && doc.pages.length > 1 ? `<section>\n<h2>${escapeHtml(page.label)}</h2>\n${body}\n</section>` : body);
      } else {
        parts.push(
          doc.isImage
            ? body
            : `<section data-page="${page.pageNumber}">\n<h2>Page ${page.pageNumber}</h2>\n${body}\n</section>`
        );
      }
    }

    doc.tables.forEach((table) => {
      if (table.length > 0) parts.push(renderHtmlTable(table));
    });

    parts.push('</article>');
    return parts.join('\n');
  }

  private static extractLinks(text: string, sourceHtml?: string): string[] {
    // An image carries no link annotations, so the only links available are URLs that
    // appear as visible text — and those are usually written without a scheme. Match
    // three shapes: full http(s) URLs, "www."-prefixed hosts, and bare domains with a
    // recognizable TLD. The last two get "https://" prepended so the output is usable.
    const urlPattern = /(?<![@\w.-])(?:(?:https?:\/\/|www\.)[^\s<>"')\]]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|app|co|edu|gov|us|info)\b(?!\.[a-z])(?:\/[^\s<>"')\]]*)?)/gi;
    const raw = text.match(urlPattern) || [];
    const htmlLinks = sourceHtml
      ? Array.from(sourceHtml.matchAll(/href\s*=\s*["']([^"']+)["']/gi))
          .map((match) => match[1])
          .filter((href) => /^https?:\/\//i.test(href))
      : [];

    return [...new Set([
      ...raw.map((match) => {
        const url = match.replace(/[.,;:!?]+$/, '');
        return /^https?:\/\//i.test(url) ? url : `https://${url}`;
      }),
      ...htmlLinks,
    ])];
  }

  static async parse(
    buffer: Buffer,
    outputFormats: OutputFormats[],
    documentMimeType: string = PDF_MIME_TYPE,
    llmConfig?: LLMConfig
  ): Promise<ParsedOutput> {
    const parsed = await this.parseDocument(buffer, documentMimeType);
    const result: ParsedOutput = { pageCount: parsed.pageCount };

    if (outputFormats.includes('markdown')) result.markdown = await this.toMarkdown(parsed);
    if (outputFormats.includes('html')) result.html = this.toHtml(parsed);
    if (outputFormats.includes('links')) result.links = this.extractLinks(parsed.text, parsed.sourceHtml);

    if (outputFormats.includes('summary')) {
      const documentText = result.markdown || await this.toMarkdown(parsed);
      if (documentText.trim()) {
        try {
          const { summarizeMarkdown } = require('../../utils/summarizer');
          result.summary = await summarizeMarkdown(documentText, llmConfig);
        } catch (e: any) {
          logger.warn(`[DocumentInterpreter] Failed to generate document summary: ${e.message}`);
        }
      } else {
        logger.warn('[DocumentInterpreter] Skipping summary \u2014 document produced no text');
      }
    }

    return result;
  }
}
