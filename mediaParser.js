const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

async function extractImages(url) {
    try {
        // 1. Fetch HTML
        const { data: html } = await axios.get(url);

        // 2. Load HTML into cheerio
        const $ = cheerio.load(html);

        const images = [];
        const seen = new Set(); // to track duplicates

        // 3. Loop through each <img> tag
        $('img').each((index, element) => {
            let src = $(element).attr('src');
            const alt = $(element).attr('alt') || '';

            if (src) {
                // 4. Convert relative URLs to absolute URLs
                try {
                    src = new URL(src, url).href;
                } catch {
                    // skip invalid URLs
                    return;
                }

                // 5. Skip duplicates
                if (!seen.has(src)) {
                    seen.add(src);
                    images.push({ url: src, altText: alt });
                }
            }
        });

        return images;

    } catch (error) {
        console.log('Oops! Something went wrong while fetching images:', error.message);
        return [];
    }
}