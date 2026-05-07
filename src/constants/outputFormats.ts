export const OUTPUT_FORMAT_OPTIONS = [
  'markdown',
  'html',
  'text',
  'links',
  'screenshot-visible',
  'screenshot-fullpage',
] as const;

export type OutputFormats = (typeof OUTPUT_FORMAT_OPTIONS)[number];

export const DEFAULT_OUTPUT_FORMATS: OutputFormats[] = ['markdown'];

export const OUTPUT_FORMAT_LABELS: Record<OutputFormats, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  text: 'Text Content',
  links: 'Links',
  'screenshot-visible': 'Screenshot (Visible)',
  'screenshot-fullpage': 'Screenshot (Full Page)',
};
