export const OUTPUT_FORMAT_OPTIONS = [
  'markdown',
  'html',
  'text',
  'screenshot-visible',
  'screenshot-fullpage',
] as const;

export type OutputFormat = (typeof OUTPUT_FORMAT_OPTIONS)[number];

export const SCRAPE_OUTPUT_FORMAT_OPTIONS: OutputFormat[] = [
  'markdown',
  'html',
  'screenshot-visible',
  'screenshot-fullpage',
];

export const SEARCH_SCRAPE_OUTPUT_FORMAT_OPTIONS: OutputFormat[] = [
  'markdown',
  'html',
  'text',
  'screenshot-visible',
  'screenshot-fullpage',
];

const OUTPUT_FORMAT_SET = new Set<string>(OUTPUT_FORMAT_OPTIONS as readonly string[]);

export const DEFAULT_OUTPUT_FORMATS: OutputFormat[] = ['markdown'];

export function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && OUTPUT_FORMAT_SET.has(value);
}

export function parseOutputFormats(
  formats: unknown,
  allowedFormats: readonly OutputFormat[] = OUTPUT_FORMAT_OPTIONS
): {
  validFormats: OutputFormat[];
  invalidFormats: unknown[];
  wasProvided: boolean;
} {
  const wasProvided = formats !== undefined;
  const requestedFormats = Array.isArray(formats) ? formats : [];
  const validFormats: OutputFormat[] = [];
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
