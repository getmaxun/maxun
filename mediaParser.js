// mediaParser.js

import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import logger from './logger'; // Adjust path if necessary

/**
 * Fetches and extracts all images from a webpage, including responsive images.
 * This includes regular <img> tags, srcset URLs, and <source> tags within <picture> elements.
 *
 * @param {string} url - The webpage URL to extract images from.
 *                        Must be a valid, non-empty string.
 * @returns {Array} - An array of objects:
 *                    { 
 *                      url: string,     // The absolute URL of the image
 *                      altText: string  // The alt text of the image (if any)
 *                    }
 * @throws {TypeError} - If the URL is missing or not a string.
 * @throws {Error} - If the fetch fails or the response is not HTML.
 */
async function extractImages(url) {
    if (!url || typeof url !== 'string') {
        throw new TypeError('URL must be a non-empty string');
    }

    try {
        // Fetch webpage with axios
        const response = await axios.get(url, {
            timeout: 10000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MaxunBot/1.0; +https://maxun.dev)'
            },
            maxRedirects: 5
        });

        // Validate that content is HTML
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            throw new Error(`Expected HTML but got ${contentType}`);
        }

        const html = response.data;
        const $ = cheerio.load(html, {
            decodeEntities: true,
            normalizeWhitespace: false
        });

        const images = [];
        const seen = new Set();

        // Extract <img> tags
        $('img').each((index, element) => {
            const alt = $(element).attr('alt') || '';
            let src = $(element).attr('src');

            if (src) {
                try {
                    const absoluteUrl = new URL(src, url).href;
                    if (!seen.has(absoluteUrl) && !absoluteUrl.startsWith('data:')) {
                        seen.add(absoluteUrl);
                        images.push({ url: absoluteUrl, altText: alt });
                    }
                } catch {
                    logger.warn(`Invalid image URL: ${src}`);
                }
            }

            // Handle srcset (responsive images)
            const srcset = $(element).attr('srcset');
            if (srcset) {
                const srcsetUrls = srcset.split(',')
                    .map(s => s.trim().split(/\s+/)[0])
                    .filter(Boolean);

                for (const srcsetUrl of srcsetUrls) {
                    try {
                        const absoluteUrl = new URL(srcsetUrl, url).href;
                        if (!seen.has(absoluteUrl) && !absoluteUrl.startsWith('data:')) {
                            seen.add(absoluteUrl);
                            images.push({ url: absoluteUrl, altText: alt });
                        }
                    } catch {
                        logger.warn(`Invalid srcset URL: ${srcsetUrl}`);
                    }
                }
            }
        });

        // Extract <source> tags inside <picture> elements
        $('picture source').each((i, element) => {
            const srcset = $(element).attr('srcset');
            if (srcset) {
                const srcsetUrls = srcset.split(',')
                    .map(s => s.trim().split(/\s+/)[0])
                    .filter(Boolean);

                for (const srcsetUrl of srcsetUrls) {
                    try {
                        const absoluteUrl = new URL(srcsetUrl, url).href;
                        if (!seen.has(absoluteUrl) && !absoluteUrl.startsWith('data:')) {
                            seen.add(absoluteUrl);
                            images.push({ url: absoluteUrl, altText: '' });
                        }
                    } catch {
                        logger.warn(`Invalid srcset URL in <source>: ${srcsetUrl}`);
                    }
                }
            }
        });

        return images;

    } catch (error) {
        // Preserve original stack trace
        throw new Error(`Failed to extract images from ${url}`, { cause: error });
    }
}

// Export function for other modules
export { extractImages };
