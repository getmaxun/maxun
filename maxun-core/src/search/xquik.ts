import fetch from 'cross-fetch';

export type SearchTimeRange = 'day' | 'week' | 'month' | 'year';

export interface XquikSearchResult {
  url: string;
  title: string;
  description: string;
  position: number;
}

interface XquikTweet {
  id?: unknown;
  text?: unknown;
  author?: {
    name?: unknown;
    username?: unknown;
  };
}

interface XquikSearchPage {
  tweets?: unknown;
  has_next_page?: unknown;
  next_cursor?: unknown;
}

interface XquikSearchOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const XQUIK_SEARCH_URL = 'https://xquik.com/api/v1/x/tweets/search';
const XQUIK_SEARCH_TIMEOUT_MS = 30000;
const TIME_RANGE_DAYS: Record<SearchTimeRange, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

const postUrl = (id: string, username: string): string => {
  const normalizedUsername = username.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(normalizedUsername)
    ? `https://x.com/${normalizedUsername}/status/${encodeURIComponent(id)}`
    : `https://x.com/i/web/status/${encodeURIComponent(id)}`;
};

const normalizeTweet = (value: unknown, position: number): XquikSearchResult | null => {
  if (!value || typeof value !== 'object') return null;
  const tweet = value as XquikTweet;
  const id = typeof tweet.id === 'string' || typeof tweet.id === 'number'
    ? String(tweet.id).trim()
    : '';
  if (!id) return null;

  const username = typeof tweet.author?.username === 'string'
    ? tweet.author.username
    : '';
  const name = typeof tweet.author?.name === 'string' ? tweet.author.name.trim() : '';
  const normalizedUsername = username.replace(/^@/, '');
  const title = name && normalizedUsername
    ? `${name} (@${normalizedUsername})`
    : normalizedUsername ? `@${normalizedUsername}` : 'X post';

  return {
    url: postUrl(id, username),
    title,
    description: typeof tweet.text === 'string' ? tweet.text : '',
    position,
  };
};

export const searchXquikPosts = async (
  query: string,
  limit: number,
  timeRange?: SearchTimeRange,
  options: XquikSearchOptions = {},
): Promise<XquikSearchResult[]> => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error('Xquik search requires a query.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error('Xquik search supports 1 to 10000 results.');
  }

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Xquik search requires X_TWITTER_SCRAPER_API_KEY.');
  }

  const baseUrl = new URL(XQUIK_SEARCH_URL);
  baseUrl.searchParams.set('q', normalizedQuery);
  baseUrl.searchParams.set('limit', String(limit));
  baseUrl.searchParams.set('queryType', 'Latest');
  if (timeRange) {
    const days = TIME_RANGE_DAYS[timeRange];
    if (!days) throw new Error('Xquik search received an unsupported time range.');
    const since = new Date((options.now ?? (() => new Date()))().getTime());
    since.setUTCDate(since.getUTCDate() - days);
    baseUrl.searchParams.set('sinceTime', since.toISOString());
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortSearch = (): void => controller.abort();
  if (options.signal?.aborted) {
    abortSearch();
  } else {
    options.signal?.addEventListener('abort', abortSearch, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    abortSearch();
  }, options.timeoutMs ?? XQUIK_SEARCH_TIMEOUT_MS);

  try {
    const results: XquikSearchResult[] = [];
    const seenCursors = new Set<string>();
    let cursor = '';

    while (results.length < limit) {
      const url = new URL(baseUrl);
      if (cursor) url.searchParams.set('cursor', cursor);

      let response: Awaited<ReturnType<typeof fetch>>;
      try {
        response = await (options.fetchImpl ?? fetch)(url.toString(), {
          headers: {
            accept: 'application/json',
            'x-api-key': apiKey,
          },
          signal: controller.signal,
        });
      } catch {
        if (options.signal?.aborted) throw new Error('Xquik search was aborted.');
        if (timedOut) throw new Error('Xquik search timed out.');
        throw new Error('Xquik search request failed.');
      }
      if (!response.ok) {
        throw new Error(`Xquik search failed with status ${response.status}.`);
      }

      let payload: XquikSearchPage | null = null;
      try {
        payload = await response.json() as XquikSearchPage;
      } catch {
        if (options.signal?.aborted) throw new Error('Xquik search was aborted.');
        if (timedOut) throw new Error('Xquik search timed out.');
      }
      if (!payload || !Array.isArray(payload.tweets)) {
        throw new Error('Xquik search returned an invalid response.');
      }

      for (const tweet of payload.tweets) {
        const result = normalizeTweet(tweet, results.length + 1);
        if (result) results.push(result);
        if (results.length === limit) break;
      }

      if (results.length === limit || payload.has_next_page !== true) break;
      const nextCursor = typeof payload.next_cursor === 'string' ? payload.next_cursor : '';
      if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
        throw new Error('Xquik search returned an invalid pagination cursor.');
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return results;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortSearch);
  }
};
