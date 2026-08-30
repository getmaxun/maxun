export const SEARCH_PROVIDERS = ['duckduckgo', 'xquik'] as const;
export type SearchProvider = typeof SEARCH_PROVIDERS[number];
export type SearchMode = 'discover' | 'scrape';

type SearchConfig = Record<string, any> & {
  query: string;
  limit: number;
  provider: SearchProvider;
  mode: SearchMode;
};

type SearchConfigResult =
  | { config: SearchConfig; error?: never }
  | { config?: never; error: string };

const SEARCH_TIME_RANGES = ['', 'day', 'week', 'month', 'year'];

export const normalizeSearchConfig = (
  value: unknown,
  hasTopLevelFormats = false,
): SearchConfigResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Search configuration must be an object.' };
  }

  const input = value as Record<string, any>;
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return { error: 'Search configuration with query is required.' };

  const provider = input.provider ?? 'duckduckgo';
  if (!SEARCH_PROVIDERS.includes(provider)) {
    return { error: 'Search provider must be either "duckduckgo" or "xquik".' };
  }

  const hasOutputFormats = Array.isArray(input.outputFormats) && input.outputFormats.length > 0;
  const mode = hasOutputFormats ? 'scrape' : input.mode ?? (hasTopLevelFormats ? 'scrape' : 'discover');
  if (mode !== 'discover' && mode !== 'scrape') {
    return { error: 'Search mode must be either "discover" or "scrape".' };
  }
  if (provider === 'xquik' && mode !== 'discover') {
    return { error: 'Xquik search supports discover mode only.' };
  }

  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1) {
    return { error: 'Search limit must be a positive integer.' };
  }
  if (provider === 'xquik' && limit > 10000) {
    return { error: 'Xquik search supports at most 10000 results.' };
  }

  if (input.filters !== undefined && (!input.filters || typeof input.filters !== 'object' || Array.isArray(input.filters))) {
    return { error: 'Search filters must be an object.' };
  }
  const timeRange = input.filters?.timeRange;
  if (timeRange !== undefined && !SEARCH_TIME_RANGES.includes(timeRange)) {
    return { error: 'Search time range must be day, week, month, year, or empty.' };
  }

  return {
    config: {
      ...input,
      query,
      provider,
      mode,
      limit,
    },
  };
};
