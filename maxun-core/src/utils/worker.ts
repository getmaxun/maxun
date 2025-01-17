import { parentPort, workerData } from 'worker_threads';
import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import type { WorkerConfig, SharedState } from '../types/worker';

async function initializeBrowser(): Promise<Browser> {
    return await chromium.launch({
        headless: true,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-site-isolation-trials",
            "--disable-extensions",
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ]
    });
}

async function ensureScriptsLoaded(page: Page) {
    const isScriptLoaded = await page.evaluate(() => 
        typeof window.scrape === 'function' && 
        typeof window.scrapeSchema === 'function' && 
        typeof window.scrapeList === 'function' && 
        typeof window.scrapeListAuto === 'function' && 
        typeof window.scrollDown === 'function' && 
        typeof window.scrollUp === 'function'
    );
    
    if (!isScriptLoaded) {
        await page.addInitScript({ 
            path: path.join(__dirname, '..', 'browserSide', 'scraper.js') 
        });
    }
}

async function scrapeBatch(config: WorkerConfig, sharedState: SharedState) {
    const results: any[] = [];
    const scrapedItems = new Set<string>();
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
        browser = await initializeBrowser();
        const context = await browser.newContext();
        page = await context.newPage();
        await ensureScriptsLoaded(page);

        for (const [pageIndex, pageUrl] of config.pageUrls.entries()) {
            const pageStartTime = Date.now();
            
            try {
                // Report progress to main thread
                parentPort?.postMessage({
                    type: 'progress',
                    data: {
                        workerId: config.workerIndex,
                        currentUrl: pageUrl,
                        processedUrls: pageIndex,
                        totalUrls: config.pageUrls.length,
                        timeElapsed: Date.now() - pageStartTime,
                        scrapedItems: results.length
                    }
                });

                const navigationResult = await page.goto(pageUrl, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });

                if (!navigationResult) continue;

                await page.waitForLoadState('networkidle').catch(() => {});

                const scrapeConfig = {
                    listSelector: config.listSelector,
                    fields: config.fields,
                    pagination: config.pagination,
                    limit: config.endIndex - config.startIndex - results.length
                };

                const pageResults = await page.evaluate(
                    (cfg) => window.scrapeList(cfg), 
                    scrapeConfig
                );

                // Filter out duplicates
                const newResults = pageResults.filter(item => {
                    const uniqueKey = JSON.stringify(item);
                    
                    // Check against local duplicates
                    if (scrapedItems.has(uniqueKey)) return false;

                    // Check against shared state results
                    const isDuplicate = sharedState.results.some(
                        existingItem => JSON.stringify(existingItem) === uniqueKey
                    );

                    if (isDuplicate) return false;
                    scrapedItems.add(uniqueKey);
                    sharedState.results.push(item);
                    sharedState.totalScraped++;
                    return true;
                });

                results.push(...newResults);

                if (results.length >= config.batchSize) break;

                await page.waitForTimeout(1000);

            } catch (error) {
                parentPort?.postMessage({
                    type: 'error',
                    data: {
                        workerId: config.workerIndex,
                        url: pageUrl,
                        error: error.message
                    }
                });
                continue;
            }
        }

        return results;

    } catch (error) {
        throw error;
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// Handle worker initialization
if (parentPort) {
    const config: WorkerConfig = workerData.config;
    const sharedState: SharedState = workerData.sharedState;

    scrapeBatch(config, sharedState)
        .then(results => {
            parentPort?.postMessage({
                type: 'complete',
                data: results
            });
        })
        .catch(error => {
            parentPort?.postMessage({
                type: 'error',
                data: {
                    workerId: config.workerIndex,
                    error: error.message
                }
            });
        });
}