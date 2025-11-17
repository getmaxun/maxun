// SPDX-License-Identifier: MIT

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
      return createEmptyResult(url);
    }

    const result = await getProcessedText(pageSource, url, options);
    return result;
    
  } catch (error) {
    console.error('Error while scraping url: ', error);
    return createEmptyResult(url);
  }
}

function createEmptyResult(url: string): ProcessedResult {
  return {
    markdown: '',
    plainText: '',
    metadata: {
      title: '',
      description: '',
      url: url,
      processedAt: new Date().toISOString(),
      textLength: 0,
      markdownLength: 0,
      hasContent: false,
      language: 'en',
      wordCount: 0,
      linkCount: 0,
      imageCount: 0
    }
  };
}

export { getPageSource, getProcessedText };