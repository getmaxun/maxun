export const OUTPUT_FORMAT_OPTIONS = [
  'markdown',
  'html',
  'text',
  'links',
  'summary',
  'screenshot-visible',
  'screenshot-fullpage',
] as const;

export type OutputFormat = (typeof OUTPUT_FORMAT_OPTIONS)[number];

/**
 * Formats that require a full browser render of the page.
 * Used to decide whether the interpreter needs to keep a live browser page open.
 * 'links' is excluded — link extraction is lightweight and does not need rendering.
 */
export const HEAVY_RENDER_FORMATS: readonly OutputFormat[] = [
  'markdown',
  'html',
  'text',
  'summary',
  'screenshot-visible',
  'screenshot-fullpage',
];
