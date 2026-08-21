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

import * as XLSX from 'xlsx';

const MAX_SCHEMA_SAMPLE_CHARS = 16000;
const MAX_CHUNK_CHARS = 12000;
const MAX_FILE_SIZE_MB = 10;
const MAX_TABLES_IN_CONTEXT = 5;
const SCANNED_THRESHOLD_CHARS_PER_PAGE = 30;

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

interface ParsedPage {
  pageNumber: number;
  text: string;
}

interface ParsedDocument {
  text: string;
  pageCount: number;
  pages: ParsedPage[];
  tables: string[][][];
  sourceHtml?: string;
  /** True when the document came from a flat image, which has no page structure. */
  isImage?: boolean;
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
}

const normalizeWhitespace = (value: string): string =>
  value.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const cleanText = (value: string): string =>
  normalizeWhitespace(value.replace(/\x00/g, ''));

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

const preprocessPageImage = async (imagePath: string): Promise<void> => {
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
  }

  return null;
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

const isMeaningful = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isMeaningful);
  if (typeof value === 'object') return Object.values(value).some(isMeaningful);
  return true;
};

const parseNumericValue = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.-]+/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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

const isRecordArray = (value: any): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));

const normalizeExtractionData = (data: any): any => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const listEntries = Object.entries(data).filter(([, value]) => isRecordArray(value));
  if (listEntries.length === 0) return data;

  return listEntries.reduce<Record<string, any>>((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
};

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
      const parsed = new Date(value.trim());
      return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString();
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

const normalizeResultToSchema = (raw: any, schema: ExtractionSchema): Record<string, any> =>
  Object.entries(schema).reduce<Record<string, any>>((acc, [key, field]) => {
    const sourceValue = raw?.[key] ?? raw?.[field.label] ?? raw?.[field.label.toLowerCase()] ?? null;
    acc[key] = normalizeValueBySchema(sourceValue, field);
    return acc;
  }, {});

const mergeValues = (current: any, incoming: any, field: ExtractionSchemaField): any => {
  if (!isMeaningful(current)) return incoming;
  if (!isMeaningful(incoming)) return current;

  if (field.type === 'array') {
    const combined = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])];
    return combined.filter((item, index) =>
      combined.findIndex((c) => JSON.stringify(c) === JSON.stringify(item)) === index
    );
  }

  if (field.type === 'object' && field.fields) {
    return Object.entries(field.fields).reduce<Record<string, any>>((acc, [key, childField]) => {
      acc[key] = mergeValues(current?.[key], incoming?.[key], childField);
      return acc;
    }, {});
  }

  if (field.type === 'string') return String(incoming).length > String(current).length ? incoming : current;
  return current ?? incoming;
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

const buildChunks = (pages: ParsedPage[]): Array<{ pageRange: string; text: string }> => {
  const chunks: Array<{ pageRange: string; text: string }> = [];
  let currentPages: ParsedPage[] = [];
  let currentLength = 0;

  for (const page of pages) {
    const pageText = cleanText(page.text);
    if (!pageText) continue;

    const pageLength = pageText.length;
    if (currentPages.length > 0 && currentLength + pageLength > MAX_CHUNK_CHARS) {
      chunks.push({
        pageRange: `${currentPages[0].pageNumber}-${currentPages[currentPages.length - 1].pageNumber}`,
        text: currentPages.map((p) => `Page ${p.pageNumber}\n${cleanText(p.text)}`).join('\n\n'),
      });
      currentPages = [];
      currentLength = 0;
    }

    currentPages.push(page);
    currentLength += pageLength;
  }

  if (currentPages.length > 0) {
    chunks.push({
      pageRange: `${currentPages[0].pageNumber}-${currentPages[currentPages.length - 1].pageNumber}`,
      text: currentPages.map((p) => `Page ${p.pageNumber}\n${cleanText(p.text)}`).join('\n\n'),
    });
  }

  return chunks.length > 0 ? chunks : [{ pageRange: '1-1', text: '' }];
};

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
      return {
        payload: parseJsonLoose(data.message?.content || ''),
        provider: `ollama:${model}`,
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
    return {
      payload: parseJsonLoose(data.choices?.[0]?.message?.content || ''),
      provider: `openai:${model}`,
    };
  }

  private static async callAnthropic(
    systemPrompt: string,
    userPrompt: string,
    config: LLMConfig
  ): Promise<ProviderResult> {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    const model = config.model || 'claude-3-5-haiku-20241022';
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = (response.content?.[0] as any)?.text || '';
    return {
      payload: parseJsonLoose(content),
      provider: `anthropic:${model}`,
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

      const pageTexts = textResult.pages.map((page) => ({
        pageNumber: page.num,
        text: cleanText(page.text),
      }));

      let tables: string[][][] = [];
      try {
        const tableResult = await parser.getTable({ first: Math.min(pageCount, MAX_TABLES_IN_CONTEXT) });
        tables = tableResult.mergedTables.slice(0, MAX_TABLES_IN_CONTEXT);
      } catch (error: any) {
        logger.warn(`[DocumentInterpreter] Table extraction skipped: ${error.message}`);
      }

      return { text: combinedText, pageCount, pages: pageTexts, tables };
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

      const sheetText = normalizedRows.map((row) => row.join('\t')).join('\n');
      if (sheetText) {
        pages.push({ pageNumber: pages.length + 1, text: cleanText(sheetText) });
      }
    }

    const text = tables
      .map((table) =>
        table
          .map((row) => row.join('\t'))
          .join('\n')
      )
      .filter(Boolean)
      .join('\n\n');

    return {
      text: cleanText(text),
      pageCount: pages.length || workbook.SheetNames.length,
      pages,
      tables,
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

    const sheetText = normalizedRows.map((row: string[]) => row.join('\t')).join('\n');
    const text = cleanText(sheetText);

    return {
      text,
      pageCount: 1,
      pages: [{ pageNumber: 1, text }],
      tables: [normalizedRows],
    };
  }

  private static async parseDOCX(buffer: Buffer): Promise<ParsedDocument> {
    const [rawTextResult, htmlResult] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      mammoth.convertToHtml({ buffer }),
    ]);

    const text = cleanText(rawTextResult.value || '');
    return {
      text,
      pageCount: 1,
      pages: [{ pageNumber: 1, text }],
      tables: [],
      sourceHtml: (htmlResult.value || '').trim(),
    };
  }

  private static async parseImage(buffer: Buffer, documentMimeType: string): Promise<ParsedDocument> {
    const extension = documentMimeType === PNG_MIME_TYPE ? 'png' : 'jpg';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxun-img-'));
    const tempFile = path.join(tmpDir, `image.${extension}`);

    try {
      await fs.promises.writeFile(tempFile, buffer);

      const script = await this.detectScript(tempFile);
      logger.info(`[DocumentInterpreter] OCR on uploaded image (mimeType: ${documentMimeType}) script: ${script}`);

      let text = '';
      let tables: string[][][] = [];
      let paddleSucceeded = false;

      try {
        const { lines } = await PaddleOCRProvider.recognizePage(tempFile, script);
        text = cleanText(reconstructTextFromPaddleLines(lines));
        // Treat an empty PaddleOCR result as a failure, not a success.
        if (text) {
          tables = extractTablesFromPaddleLines([lines]);
          paddleSucceeded = true;
        }
      } catch (paddleErr: any) {
        logger.warn(`[DocumentInterpreter] PaddleOCR failed (${paddleErr.message}), falling back to Tesseract`);
      }

      if (!paddleSucceeded) {
        text = cleanText(await this.ocrImageWithTesseract(tempFile, script));
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
    chunk: { pageRange: string; text: string },
    tables: string[][][]
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = [
      'You extract structured JSON from business documents.',
      'Return only valid JSON.',
      'Use the provided schema exactly for keys.',
      'If a value is missing, return null.',
      'For arrays, return arrays.',
      'Do not invent values not grounded in the provided text.',
    ].join('\n');

    const tableContext = tables.length > 0
      ? `\nDetected tables:\n${tables.map((table, index) => `Table ${index + 1}\n${table.map((row) => row.join(' | ')).join('\n')}`).join('\n\n')}`
      : '';

    const userPrompt = [
      `Extraction goal: ${prompt}`,
      '',
      `Schema: ${JSON.stringify(schemaToJsonDefinition(schema), null, 2)}`,
      '',
      `Document chunk pages: ${chunk.pageRange}`,
      truncate(chunk.text, MAX_CHUNK_CHARS),
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
    const chunks = buildChunks(parsedDocument.pages);

    let mergedData: Record<string, any> = {};
    let providerLabel = 'heuristic-fallback';

    for (const chunk of chunks) {
      if (!chunk.text.trim()) continue;

      const { systemPrompt, userPrompt } = this.buildExtractionPrompt(
        prompt,
        schema,
        chunk,
        parsedDocument.tables
      );

      try {
        const result = await DocumentLLMClient.callStructuredJson(systemPrompt, userPrompt, llmConfig);
        const normalized = normalizeResultToSchema(result.payload, schema);
        mergedData = mergeExtractionResults(mergedData, normalized, schema);
        providerLabel = result.provider;
      } catch (error: any) {
        logger.warn(`[DocumentInterpreter] Chunk extraction failed for pages ${chunk.pageRange}: ${error.message}`);
      }
    }

    if (!Object.values(mergedData).some(isMeaningful)) {
      mergedData = fallbackExtract(parsedDocument.text, schema);
    }

    return {
      data: normalizeExtractionData(mergedData),
      pageCount: parsedDocument.pageCount,
      model: providerLabel,
      extractedAt: new Date().toISOString(),
      tabName: 'Document Data',
    };
  }

  private static async toMarkdown(doc: ParsedDocument): Promise<string> {
    if (doc.sourceHtml) {
      return parseMarkdown(doc.sourceHtml);
    }

    const parts: string[] = [];

    for (const page of doc.pages) {
      const text = cleanText(page.text);
      if (!text) continue;
      parts.push(doc.isImage ? text : `## Page ${page.pageNumber}\n\n${text}`);
    }

    for (let i = 0; i < doc.tables.length; i++) {
      const table = doc.tables[i];
      if (table.length === 0) continue;
      const header = table[0].map((cell) => cell.trim() || ' ').join(' | ');
      const separator = table[0].map(() => '---').join(' | ');
      const rows = table.slice(1).map((row) =>
        row.map((cell) => cell.trim().replace(/\n/g, ' ') || ' ').join(' | ')
      );
      parts.push(`### Table ${i + 1}\n\n| ${header} |\n| ${separator} |\n${rows.map((r) => `| ${r} |`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  private static toHtml(doc: ParsedDocument): string {
    if (doc.sourceHtml) return doc.sourceHtml;

    const parts: string[] = ['<article>'];

    for (const page of doc.pages) {
      const text = cleanText(page.text);
      if (!text) continue;
      const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('\n');
        parts.push(
          doc.isImage
            ? paragraphs
            : `<section data-page="${page.pageNumber}">\n<h2>Page ${page.pageNumber}</h2>\n${paragraphs}\n</section>`
        );
    }

    for (let i = 0; i < doc.tables.length; i++) {
      const table = doc.tables[i];
      if (table.length === 0) continue;
      const header = `<thead><tr>${table[0].map((cell) => `<th>${cell.trim()}</th>`).join('')}</tr></thead>`;
      const body = `<tbody>${table
        .slice(1)
        .map((row) => `<tr>${row.map((cell) => `<td>${cell.trim()}</td>`).join('')}</tr>`)
        .join('\n')}</tbody>`;
      parts.push(`<table>\n${header}\n${body}\n</table>`);
    }

    parts.push('</article>');
    return parts.join('\n');
  }

  private static extractLinks(text: string, sourceHtml?: string): string[] {
    // An image carries no link annotations, so the only links available are URLs that
    // appear as visible text — and those are usually written without a scheme. Match
    // three shapes: full http(s) URLs, "www."-prefixed hosts, and bare domains with a
    // recognizable TLD. The last two get "https://" prepended so the output is usable.
    const urlPattern =
      /(?:https?:\/\/|www\.)[^\s<>"')\]]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|app|co|edu|gov|us|info)\b(?:\/[^\s<>"')\]]*)?/gi;
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
