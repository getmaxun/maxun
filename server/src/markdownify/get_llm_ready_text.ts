import { getPageSource, GetPageSourceOptions } from './get_html';
import { getProcessedText, ProcessTextOptions, ProcessedResult } from './get_llm_input_text';

export interface UrlToLlmTextOptions extends GetPageSourceOptions, ProcessTextOptions {}

export async function urlToLlmText(
  url: string,
  options: UrlToLlmTextOptions = {}
): Promise<ProcessedResult> {
  try {
    const pageSource = await getPageSource(url, options);
    
    if (!pageSource) {
      return {
        markdown: '',
        plainText: '',
        metadata: {
          title: '',
          url: url,
          processedAt: new Date().toISOString(),
          textLength: 0,
          markdownLength: 0
        }
      };
    }

    const result = await getProcessedText(pageSource, url, options);
    return result;
    
  } catch (error) {
    console.error('Error while scraping url: ', error);
    return {
      markdown: '',
      plainText: '',
      metadata: {
        title: '',
        url: url,
        processedAt: new Date().toISOString(),
        textLength: 0,
        markdownLength: 0
      }
    };
  }
}

export { getPageSource, getProcessedText };