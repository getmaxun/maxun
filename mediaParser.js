import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import logger from './logger'; // Adjust path if necessary

async function extractImages(url) {
    // Input validation
    if (!url || typeof url !== 'string') {
        throw new TypeError('URL must be a non-empty string');
    }

    try {
        // Fetch HTML with proper axios config
        const { data: html } = await axios.get(url, {
            timeout: 10000,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MaxunBot/1.0; +https://maxun.dev)'
            },
            maxRedirects: 5
        });

        // Load HTML
        const $ = cheerio.load(html, {
            decodeEntities: true,
            normalizeWhitespace: false
        });

        const images = [];
        const seen = new Set();

        $('img').each((index, element) => {
            const alt = $(element).attr('alt') || '';
            
            // Handle src
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

            // Handle srcset
            const srcset = $(element).attr('srcset');
            if (srcset) {
                const srcsetUrls = srcset.split(',').map(s => s.trim().split(/\s+/)[0]);
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
        logger.error('Failed to extract images', { url, error: error.message });
        throw new Error(`Failed to extract images from ${url}: ${error.message}`);
    }
}
