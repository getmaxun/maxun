export const OUTPUT_FORMAT_OPTIONS = [
  'markdown',
  'html',
  'text',
  'screenshot-visible',
  'screenshot-fullpage',
] as const;

export type OutputFormat = (typeof OUTPUT_FORMAT_OPTIONS)[number];

export const DEFAULT_OUTPUT_FORMATS: OutputFormat[] = ['markdown'];

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  text: 'Text Content',
  'screenshot-visible': 'Screenshot (Visible)',
  'screenshot-fullpage': 'Screenshot (Full Page)',
};
