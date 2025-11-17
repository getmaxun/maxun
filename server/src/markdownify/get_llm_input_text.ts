import * as cheerio from 'cheerio';
import { URL } from 'url';

export interface ProcessTextOptions {
  keepImages?: boolean;
  removeSvgImage?: boolean;
  removeGifImage?: boolean;
  removeImageTypes?: string[];
  keepWebpageLinks?: boolean;
  removeScriptTag?: boolean;
  removeStyleTag?: boolean;
  removeTags?: string[];
  formatAsMarkdown?: boolean;
}

export interface ProcessedResult {
  markdown: string;
  plainText: string;
  metadata: {
    title: string;
    url: string;
    processedAt: string;
    textLength: number;
    markdownLength: number;
  };
}

export async function getProcessedText(
  pageSource: string,
  baseUrl: string,
  options: ProcessTextOptions = {}
): Promise<ProcessedResult> {
  const {
    keepImages = true,
    removeSvgImage = true,
    removeGifImage = true,
    removeImageTypes = [],
    keepWebpageLinks = true,
    removeScriptTag = true,
    removeStyleTag = true,
    removeTags = [],
    formatAsMarkdown = true
  } = options;

  try {
    const $ = cheerio.load(pageSource);
    
    // Remove unwanted tags
    const tagsToRemove: string[] = [];
    if (removeScriptTag) tagsToRemove.push('script');
    if (removeStyleTag) tagsToRemove.push('style');
    tagsToRemove.push(...removeTags);
    
    const uniqueTags = [...new Set(tagsToRemove)];
    uniqueTags.forEach(tag => {
      $(tag).remove();
    });

    // Extract page title
    const title = $('title').text() || $('h1').first().text() || 'Untitled';
    
    // Generate both formats
    const markdown = formatAsMarkdown ? 
      convertToMarkdown($, baseUrl, options) : 
      convertToPlainText($, baseUrl, options); // Fallback to plain text if markdown disabled
    
    const plainText = convertToPlainText($, baseUrl, options);

    const result: ProcessedResult = {
      markdown,
      plainText,
      metadata: {
        title: title.trim(),
        url: baseUrl,
        processedAt: new Date().toISOString(),
        textLength: plainText.length,
        markdownLength: markdown.length
      }
    };

    return result;

  } catch (error) {
    console.error('Error while getting processed text: ', error);
    // Return empty result on error
    return {
      markdown: '',
      plainText: '',
      metadata: {
        title: '',
        url: baseUrl,
        processedAt: new Date().toISOString(),
        textLength: 0,
        markdownLength: 0
      }
    };
  }
}

function convertToMarkdown($: cheerio.CheerioAPI, baseUrl: string, options: ProcessTextOptions): string {
  const { keepImages, keepWebpageLinks } = options;
  
  // Clone the body to avoid modifying the original
  const $body = $('body').clone();
  
  // Process headers
  $body.find('h1').each((_, element) => {
    const $el = $(element);
    $el.replaceWith(`# ${$el.text().trim()}\n\n`);
  });
  
  $body.find('h2').each((_, element) => {
    const $el = $(element);
    $el.replaceWith(`## ${$el.text().trim()}\n\n`);
  });
  
  $body.find('h3').each((_, element) => {
    const $el = $(element);
    $el.replaceWith(`### ${$el.text().trim()}\n\n`);
  });
  
  $body.find('h4, h5, h6').each((_, element) => {
    const $el = $(element);
    const level = element.name?.substring(1) || '4';
    const hashes = '#'.repeat(parseInt(level));
    $el.replaceWith(`${hashes} ${$el.text().trim()}\n\n`);
  });

  // Process paragraphs
  $body.find('p').each((_, element) => {
    const $el = $(element);
    $el.replaceWith(`${$el.text().trim()}\n\n`);
  });

  // Process lists
  $body.find('li').each((_, element) => {
    const $el = $(element);
    const text = $el.text().trim();
    if ($el.parent().is('ol')) {
      $el.replaceWith(`1. ${text}\n`);
    } else {
      $el.replaceWith(`- ${text}\n`);
    }
  });

  $body.find('ul, ol').each((_, element) => {
    const $el = $(element);
    $el.replaceWith(`\n${$el.html()}\n\n`);
  });

  // Process blockquotes
  $body.find('blockquote').each((_, element) => {
    const $el = $(element);
    const text = $el.text().trim();
    $el.replaceWith(`> ${text.replace(/\n/g, '\n> ')}\n\n`);
  });

  // Process code blocks
  $body.find('pre').each((_, element) => {
    const $el = $(element);
    const text = $el.text().trim();
    $el.replaceWith(`\`\`\`\n${text}\n\`\`\`\n\n`);
  });

  $body.find('code').each((_, element) => {
    const $el = $(element);
    // Only format inline code that's not inside pre blocks
    if (!$el.closest('pre').length) {
      const text = $el.text().trim();
      $el.replaceWith(`\`${text}\``);
    }
  });

  // Process images
  if (keepImages) {
    $body.find('img').each((_, element) => {
      const $img = $(element);
      const src = $img.attr('src');
      const alt = $img.attr('alt') || '';
      
      if (src && !shouldRemoveImage(src, options)) {
        const absoluteUrl = new URL(src, baseUrl).toString();
        $img.replaceWith(`![${alt}](${absoluteUrl})\n\n`);
      } else {
        $img.remove();
      }
    });
  } else {
    $body.find('img').remove();
  }

  // Process links
  if (keepWebpageLinks) {
    $body.find('a[href]').each((_, element) => {
      const $link = $(element);
      const href = $link.attr('href');
      const text = $link.text().trim();
      
      if (href && text) {
        const absoluteUrl = new URL(href, baseUrl).toString();
        $link.replaceWith(`[${text}](${absoluteUrl})`);
      } else if (text) {
        $link.replaceWith(text);
      } else {
        $link.remove();
      }
    });
  } else {
    $body.find('a[href]').each((_, element) => {
      const $link = $(element);
      $link.replaceWith($link.text().trim());
    });
  }

  // Process tables (basic support)
  $body.find('table').each((_, element) => {
    const $table = $(element);
    let markdownTable = '\n';
    
    $table.find('tr').each((rowIndex, row) => {
      const $row = $(row);
      const cells: string[] = [];
      
      $row.find('th, td').each((_, cell) => {
        const $cell = $(cell);
        cells.push($cell.text().trim());
      });
      
      if (cells.length > 0) {
        markdownTable += `| ${cells.join(' | ')} |\n`;
        
        // Add header separator after first row
        if (rowIndex === 0) {
          markdownTable += `|${cells.map(() => '---').join('|')}|\n`;
        }
      }
    });
    
    $table.replaceWith(markdownTable + '\n');
  });

  // Get the final text and clean it up
  let markdown = $body.text();
  
  // Clean up excessive whitespace while preserving structure
  markdown = cleanMarkdown(markdown);
  
  return markdown;
}

function convertToPlainText($: cheerio.CheerioAPI, baseUrl: string, options: ProcessTextOptions): string {
  const { keepImages, keepWebpageLinks } = options;
  
  const $body = $('body').clone();
  
  // Process images
  if (keepImages) {
    $body.find('img').each((_, element) => {
      const $img = $(element);
      const src = $img.attr('src');
      
      if (src && !shouldRemoveImage(src, options)) {
        const absoluteUrl = new URL(src, baseUrl).toString();
        $img.replaceWith(`\nImage: ${absoluteUrl}\n`);
      } else {
        $img.remove();
      }
    });
  } else {
    $body.find('img').remove();
  }

  // Process links
  if (keepWebpageLinks) {
    $body.find('a[href]').each((_, element) => {
      const $link = $(element);
      const href = $link.attr('href');
      const text = $link.text().trim();
      
      if (href && text) {
        const absoluteUrl = new URL(href, baseUrl).toString();
        $link.replaceWith(`${text}: ${absoluteUrl} `);
      }
    });
  } else {
    $body.find('a[href]').each((_, element) => {
      const $link = $(element);
      $link.replaceWith($link.text().trim());
    });
  }

  let text = $body.text();
  text = cleanText(text);
  
  return text;
}

function shouldRemoveImage(src: string, options: ProcessTextOptions): boolean {
  const { removeSvgImage, removeGifImage, removeImageTypes = [] } = options;
  
  const imageTypesToRemove: string[] = [];
  if (removeSvgImage) imageTypesToRemove.push('.svg');
  if (removeGifImage) imageTypesToRemove.push('.gif');
  imageTypesToRemove.push(...removeImageTypes);
  
  return imageTypesToRemove.some(type => src.includes(type));
}

function cleanMarkdown(markdown: string): string {
  return markdown
    // Replace 3+ newlines with 2 newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove excessive spaces
    .replace(/[ ]{2,}/g, ' ')
    // Clean up space around headers
    .replace(/\n\s*(#+)\s*/g, '\n$1 ')
    // Remove trailing whitespace
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}