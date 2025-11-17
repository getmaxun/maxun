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

    // Process website links
    $('a[href]').each((_, element) => {
      try {
        const $link = $(element);
        if (!keepWebpageLinks) {
          $link.remove();
        } else {
          const href = $link.attr('href');
          if (href) {
            const absoluteUrl = new URL(href, baseUrl).toString();
            $link.replaceWith($link.text() + ': ' + absoluteUrl + ' ');
          }
        }
      } catch (error) {
        console.error('Error while processing webpage link: ', error);
      }
    });

    // Get text content
    let text: string;
    const bodyContent = $('body');
    
    if (bodyContent.length > 0) {
      const bodyHtml = bodyContent.html() || '';
      const minimizedBody = minifyHtml(bodyHtml);
      text = htmlToText(minimizedBody);
    } else {
      text = $.text();
    }
    
    return text;

  } catch (error) {
    console.error('Error while getting processed text: ', error);
    return ''; // Explicitly return empty string on error
  }
}

function minifyHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  
  $('script, style, noscript').remove();
  
  let text = $('body').text() || $.text();
  
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
    
  return text;
}