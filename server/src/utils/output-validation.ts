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
  }
): boolean {
  if (robotType === 'search') {
    return Array.isArray((categorizedOutput.search as any)?.['Search Results']?.results);
  }

  if (robotType === 'crawl') {
    return Array.isArray((categorizedOutput.crawl as any)?.['Crawl Results']);
  }

  return true;
}
