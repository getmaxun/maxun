import { Page } from 'playwright-core';
import logger from '../logger';
import { parseMarkdown } from '../markdownify/markdown';
import { convertPageToScreenshot } from '../markdownify/scrape';
import { DEFAULT_OUTPUT_FORMATS } from '../constants/output-formats';

interface CategorizedOutput {
  crawl: Record<string, any>;
  search: Record<string, any>;
}

interface ProcessRobotOutputParams {
  robotType: string | undefined;
  outputFormats?: string[];
  categorizedOutput: CategorizedOutput;
  currentPage: Page;
  initialBinaryOutput?: Record<string, any>;
}

interface ProcessRobotOutputResult {
  categorizedOutput: CategorizedOutput;
  binaryOutput: Record<string, any>;
}

export async function processRobotOutputFormats(
  params: ProcessRobotOutputParams
): Promise<ProcessRobotOutputResult> {
  const {
    robotType,
    outputFormats,
    categorizedOutput,
    currentPage,
    initialBinaryOutput,
  } = params;

  const binaryOutput: Record<string, any> = {
    ...(initialBinaryOutput || {}),
  };

  const effectiveFormats = Array.isArray(outputFormats)
    ? (outputFormats.length > 0
      ? outputFormats
      : robotType === 'crawl'
        ? DEFAULT_OUTPUT_FORMATS
        : outputFormats) 
    : DEFAULT_OUTPUT_FORMATS;

  if (robotType !== 'crawl' && robotType !== 'search') {
    return { categorizedOutput, binaryOutput };
  }

  if (robotType === 'crawl' && Array.isArray((categorizedOutput.crawl as any)?.['Crawl Results'])) {
    const crawlResults: any[] = (categorizedOutput.crawl as any)['Crawl Results'];
    const includeVisibleScreenshot = effectiveFormats.includes('screenshot-visible');
    const includeFullpageScreenshot = effectiveFormats.includes('screenshot-fullpage');

    for (let pageIndex = 0; pageIndex < crawlResults.length; pageIndex++) {
      const pageResult = crawlResults[pageIndex];
      if (!pageResult.error) {
        let markdownConversionSucceeded = false;
        if (effectiveFormats.includes('markdown') && pageResult.html) {
          try {
            pageResult.markdown = await parseMarkdown(pageResult.html, pageResult.metadata?.url);
            markdownConversionSucceeded = true;
          } catch (e: any) {
            logger.log('warn', `Failed to convert crawl page to markdown: ${e.message}`);
          }
        }

        if (!effectiveFormats.includes('html') && markdownConversionSucceeded) {
          delete pageResult.html;
        }
        if (!effectiveFormats.includes('text')) delete pageResult.text;

        const pageUrl = pageResult.metadata?.url || pageResult.url;
        const hasPageUrl = typeof pageUrl === 'string' && pageUrl.trim() !== '';

        if (!includeVisibleScreenshot) {
          delete pageResult.screenshotVisible;
        }

        if (!includeFullpageScreenshot) {
          delete pageResult.screenshotFullpage;
        }

        if ((includeVisibleScreenshot || includeFullpageScreenshot) && hasPageUrl) {
          if (includeVisibleScreenshot) {
            try {
              const screenshotBuffer = await convertPageToScreenshot(pageUrl, currentPage, false);
              const screenshotKey = `crawl-${pageIndex + 1}-screenshot-visible`;
              binaryOutput[screenshotKey] = {
                data: screenshotBuffer.toString('base64'),
                mimeType: 'image/png',
              };
              pageResult.screenshotVisible = screenshotKey;
            } catch (e: any) {
              logger.log('warn', `Failed to capture visible crawl screenshot for ${pageUrl}: ${e.message}`);
            }
          }

          if (includeFullpageScreenshot) {
            try {
              const screenshotBuffer = await convertPageToScreenshot(pageUrl, currentPage, true);
              const screenshotKey = `crawl-${pageIndex + 1}-screenshot-fullpage`;
              binaryOutput[screenshotKey] = {
                data: screenshotBuffer.toString('base64'),
                mimeType: 'image/png',
              };
              pageResult.screenshotFullpage = screenshotKey;
            } catch (e: any) {
              logger.log('warn', `Failed to capture fullpage crawl screenshot for ${pageUrl}: ${e.message}`);
            }
          }
        } else if (includeVisibleScreenshot || includeFullpageScreenshot) {
          logger.log('warn', `Skipping crawl screenshot capture for page index ${pageIndex} because URL is missing`);
        }
      }
    }
  }

  if (robotType === 'search') {
    const searchResultGroup = (categorizedOutput.search as any)?.['Search Results'];
    if (searchResultGroup?.mode === 'scrape' && Array.isArray(searchResultGroup?.results)) {
      const includeVisibleScreenshot = effectiveFormats.includes('screenshot-visible');
      const includeFullpageScreenshot = effectiveFormats.includes('screenshot-fullpage');

      for (let resultIndex = 0; resultIndex < searchResultGroup.results.length; resultIndex++) {
        const result = searchResultGroup.results[resultIndex];
        if (!result.error) {
          let markdownConversionSucceeded = false;
          if (effectiveFormats.includes('markdown') && result.html) {
            try {
              result.markdown = await parseMarkdown(result.html, result.metadata?.url);
              markdownConversionSucceeded = true;
            } catch (e: any) {
              logger.log('warn', `Failed to convert search result to markdown: ${e.message}`);
            }
          }

          if (!effectiveFormats.includes('html') && markdownConversionSucceeded) {
            delete result.html;
          }
          if (!effectiveFormats.includes('text')) delete result.text;

          const resultUrl = result.metadata?.url || result.url;
          const hasResultUrl = typeof resultUrl === 'string' && resultUrl.trim() !== '';

          if (!includeVisibleScreenshot) {
            delete result.screenshotVisible;
          }

          if (!includeFullpageScreenshot) {
            delete result.screenshotFullpage;
          }

          if ((includeVisibleScreenshot || includeFullpageScreenshot) && hasResultUrl) {
            if (includeVisibleScreenshot) {
              try {
                const screenshotBuffer = await convertPageToScreenshot(resultUrl, currentPage, false);
                const screenshotKey = `search-${resultIndex + 1}-screenshot-visible`;
                binaryOutput[screenshotKey] = {
                  data: screenshotBuffer.toString('base64'),
                  mimeType: 'image/png',
                };
                result.screenshotVisible = screenshotKey;
              } catch (e: any) {
                logger.log('warn', `Failed to capture visible search screenshot for ${resultUrl}: ${e.message}`);
              }
            }

            if (includeFullpageScreenshot) {
              try {
                const screenshotBuffer = await convertPageToScreenshot(resultUrl, currentPage, true);
                const screenshotKey = `search-${resultIndex + 1}-screenshot-fullpage`;
                binaryOutput[screenshotKey] = {
                  data: screenshotBuffer.toString('base64'),
                  mimeType: 'image/png',
                };
                result.screenshotFullpage = screenshotKey;
              } catch (e: any) {
                logger.log('warn', `Failed to capture fullpage search screenshot for ${resultUrl}: ${e.message}`);
              }
            }
          } else if (includeVisibleScreenshot || includeFullpageScreenshot) {
            logger.log('warn', `Skipping search screenshot capture for result index ${resultIndex} because URL is missing`);
          }
        }
      }
    }
  }

  return { categorizedOutput, binaryOutput };
}
