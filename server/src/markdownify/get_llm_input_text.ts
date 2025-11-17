
import * as cheerio from 'cheerio';
import { URL } from 'url';

export interface ProcessTextOptions {
  htmlParser?: boolean;
  keepImages?: boolean;
  removeSvgImage?: boolean;
  removeGifImage?: boolean;
  removeImageTypes?: string[];
  keepWebpageLinks?: boolean;
  removeScriptTag?: boolean;
  removeStyleTag?: boolean;
  removeTags?: string[];
}

export async function getProcessedText(
  pageSource: string,
  baseUrl: string,
  options: ProcessTextOptions = {}
): Promise<string> {
  const {
    keepImages = true,
    removeSvgImage = true,
    removeGifImage = true,
    removeImageTypes = [],
    keepWebpageLinks = true,
    removeScriptTag = true,
    removeStyleTag = true,
    removeTags = []
  } = options;

  try {
    const $ = cheerio.load(pageSource);
    
    // Remove tags
    const tagsToRemove: string[] = [];
    if (removeScriptTag) tagsToRemove.push('script');
    if (removeStyleTag) tagsToRemove.push('style');
    tagsToRemove.push(...removeTags);
    
    const uniqueTags = [...new Set(tagsToRemove)];
    uniqueTags.forEach(tag => {
      $(tag).remove();
    });

    // Process image links
    const imageTypesToRemove: string[] = [];
    if (removeSvgImage) imageTypesToRemove.push('.svg');
    if (removeGifImage) imageTypesToRemove.push('.gif');
    imageTypesToRemove.push(...removeImageTypes);
    
    const uniqueImageTypes = [...new Set(imageTypesToRemove)];
    
    $('img').each((_, element) => {
      try {
        const $img = $(element);
        if (!keepImages) {
          $img.remove();
        } else {
          const imageLink = $img.attr('src');
          let typeReplaced = false;
          
          if (imageLink) {
            if (uniqueImageTypes.length > 0) {
              for (const imageType of uniqueImageTypes) {
                if (!typeReplaced && imageLink.includes(imageType)) {
                  $img.remove();
                  typeReplaced = true;
                  break;
                }
              }
            }
            if (!typeReplaced) {
              const absoluteUrl = new URL(imageLink, baseUrl).toString();
              $img.replaceWith('\n' + absoluteUrl + ' ');
            }
          }
        }
      } catch (error) {
        console.error('Error while processing image link: ', error);
      }
    });

    // Process website links - Preserve the link text AND the URL
    $('a[href]').each((_, element) => {
      try {
        const $link = $(element);
        if (!keepWebpageLinks) {
          // Just remove the link but keep the text
          $link.replaceWith($link.text());
        } else {
          const href = $link.attr('href');
          if (href) {
            const absoluteUrl = new URL(href, baseUrl).toString();
            const linkText = $link.text().trim();
            // Keep both the link text and the URL
            $link.replaceWith(linkText + ' [' + absoluteUrl + '] ');
          }
        }
      } catch (error) {
        console.error('Error while processing webpage link: ', error);
      }
    });

    // Get text content 
    let text: string;
    
    // Use a simpler approach to extract text
    const bodyContent = $('body');
    
    if (bodyContent.length > 0) {
      // Remove script and style tags that might have been missed
      bodyContent.find('script, style, noscript').remove();
      
      // Get text with proper spacing
      text = bodyContent
        .contents()
        .map((_, el) => {
          if (el.type === 'text') {
            return $(el).text();
          }
          if (el.type === 'tag') {
            const $el = $(el);
            const tagName = el.name?.toLowerCase();
            
            // Add appropriate spacing for block elements
            if (['div', 'p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName || '')) {
              return $el.text() + '\n';
            }
            return $el.text() + ' ';
          }
          return '';
        })
        .get()
        .join('');
    } else {
      text = $.text();
    }
    
    // Clean up the text while preserving quotes
    text = cleanText(text);
    
    return text;

  } catch (error) {
    console.error('Error while getting processed text: ', error);
    return '';
  }
}

// Clean up text while preserving quotes and important content
function cleanText(text: string): string {
  if (!text) return '';
  
  return text
    // Replace multiple spaces with single space, but be careful with quotes
    .replace(/[^\S\n]+/g, ' ')
    // Replace multiple newlines with max 2 newlines
    .replace(/\n\s*\n/g, '\n\n')
    // Clean up spaces around quotes but don't remove the quotes
    .replace(/\s+"/g, ' "')
    .replace(/"\s+/g, '" ')
    // Remove leading/trailing whitespace
    .trim();
}