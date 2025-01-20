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
  private processedWorkflows: Map<string, Set<string>>;
  private workflowStats: Map<string, {
    startTime: number;
    totalTasks: number;
    processedTasks: number;
    totalItems: number;
  }>;

  constructor() {
    this.kafka = new Kafka({
      clientId: `${kafkaConfig.clientId}-consumer`,
      brokers: kafkaConfig.brokers
    });
    
    this.consumer = this.kafka.consumer({ 
      groupId: kafkaConfig.consumerGroup,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 1000,
    });
    this.producer = this.kafka.producer();
    this.processedWorkflows = new Map();
    this.workflowStats = new Map();
  }

  async start() {
    await this.consumer.connect();
    await this.producer.connect();
    await this.consumer.subscribe({ 
      topic: kafkaConfig.topics.SCRAPING_TASKS,
      fromBeginning: false
    });

    await this.consumer.run({
      partitionsConsumedConcurrently: 4,
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const task = JSON.parse(message.value!.toString());
          const workflowId = task.workflowId;
          
          // Initialize workflow tracking if needed
          if (!this.processedWorkflows.has(workflowId)) {
            this.processedWorkflows.set(workflowId, new Set());
            this.workflowStats.set(workflowId, {
              startTime: Date.now(),
              totalTasks: parseInt(message.headers['total-tasks']?.toString() || '0'),
              processedTasks: 0,
              totalItems: 0
            });
          }

          // Check if this task was already processed within its workflow
          if (this.processedWorkflows.get(workflowId)?.has(task.taskId)) {
            console.log(`Task ${task.taskId} from workflow ${workflowId} already processed`);
            await this.consumer.commitOffsets([{
              topic,
              partition,
              offset: (Number(message.offset) + 1).toString()
            }]);
            return;
          }

          const results = await this.processTask(task);

          const stats = this.workflowStats.get(workflowId);
          if (stats) {
            stats.processedTasks += 1;
            stats.totalItems += results.length;
            
            console.log(
              `Workflow ${workflowId} progress: ` +
              `${stats.processedTasks}/${stats.totalTasks} tasks, ` +
              `${stats.totalItems} items collected`
            );
          }
          
          // Send results with workflow context
          await this.producer.send({
            topic: kafkaConfig.topics.SCRAPING_RESULTS,
            messages: [{
              key: task.taskId,
              value: JSON.stringify({
                taskId: task.taskId,
                workflowId: task.workflowId,
                data: results
              }),
              // Add workflow headers for better tracking
              headers: {
                'workflow-id': task.workflowId,
                'items-count': results.length.toString()
              }
            }]
          });

          // Mark task as processed within its workflow
          this.processedWorkflows.get(workflowId)?.add(task.taskId);

          // Clean up old workflows periodically
          this.cleanupOldWorkflows();

          await this.consumer.commitOffsets([{
            topic,
            partition,
            offset: (Number(message.offset) + 1).toString()
          }]);

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
    let scrapedItems: Set<string> = new Set<string>();
    let allResults: Record<string, any>[] = [];

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

          await page.waitForTimeout(1000);

          const pageResults = await page.evaluate((cfg) => window.scrapeList(cfg), task.config);
          
          // Filter out already scraped items
          const newResults = pageResults.filter(item => {
            const uniqueKey = JSON.stringify(item);
            if (scrapedItems.has(uniqueKey)) return false; // Ignore if already scraped
            scrapedItems.add(uniqueKey); // Mark as scraped
            return true;
          });

          allResults = allResults.concat(newResults);
          console.log(`Results so far (${task.taskId}): ${allResults.length}`);
        } catch (error) {
          console.error(`Error processing URL ${url}:`, error);
        }
      }

      await page.close();
    } finally {
      if (browser) await browser.close();
    }

    return allResults;
  }

  private async cleanupOldWorkflows() {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();

    for (const [workflowId] of this.processedWorkflows) {
      const workflowTimestamp = parseInt(workflowId.split('-')[1]);
      if (now - workflowTimestamp > ONE_HOUR) {
        this.processedWorkflows.delete(workflowId);
      }
    }
  }

  private async handleError(message: any, error: Error) {
    const retryCount = parseInt(message.headers['retry-count'] || '0');
    const task = JSON.parse(message.value!.toString());
    
    if (retryCount < 3) {
      await this.producer.send({
        topic: kafkaConfig.topics.SCRAPING_TASKS,
        messages: [{
          key: message.key,
          value: message.value,
          headers: {
            'workflow-id': task.workflowId,
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
            'workflow-id': task.workflowId,
            'final-error': error.message
          }
        }]
      });
    }
  }
}