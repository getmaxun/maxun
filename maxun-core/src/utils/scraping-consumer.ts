import { Kafka, Consumer, Producer } from 'kafkajs';
import { chromium, Browser, Page } from 'playwright';
import { kafkaConfig } from '../config/kafka';
import path from 'path';

declare global {
    interface Window {
        scrape: (selector: string | null) => Record<string, string>[];
        scrapeSchema: (
        schema: Record<string, { selector: string; tag: string; attribute: string }>
        ) => Record<string, any>;
        scrapeList: (config: { listSelector: string; fields: any; limit?: number; pagination: any }) => Record<string, any>[];
        scrapeListAuto: (listSelector: string) => { selector: string; innerText: string }[];
        scrollDown: (pages?: number) => void;
        scrollUp: (pages?: number) => void;
    }
}

export class ScrapingConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private producer: Producer;

  constructor() {
    this.kafka = new Kafka({
      clientId: `${kafkaConfig.clientId}-consumer`,
      brokers: kafkaConfig.brokers
    });
    
    this.consumer = this.kafka.consumer({ 
      groupId: kafkaConfig.consumerGroup 
    });
    this.producer = this.kafka.producer();
  }

  async start() {
    await this.consumer.connect();
    await this.producer.connect();
    await this.consumer.subscribe({ 
      topic: kafkaConfig.topics.SCRAPING_TASKS,
      fromBeginning: true
    });

    await this.consumer.run({
      partitionsConsumedConcurrently: 3,
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const task = JSON.parse(message.value!.toString());
          const results = await this.processTask(task);
          
          await this.producer.send({
            topic: kafkaConfig.topics.SCRAPING_RESULTS,
            messages: [{
              key: task.taskId,
              value: JSON.stringify({
                taskId: task.taskId,
                data: results
              })
            }]
          });
        } catch (error) {
          await this.handleError(message, error);
        }
      }
    });
  }

  private async ensureScriptsLoaded(page: Page) {
    const isScriptLoaded = await page.evaluate(() => typeof window.scrape === 'function' && typeof window.scrapeSchema === 'function' && typeof window.scrapeList === 'function' && typeof window.scrapeListAuto === 'function' && typeof window.scrollDown === 'function' && typeof window.scrollUp === 'function');
    if (!isScriptLoaded) {
    await page.addInitScript({ path: path.join(__dirname, '..', 'browserSide', 'scraper.js') });
    }
}

  private async processTask(task: any) {
    let browser: Browser | null = null;
    const results: any[] = [];

    try {
      browser = await chromium.launch({
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

      const context = await browser.newContext();
      const page = await context.newPage();

      await this.ensureScriptsLoaded(page);

      for (const url of task.urls) {
        try {
          await page.goto(url, {
            waitUntil: 'networkidle',
            timeout: 30000
          });

          const pageResults = await page.evaluate(
            (cfg) => window.scrapeList(cfg),
            task.config
          );

          results.push(...pageResults);
        } catch (error) {
          console.error(`Error processing URL ${url}:`, error);
        }
      }

      await page.close();
    } finally {
      if (browser) await browser.close();
    }

    return results;
  }

  private async handleError(message: any, error: Error) {
    const retryCount = parseInt(message.headers['retry-count'] || '0');
    
    if (retryCount < 3) {
      await this.producer.send({
        topic: kafkaConfig.topics.SCRAPING_TASKS,
        messages: [{
          key: message.key,
          value: message.value,
          headers: {
            'retry-count': (retryCount + 1).toString(),
            'error': error.message
          }
        }]
      });
    } else {
      await this.producer.send({
        topic: kafkaConfig.topics.SCRAPING_DLQ,
        messages: [{
          key: message.key,
          value: message.value,
          headers: {
            'final-error': error.message
          }
        }]
      });
    }
  }
}