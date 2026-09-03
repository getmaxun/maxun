export const normalizeRobotUrl = (rawUrl: string): string => {
  let normalizedUrl: URL;
  try {
    normalizedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      `"${rawUrl.trim()}" is not a valid URL. Provide a full web address like https://example.com`
    );
  }

  if (!['http:', 'https:'].includes(normalizedUrl.protocol)) {
    throw new Error(
      `Unsupported URL protocol "${normalizedUrl.protocol}//" — only http and https are supported. Local file paths cannot be scraped.`
    );
  }

  const hostname = normalizedUrl.hostname;
  const isPlausibleHost =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname) ||
    hostname === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    /^\[[0-9a-f:]+\]$/i.test(hostname);

  if (!isPlausibleHost) {
    throw new Error(
      `"${hostname}" is not a reachable hostname. Provide a full web address like https://example.com`
    );
  }

  normalizedUrl.search = normalizedUrl.searchParams.toString();
  return normalizedUrl.toString();
};

export const normalizeWorkflowUrls = (workflow: any[] = []): any[] =>
  workflow.map((pair: any) => ({
    ...pair,
    where: pair?.where
      ? {
          ...pair.where,
          ...(typeof pair.where.url === 'string' && pair.where.url !== 'about:blank'
            ? { url: normalizeRobotUrl(pair.where.url) }
            : {}),
        }
      : pair?.where,
    what: Array.isArray(pair?.what)
      ? pair.what.map((action: any) => {
          if (
            action.action === 'goto' &&
            Array.isArray(action.args) &&
            typeof action.args[0] === 'string' &&
            action.args[0] !== 'about:blank'
          ) {
            return {
              ...action,
              args: [normalizeRobotUrl(action.args[0]), ...action.args.slice(1)],
            };
          }

          if (
            (action.action === 'scrape' || action.action === 'crawl') &&
            Array.isArray(action.args) &&
            action.args[0] &&
            typeof action.args[0] === 'object' &&
            typeof action.args[0].url === 'string' &&
            action.args[0].url !== 'about:blank'
          ) {
            return {
              ...action,
              args: [
                {
                  ...action.args[0],
                  url: normalizeRobotUrl(action.args[0].url),
                },
                ...action.args.slice(1),
              ],
            };
          }

          return action;
        })
      : pair?.what,
  }));

export const applyWorkflowLimits = (
  workflow: any[],
  limits: any[]
): void => {
  for (const { pairIndex, actionIndex, argIndex, limit } of limits) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(
        `Invalid limit: ${limit}. Must be a positive integer.`
      );
    }

    const arg =
      workflow[pairIndex]?.what?.[actionIndex]?.args?.[argIndex];

    if (!arg || typeof arg !== 'object') {
      throw new Error(
        `No action argument at pair ${pairIndex}, action ${actionIndex}, arg ${argIndex}.`
      );
    }

    (arg as { limit: number }).limit = limit;
  }
};