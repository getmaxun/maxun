export const OUTPUT_FORMAT_OPTIONS = [
  'markdown',
  'html',
  'text',
  'links',
  'summary',
  'screenshot-visible',
  'screenshot-fullpage',
] as const;

export type OutputFormats = (typeof OUTPUT_FORMAT_OPTIONS)[number];

export const DEFAULT_OUTPUT_FORMATS: OutputFormats[] = ['markdown'];

export const DOC_PARSE_FORMAT_OPTIONS: OutputFormats[] = ['markdown', 'html', 'links'];

export const OUTPUT_FORMAT_LABELS: Record<OutputFormats, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  text: 'Text Content',
  links: 'Links',
  summary: 'Summary',
  'screenshot-visible': 'Screenshot (Visible)',
  'screenshot-fullpage': 'Screenshot (Full Page)',
};
