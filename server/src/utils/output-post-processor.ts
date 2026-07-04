import logger from '../logger';
import { parseMarkdown } from '../markdownify/markdown';
import { DEFAULT_OUTPUT_FORMATS } from '../constants/output-formats';
import { LLMConfig } from '../sdk/browserAgent';

interface CategorizedOutput {
  crawl: Record<string, any>;
  search: Record<string, any>;
}

interface ProcessRobotOutputParams {
  robotType: string | undefined;
  outputFormats?: string[];
  categorizedOutput: CategorizedOutput;
  initialBinaryOutput?: Record<string, any>;
  llmConfig?: LLMConfig;
}

interface ProcessRobotOutputResult {
  categorizedOutput: CategorizedOutput;
  binaryOutput: Record<string, any>;
}

/**
 * Screenshots are captured by the interpreter during the scraping pass itself,
 * scraping pass itself, so no page is ever revisited here (see issue #1105).
 */
export async function processRobotOutputFormats(
  params: ProcessRobotOutputParams
): Promise<ProcessRobotOutputResult> {
  const {
    robotType,
    outputFormats,
    categorizedOutput,
    initialBinaryOutput,
    llmConfig,
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
        if (!effectiveFormats.includes('links')) delete pageResult.links;

        if (effectiveFormats.includes('summary')) {
          const pageText = (pageResult.markdown || pageResult.text || '').substring(0, 40000);
          if (pageText.trim()) {
            try {
              const { summarizeMarkdown } = require('../utils/summarizer');
              pageResult.summary = await summarizeMarkdown(pageText, llmConfig);
            } catch (e: any) {
              logger.log('warn', `Failed to generate crawl page summary: ${e.message}`);
            }
          }
        }

        if (!includeVisibleScreenshot) {
          delete pageResult.screenshotVisible;
        }

        if (!includeFullpageScreenshot) {
          delete pageResult.screenshotFullpage;
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
          if (!effectiveFormats.includes('links')) delete result.links;

          if (effectiveFormats.includes('summary')) {
            const pageText = (result.markdown || result.text || '').substring(0, 40000);
            if (pageText.trim()) {
              try {
                const { summarizeMarkdown } = require('../utils/summarizer');
                result.summary = await summarizeMarkdown(pageText, llmConfig);
              } catch (e: any) {
                logger.log('warn', `Failed to generate search result summary: ${e.message}`);
              }
            }
          }

          if (!includeVisibleScreenshot) {
            delete result.screenshotVisible;
          }

          if (!includeFullpageScreenshot) {
            delete result.screenshotFullpage;
          }
        }
      }
    }
  }

  return { categorizedOutput, binaryOutput };
}
