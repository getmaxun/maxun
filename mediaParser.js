import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import logger from './logger'; // Adjust path if necessary

/**
 * Fetches and extracts all images from a webpage, including responsive ones.
 * This includes regular <img> tags and srcset URLs used for different screen sizes.
 *
 * @param {string} url - The webpage URL to extract images from.
 *                        Must be a valid, non-empty string.
 * @returns {Array} - An array of objects, each containing:
 *                    { 
 *                      url: string,     // The absolute URL of the image
 *                      altText: string  // The alt text of the image (if any)
 *                    }
 * @throws {TypeError} - If the URL is missing or not a string.
 * @throws {Error} - If the fetch fails or the response is not HTML.
 */
async function extractImages(url) {
    // 1. Validate input
    if (!url || typeof url !== 'string') {
        throw new TypeError('URL must be a non-empty string');
    }

    try {
        // 2. Fetch HTML with axios configured for reliability
        const response = await axios.get(url, {
            timeout: 10000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MaxunBot/1.0; +https://maxun.dev)'
            },
            maxRedirects: 5
        });

        // 3. Validate content-type
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            throw new Error(`Expected HTML but got ${contentType}`);
        }

        const html = response.data;

        // 4. Load HTML into cheerio
        const $ = cheerio.load(html, {
            decodeEntities: true,
            normalizeWhitespace: false
        });

        const images = [];
        const seen = new Set();

        // 5. Extract <img> tags
        $('img').each((index, element) => {
            const alt = $(element).attr('alt') || '';

            // 5a. Handle src
            let src = $(element).attr('src');
            if (src) {
                try {
                    const absoluteUrl = new URL(src, url).href;
                    if (!seen.has(absoluteUrl)) {
                        seen.add(absoluteUrl);
                        images.push({ url: absoluteUrl, altText: alt });
                    }
                } catch {
                    logger.warn(`Invalid image URL: ${src}`);
                }
            }

            // 5b. Handle srcset (responsive images)
            const srcset = $(element).attr('srcset');
            if (srcset) {
                const srcsetUrls = srcset.split(',')
                    .map(s => s.trim().split(/\s+/)[0])
                    .filter(Boolean); // Remove empty strings

                for (const srcsetUrl of srcsetUrls) {
                    try {
                        const absoluteUrl = new URL(srcsetUrl, url).href;
                        if (!seen.has(absoluteUrl)) {
                            seen.add(absoluteUrl);
                            images.push({ url: absoluteUrl, altText: alt });
                        }
                    } catch {
                        logger.warn(`Invalid srcset URL: ${srcsetUrl}`);
                    }
                }
            }
        });

        return images;

    } catch (error) {
        // Log errors and throw for the caller
        logger.error('Failed to extract images', { url, error: error.message });
        throw new Error(`Failed to extract images from ${url}: ${error.message}`);
    }
}