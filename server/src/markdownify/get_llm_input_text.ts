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
  maxContentLength?: number;
  preserveLineBreaks?: boolean;
  includeMetadata?: boolean;
}

export interface ProcessedResult {
  markdown: string;
  plainText: string;
  metadata: {
    title: string;
    description: string;
    url: string;
    processedAt: string;
    textLength: number;
    markdownLength: number;
    hasContent: boolean;
    language?: string;
    wordCount: number;
    linkCount: number;
    imageCount: number;
  };
}

// Global cheerio instance for helper functions
let $: cheerio.CheerioAPI;

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
    formatAsMarkdown = true,
    maxContentLength = 100000,
    preserveLineBreaks = true,
    includeMetadata = true
  } = options;

  try {
    // Initialize cheerio without problematic options
    $ = cheerio.load(pageSource);
    
    // Remove unwanted tags completely
    const tagsToRemove: string[] = [];
    if (removeScriptTag) tagsToRemove.push('script');
    if (removeStyleTag) tagsToRemove.push('style');
    if (removeScriptTag) tagsToRemove.push('noscript');
    tagsToRemove.push(...removeTags);
    
    const uniqueTags = [...new Set(tagsToRemove)];
    uniqueTags.forEach(tag => {
      $(tag).remove();
    });

    // Remove common unwanted elements
    $('[style*="display:none"], [style*="display: none"], .hidden, [aria-hidden="true"]').remove();
    
    // Extract metadata
    const title = extractTitle();
    const description = extractDescription();
    const language = extractLanguage();

    // Generate both formats
    const markdown = formatAsMarkdown ? 
      convertToMarkdown(baseUrl, options) : 
      '';
    
    const plainText = convertToPlainText(baseUrl, options);

    // Truncate if necessary
    const finalMarkdown = markdown.substring(0, maxContentLength);
    const finalPlainText = plainText.substring(0, maxContentLength);

    // Count elements
    const linkCount = $('a[href]').length;
    const imageCount = $('img').length;
    const wordCount = countWords(finalPlainText);

    const result: ProcessedResult = {
      markdown: finalMarkdown,
      plainText: finalPlainText,
      metadata: {
        title,
        description,
        url: baseUrl,
        processedAt: new Date().toISOString(),
        textLength: finalPlainText.length,
        markdownLength: finalMarkdown.length,
        hasContent: finalPlainText.length > 0,
        language,
        wordCount,
        linkCount,
        imageCount
      }
    };

    return result;

  } catch (error) {
    console.error('Error while getting processed text: ', error);
    return createEmptyResult(baseUrl);
  }
}

function extractTitle(): string {
  return $('title').text()?.trim() || 
         $('meta[property="og:title"]').attr('content')?.trim() ||
         $('h1').first().text()?.trim() || 
         'Untitled';
}

function extractDescription(): string {
  return $('meta[name="description"]').attr('content')?.trim() ||
         $('meta[property="og:description"]').attr('content')?.trim() ||
         '';
}

function extractLanguage(): string {
  return $('html').attr('lang') || 'en';
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

function convertToMarkdown(baseUrl: string, options: ProcessTextOptions): string {
  const { keepImages, keepWebpageLinks, preserveLineBreaks } = options;
  
  // Start with metadata if available
  let markdown = '';
  const title = extractTitle();
  if (title && title !== 'Untitled') {
    markdown += `# ${title}\n\n`;
  }

  const description = extractDescription();
  if (description) {
    markdown += `> ${description}\n\n`;
  }

  // Clone the body to avoid modifying the original
  const $body = $('body').clone();
  
  // Remove unwanted elements from the clone
  $body.find('script, style, noscript, meta, link').remove();
  $body.find('[style*="display:none"], [style*="display: none"], .hidden, [aria-hidden="true"]').remove();

  // Process in order of importance
  const sections: string[] = [];

  // Process main content areas first
  const contentSelectors = [
    'main', 'article', '[role="main"]', '.content', '.main', 
    '#content', '#main', '.post', '.article'
  ];

  let mainContent = '';
  for (const selector of contentSelectors) {
    const $content = $body.find(selector).first();
    if ($content.length > 0) {
      mainContent = processElementToMarkdown($content, baseUrl, options, 0);
      if (mainContent.trim().length > 100) { // Only use if substantial content
        sections.push(mainContent);
        $content.remove(); // Remove from body to avoid duplication
        break;
      }
    }
  }

  // Process headers and structure
  sections.push(processElementToMarkdown($body, baseUrl, options, 0));

  // Combine sections
  markdown += sections.filter(s => s.trim().length > 0).join('\n\n');

  // Final cleanup
  markdown = cleanMarkdown(markdown, preserveLineBreaks);
  
  return markdown;
}

function processElementToMarkdown($element: cheerio.Cheerio<any>, baseUrl: string, options: ProcessTextOptions, depth: number = 0): string {
  if (depth > 10) return ''; // Prevent infinite recursion
  
  const { keepImages, keepWebpageLinks } = options;
  let markdown = '';

  $element.contents().each((index, node) => {
    if (node.type === 'text') {
      const text = $(node).text().trim();
      if (text) {
        markdown += text + ' ';
      }
    } else if (node.type === 'tag') {
      const $node = $(node);
      const tagName = node.name?.toLowerCase() || '';

      switch (tagName) {
        case 'h1':
          markdown += `\n# ${$node.text().trim()}\n\n`;
          break;
        case 'h2':
          markdown += `\n## ${$node.text().trim()}\n\n`;
          break;
        case 'h3':
          markdown += `\n### ${$node.text().trim()}\n\n`;
          break;
        case 'h4':
          markdown += `\n#### ${$node.text().trim()}\n\n`;
          break;
        case 'h5':
          markdown += `\n##### ${$node.text().trim()}\n\n`;
          break;
        case 'h6':
          markdown += `\n###### ${$node.text().trim()}\n\n`;
          break;
        case 'p':
          const paragraphText = processElementToMarkdown($node, baseUrl, options, depth + 1);
          if (paragraphText.trim()) {
            markdown += `\n${paragraphText.trim()}\n\n`;
          }
          break;
        case 'br':
          markdown += '\n';
          break;
        case 'hr':
          markdown += '\n---\n\n';
          break;
        case 'strong':
        case 'b':
          const strongText = processElementToMarkdown($node, baseUrl, options, depth + 1);
          if (strongText.trim()) {
            markdown += `**${strongText.trim()}**`;
          }
          break;
        case 'em':
        case 'i':
          const emText = processElementToMarkdown($node, baseUrl, options, depth + 1);
          if (emText.trim()) {
            markdown += `*${emText.trim()}*`;
          }
          break;
        case 'code':
          if (!$node.closest('pre').length) {
            const codeText = $node.text().trim();
            if (codeText) {
              markdown += `\`${codeText}\``;
            }
          }
          break;
        case 'pre':
          const preText = $node.text().trim();
          if (preText) {
            const codeClass = $node.find('code').attr('class');
            const language = codeClass ? codeClass.replace('language-', '') : '';
            markdown += `\n\`\`\`${language}\n${preText}\n\`\`\`\n\n`;
          }
          break;
        case 'blockquote':
          const quoteText = processElementToMarkdown($node, baseUrl, options, depth + 1);
          if (quoteText.trim()) {
            const lines = quoteText.trim().split('\n');
            markdown += '\n' + lines.map(line => `> ${line}`).join('\n') + '\n\n';
          }
          break;
        case 'ul':
          const listItems: string[] = [];
          $node.find('> li').each((_, li) => {
            const itemText = processElementToMarkdown($(li), baseUrl, options, depth + 1);
            if (itemText.trim()) {
              listItems.push(`- ${itemText.trim()}`);
            }
          });
          if (listItems.length > 0) {
            markdown += '\n' + listItems.join('\n') + '\n\n';
          }
          break;
        case 'ol':
          const olItems: string[] = [];
          $node.find('> li').each((i, li) => {
            const itemText = processElementToMarkdown($(li), baseUrl, options, depth + 1);
            if (itemText.trim()) {
              olItems.push(`${i + 1}. ${itemText.trim()}`);
            }
          });
          if (olItems.length > 0) {
            markdown += '\n' + olItems.join('\n') + '\n\n';
          }
          break;
        case 'a':
          if (keepWebpageLinks) {
            const href = $node.attr('href');
            const linkText = processElementToMarkdown($node, baseUrl, options, depth + 1).trim();
            if (href && linkText) {
              try {
                const absoluteUrl = new URL(href, baseUrl).toString();
                markdown += `[${linkText}](${absoluteUrl})`;
              } catch {
                markdown += linkText;
              }
            } else if (linkText) {
              markdown += linkText;
            }
          } else {
            markdown += processElementToMarkdown($node, baseUrl, options, depth + 1);
          }
          break;
        case 'img':
          if (keepImages) {
            const src = $node.attr('src');
            const alt = $node.attr('alt') || $node.attr('title') || '';
            if (src && !shouldRemoveImage(src, options)) {
              try {
                const absoluteUrl = new URL(src, baseUrl).toString();
                markdown += `![${alt}](${absoluteUrl})`;
              } catch {
                // Ignore invalid URLs
              }
            }
          }
          break;
        case 'table':
          markdown += processTableToMarkdown($node);
          break;
        case 'div':
        case 'section':
        case 'article':
        case 'header':
        case 'footer':
        case 'nav':
        case 'aside':
          // Process block-level elements with their content
          const blockContent = processElementToMarkdown($node, baseUrl, options, depth + 1);
          if (blockContent.trim()) {
            markdown += `\n${blockContent.trim()}\n\n`;
          }
          break;
        default:
          // For other tags, just process their content
          markdown += processElementToMarkdown($node, baseUrl, options, depth + 1);
          break;
      }
    }
  });

  return markdown;
}

function processTableToMarkdown($table: cheerio.Cheerio<any>): string {
  const rows: string[][] = [];
  let maxColumns = 0;

  $table.find('tr').each((_, row) => {
    const $row = $(row);
    const cells: string[] = [];
    
    $row.find('th, td').each((_, cell) => {
      const $cell = $(cell);
      const text = $cell.text().trim();
      const colspan = parseInt($cell.attr('colspan') || '1');
      
      cells.push(text);
      // Add empty cells for colspan
      for (let i = 1; i < colspan; i++) {
        cells.push('');
      }
    });
    
    if (cells.length > 0) {
      rows.push(cells);
      maxColumns = Math.max(maxColumns, cells.length);
    }
  });

  if (rows.length === 0) return '';

  let markdownTable = '\n';
  
  // Header row
  if (rows.length > 0) {
    markdownTable += `| ${rows[0].join(' | ')} |\n`;
    markdownTable += `|${' --- |'.repeat(rows[0].length)}\n`;
    
    // Data rows
    for (let i = 1; i < rows.length; i++) {
      markdownTable += `| ${rows[i].join(' | ')} |\n`;
    }
  }
  
  return markdownTable + '\n';
}

function convertToPlainText(baseUrl: string, options: ProcessTextOptions): string {
  const { keepImages, keepWebpageLinks } = options;
  
  const $body = $('body').clone();
  
  // Remove unwanted elements
  $body.find('script, style, noscript, meta, link').remove();
  $body.find('[style*="display:none"], [style*="display: none"], .hidden, [aria-hidden="true"]').remove();

  // Process images
  if (keepImages) {
    $body.find('img').each((_, element) => {
      const $img = $(element);
      const src = $img.attr('src');
      const alt = $img.attr('alt') || '';
      
      if (src && !shouldRemoveImage(src, options)) {
        try {
          const absoluteUrl = new URL(src, baseUrl).toString();
          $img.replaceWith(`[Image: ${alt || 'image'} - ${absoluteUrl}]`);
        } catch {
          $img.remove();
        }
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
        try {
          const absoluteUrl = new URL(href, baseUrl).toString();
          $link.replaceWith(`${text} (${absoluteUrl})`);
        } catch {
          $link.replaceWith(text);
        }
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
  
  return imageTypesToRemove.some(type => src.toLowerCase().includes(type.toLowerCase()));
}

function cleanMarkdown(markdown: string, preserveLineBreaks: boolean = true): string {
  return markdown
    // Normalize line breaks
    .replace(/\r\n/g, '\n')
    // Remove excessive empty lines (keep max 2)
    .replace(/\n{3,}/g, '\n\n')
    // Clean up spaces around headers
    .replace(/\n\s*(#+)\s*/g, '\n$1 ')
    // Remove spaces at start of lines
    .replace(/^\s+/gm, '')
    // Remove trailing whitespace
    .replace(/[ \t]+$/gm, '')
    // Fix multiple spaces
    .replace(/[ ]{2,}/g, ' ')
    // Ensure proper spacing after paragraphs
    .replace(/([^\n])\n([^\n])/g, '$1\n\n$2')
    .trim();
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
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
      wordCount: 0,
      linkCount: 0,
      imageCount: 0
    }
  };
}