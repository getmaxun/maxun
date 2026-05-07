export const OUTPUT_FORMAT_OPTIONS = [
  'markdown',
  'html',
  'text',
  'links',
  'screenshot-visible',
  'screenshot-fullpage',
] as const;

export type OutputFormats = (typeof OUTPUT_FORMAT_OPTIONS)[number];

export const SCRAPE_OUTPUT_FORMAT_OPTIONS: OutputFormats[] = [
  'markdown',
  'html',
  'text',
  'links',
  'screenshot-visible',
  'screenshot-fullpage',
];

export const SEARCH_SCRAPE_OUTPUT_FORMAT_OPTIONS: OutputFormats[] = [
  'markdown',
  'html',
  'text',
  'links',
  'screenshot-visible',
  'screenshot-fullpage',
];

const OUTPUT_FORMAT_SET = new Set<string>(OUTPUT_FORMAT_OPTIONS as readonly string[]);

export const DEFAULT_OUTPUT_FORMATS: OutputFormats[] = ['markdown'];

export function isOutputFormat(value: unknown): value is OutputFormats {
  return typeof value === 'string' && OUTPUT_FORMAT_SET.has(value);
}

export function parseOutputFormats(
  formats: unknown,
  allowedFormats: readonly OutputFormats[] = OUTPUT_FORMAT_OPTIONS
): {
  validFormats: OutputFormats[];
  invalidFormats: unknown[];
  wasProvided: boolean;
} {
  const wasProvided = formats !== undefined;
  const requestedFormats = Array.isArray(formats) ? formats : [];
  const validFormats: OutputFormats[] = [];
  const invalidFormats: unknown[] = [];
  const allowedSet = new Set<string>(allowedFormats as readonly string[]);

  requestedFormats.forEach((format) => {
    if (isOutputFormat(format) && allowedSet.has(format)) {
      validFormats.push(format);
    } else {
      invalidFormats.push(format);
    }
  });

  return { validFormats, invalidFormats, wasProvided };
}
