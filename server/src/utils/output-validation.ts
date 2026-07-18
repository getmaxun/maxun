/**
 * True if a run's serializableOutput/binaryOutput has anything worth surfacing as partial data.
 * scrapeSchema/scrapeList/crawl/search are all stored as plain objects keyed by action name
 * (never arrays - Interpreter.ts's flushPersistenceBuffer explicitly normalizes them to `{}` if
 * they're ever caught as arrays), so every field here must be checked with
 * `Object.keys(...).length`, not `.length` (which is `undefined` on a plain object, so a
 * `.length > 0` check silently never matches).
 */
export function hasPartialOutput(
  serializableOutput?: Record<string, any> | null,
  binaryOutput?: Record<string, any> | null
): boolean {
  const hasKeyedData = (value: any): boolean =>
    !!value && typeof value === 'object' && Object.keys(value).length > 0;

  return (
    (!!serializableOutput && (
      hasKeyedData(serializableOutput.scrapeSchema) ||
      hasKeyedData(serializableOutput.scrapeList) ||
      hasKeyedData(serializableOutput.crawl) ||
      hasKeyedData(serializableOutput.search)
    )) ||
    hasKeyedData(binaryOutput)
  );
}

export interface RunLike {
  reload: () => Promise<any>;
  serializableOutput?: Record<string, any> | null;
  binaryOutput?: Record<string, any> | null;
}

export interface BrowserLike {
  interpreter?: {
    flushPersistenceBuffer: () => Promise<void>;
  } | null;
}

/**
 * Forces any still-buffered persistence writes out (scrapeList isn't on the interpreter's
 * immediate-flush allowlist, so it can sit debounced for up to 3s/5 items), reloads the run to
 * pick up the freshest serializableOutput/binaryOutput, and reports whether there's partial
 * output worth surfacing. Both the flush and the reload swallow their own errors - a failure
 * there just means falling back to whatever was already loaded on `run`, rather than blocking
 * the failure/abort path that calls this.
 */
export async function flushReloadAndCheckPartialOutput(
  run: RunLike,
  browser?: BrowserLike | null
): Promise<boolean> {
  try {
    if (browser && browser.interpreter) {
      await browser.interpreter.flushPersistenceBuffer();
    }
  } catch (_) {}

  try {
    await run.reload();
  } catch (_) {}

  return hasPartialOutput(run.serializableOutput, run.binaryOutput);
}

const SEARCH_OR_CRAWL_ERROR_MARKERS = [
  'Search execution error:',
  'Search action failed:',
  'Crawl execution error:',
  'Crawl action failed:',
];

export function getInterpretationFailureReason(logLines: unknown, fallbackMessage: string): string {
  if (!Array.isArray(logLines)) {
    return fallbackMessage;
  }

  const matchedLine = logLines.find(
    (line) =>
      typeof line === 'string' &&
      SEARCH_OR_CRAWL_ERROR_MARKERS.some((marker) => line.includes(marker))
  );

  return typeof matchedLine === 'string' && matchedLine.trim().length > 0
    ? matchedLine.trim()
    : fallbackMessage;
}

export function hasExpectedRobotOutput(
  robotType: string,
  categorizedOutput: {
    crawl?: Record<string, any>;
    search?: Record<string, any>;
  },
  selectedFormats?: string[],
  binaryOutput?: Record<string, any>
): boolean {
  const formatToFieldMap: Record<string, string> = {
    'markdown': 'markdown',
    'html': 'html',
    'text': 'text',
    'screenshot-visible': 'screenshotVisible',
    'screenshot-fullpage': 'screenshotFullpage',
  };

  let requestedFields = new Set<string>();
  if (selectedFormats && selectedFormats.length > 0) {
    selectedFormats.forEach(format => {
      const field = formatToFieldMap[format];
      if (field) requestedFields.add(field);
    });
  }

  if (binaryOutput && Object.keys(binaryOutput).length > 0) {
    requestedFields.add('binary');
  }

  if (requestedFields.size === 0) {
    if (robotType === 'search') {
      return Array.isArray((categorizedOutput.search as any)?.['Search Results']?.results) &&
             (categorizedOutput.search as any)?.['Search Results']?.results.length > 0;
    }
    if (robotType === 'crawl') {
      return Array.isArray((categorizedOutput.crawl as any)?.['Crawl Results']) &&
             (categorizedOutput.crawl as any)?.['Crawl Results'].length > 0;
    }
    return true;
  }

  if (robotType === 'search') {
    const results = (categorizedOutput.search as any)?.['Search Results']?.results;
    if (!Array.isArray(results) || results.length === 0) return false;

    return results.some((result: any) => {
      if (result.error) return false;
      for (const field of requestedFields) {
        if (field === 'binary') continue;
        if (result[field]) return true;
      }
      return requestedFields.has('binary');
    });
  }

  if (robotType === 'crawl') {
    const results = (categorizedOutput.crawl as any)?.['Crawl Results'];
    if (!Array.isArray(results) || results.length === 0) return false;

    return results.some((result: any) => {
      if (result.error) return false;
      for (const field of requestedFields) {
        if (field === 'binary') continue;
        if (result[field]) return true;
      }
      return requestedFields.has('binary');
    });
  }

  return true;
}
