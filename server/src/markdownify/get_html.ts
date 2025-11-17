import { chromium, Browser, Page, BrowserContext } from 'playwright';

export interface GetPageSourceOptions {
  wait?: number;
  headless?: boolean;
  userAgent?: string;
}

export async function getPageSource(
  url: string,
  options: GetPageSourceOptions = {}
): Promise<string> {
  const {
    wait = 1.5,
    headless = true,
    userAgent = "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 640 XL LTE) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Mobile Safari/537.36 Edge/12.10166"
  } = options;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ 
      headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    context = await browser.newContext({ userAgent });
    page = await context.newPage();
    
    // Convert wait time to milliseconds
    const waitMs = wait * 1000;
    
    // Set default timeout and navigate to URL
    await page.setDefaultTimeout(waitMs);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    // Wait for additional time if specified
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }
    
    const pageSource = await page.content();
    return pageSource;
    
  } catch (error) {
    console.error('Error while getting page source: ', error);
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
  }