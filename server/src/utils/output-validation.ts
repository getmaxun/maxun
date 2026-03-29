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
