import { getPageSource, GetPageSourceOptions } from './get_html';
import { getProcessedText, ProcessTextOptions } from './get_llm_input_text';

export interface UrlToLlmTextOptions extends GetPageSourceOptions, ProcessTextOptions {
  // Combined options from both interfaces
}

export async function urlToLlmText(
  url: string,
  options: UrlToLlmTextOptions = {}
): Promise<string> {
  try {
    const pageSource = await getPageSource(url, options);
    
    if (!pageSource) {
      return '';
    }

    const llmText = await getProcessedText(pageSource, url, options);
    return llmText;
    
  } catch (error) {
    console.error('Error while scraping url: ', error);
    return '';
  }
}

// Export individual functions as well
export { getPageSource, getProcessedText };