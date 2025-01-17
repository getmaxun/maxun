import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { Browser } from 'playwright';
import { EventEmitter } from 'events';
import { 
    WorkerConfig, SharedState, WorkerProgressData, 
    PerformanceMetrics, GlobalMetrics 
} from '../types/worker';

interface WorkerMetrics {
    workerId: number;
    currentUrl: string;
    processedUrls: number;
    totalUrls: number;
    scrapedItems: number;
    failures: number;
    startTime: number;
    performance: PerformanceMetrics;
    status: 'running' | 'completed' | 'failed';
}

export class WorkerPool extends EventEmitter {
    private workers: Worker[] = [];
    private readonly maxWorkers: number;
    private isShuttingDown: boolean = false;
    private browser: Browser | null = null;
    private performanceMetrics: Map<number, WorkerMetrics> = new Map();
    private globalStartTime: number;
    private progressInterval: NodeJS.Timeout | null = null;

    constructor(maxWorkers: number = Math.max(1, Math.min(os.cpus().length - 1, 4))) {
        super();
        this.maxWorkers = maxWorkers;
        this.globalStartTime = Date.now();
    }

    private createWorker(config: WorkerConfig, sharedState: SharedState): Worker {
        const worker = new Worker(path.join(__dirname, 'worker.js'), {
            workerData: { config, sharedState }
        });

        this.initializeWorkerMetrics(config.workerIndex, config.pageUrls.length);

        worker.on('message', (message) => {
            switch (message.type) {
                case 'progress':
                    this.handleWorkerProgress(message.data);
                    break;
                case 'error':
                    this.handleWorkerError(message.data);
                    break;
                case 'complete':
                    this.handleWorkerComplete(config.workerIndex, message.data);
                    break;
            }
        });

        return worker;
    }

    private handleWorkerProgress(data: any): void {
        this.updateWorkerMetrics(data.workerId, {
            currentUrl: data.currentUrl,
            processedUrls: data.processedUrls,
            scrapedItems: data.scrapedItems 
        });
    }

    private handleWorkerError(data: any): void {
        this.updateWorkerMetrics(data.workerId, {
            failures: (this.performanceMetrics.get(data.workerId)?.failures || 0) + 1
        });
        console.error(`Worker ${data.workerId} error:`, data.error);
    }

    private handleWorkerComplete(workerId: number, results: any[]): void {
        this.updateWorkerMetrics(workerId, {
            status: 'completed',
            scrapedItems: results.length,
            performance: {
                ...this.performanceMetrics.get(workerId)?.performance!,
                endTime: Date.now(),
                duration: Date.now() - this.performanceMetrics.get(workerId)?.startTime!,
                itemsScraped: results.length
            }
        });
    }

    private initializeWorkerMetrics(workerId: number, totalUrls: number): void {
        this.performanceMetrics.set(workerId, {
            workerId,
            currentUrl: '',
            processedUrls: 0,
            totalUrls,
            scrapedItems: 0,
            failures: 0,
            startTime: Date.now(),
            performance: {
                startTime: Date.now(),
                endTime: 0,
                duration: 0,
                pagesProcessed: 0,
                itemsScraped: 0,
                failedPages: 0,
                averageTimePerPage: 0,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            },
            status: 'running'
        });
    }

    private updateWorkerMetrics(workerId: number, update: Partial<WorkerMetrics>): void {
        const currentMetrics = this.performanceMetrics.get(workerId);
        if (currentMetrics) {
            this.performanceMetrics.set(workerId, { ...currentMetrics, ...update });
            this.emitProgressUpdate(workerId);
        }
    }

    private emitProgressUpdate(workerId: number): void {
        const metrics = this.performanceMetrics.get(workerId);
        if (metrics) {
            const progress: WorkerProgressData = {
                percentage: (metrics.processedUrls / metrics.totalUrls) * 100,
                currentUrl: metrics.currentUrl,
                scrapedItems: metrics.scrapedItems,
                timeElapsed: Date.now() - metrics.startTime,
                estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(metrics),
                failures: metrics.failures,
                performance: metrics.performance
            };

            this.emit('progress', { workerId, ...progress });
        }
    }

    private calculateEstimatedTimeRemaining(metrics: WorkerMetrics): number {
        const timeElapsed = Date.now() - metrics.startTime;
        const itemsPerMs = metrics.processedUrls / timeElapsed;
        const remainingItems = metrics.totalUrls - metrics.processedUrls;
        return remainingItems / itemsPerMs;
    }

    private startProgressMonitoring(): void {
        this.progressInterval = setInterval(() => {
            this.reportGlobalProgress();
        }, 5000);
    }

    private reportGlobalProgress(): void {
        const globalMetrics: GlobalMetrics = {
            totalPagesProcessed: 0,
            totalItemsScraped: 0,
            totalFailures: 0,
            workersActive: 0,
            averageSpeed: 0,
            timeElapsed: Date.now() - this.globalStartTime,
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
        };

        for (const metrics of this.performanceMetrics.values()) {
            globalMetrics.totalPagesProcessed += metrics.processedUrls;
            globalMetrics.totalItemsScraped += metrics.scrapedItems;
            globalMetrics.totalFailures += metrics.failures;
            if (metrics.status === 'running') globalMetrics.workersActive++;
        }

        globalMetrics.averageSpeed = globalMetrics.timeElapsed > 0 
            ? (globalMetrics.totalItemsScraped / (globalMetrics.timeElapsed / 1000)) 
            : 0;

        this.emit('globalProgress', globalMetrics);
        this.logProgressReport(globalMetrics);
    }

    private logProgressReport(metrics: GlobalMetrics): void {
        console.log('\n=== Scraping Progress Report ===');
        console.log(`Active Workers: ${metrics.workersActive}/${this.maxWorkers}`);
        console.log(`Total Pages Processed: ${metrics.totalPagesProcessed}`);
        console.log(`Total Items Scraped: ${metrics.totalItemsScraped}`);
        console.log(`Scraping Speed: ${metrics.averageSpeed.toFixed(2)} items/second`);
        console.log(`Failed Pages: ${metrics.totalFailures}`);
        console.log(`Memory Usage: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log('=============================\n');
    }

    public async runWorkers(configs: WorkerConfig[]): Promise<any[]> {
        const results: any[] = [];
        const errors: Error[] = [];
        const sharedState: SharedState = {
            totalScraped: 0,
            results: []
        };

        this.globalStartTime = Date.now();
        this.startProgressMonitoring();
        
        try {
            const workerPromises = configs.map(config => 
                new Promise<any[]>(async (resolve, reject) => {
                    if (this.isShuttingDown) {
                        reject(new Error('Worker pool is shutting down'));
                        return;
                    }

                    const worker = this.createWorker(config, sharedState);
                    this.workers.push(worker);

                    let workerResults: any[] = [];

                    worker.on('message', (message) => {
                        if (message.type === 'complete') {
                            workerResults = message.data;
                        }
                    });

                    worker.on('error', (error) => {
                        errors.push(error);
                        this.updateWorkerMetrics(config.workerIndex, { status: 'failed' });
                        reject(error);
                    });

                    worker.on('exit', (code) => {
                        if (code === 0) {
                            resolve(workerResults);
                        } else {
                            reject(new Error(`Worker stopped with exit code ${code}`));
                        }
                    });
                }).catch(error => {
                    console.error('Worker error:', error);
                    return [];
                })
            );

            const workerResults = await Promise.all(workerPromises);
            
            if (errors.length === configs.length) {
                throw new Error(`All workers failed: ${errors.map(e => e.message).join(', ')}`);
            }

            results.push(...workerResults.flat());
            
        } finally {
            this.reportGlobalProgress(); // Final report
            await this.cleanup();
        }

        return results;
    }

    public async cleanup(): Promise<void> {
        this.isShuttingDown = true;
        
        await Promise.all(
            this.workers.map(worker => 
                new Promise<void>((resolve) => {
                    worker.terminate().then(() => resolve());
                })
            )
        );

        this.workers = [];
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }

        this.isShuttingDown = false;
    }

    public getActiveWorkerCount(): number {
        return this.browser ? 1 : 0;
    }

    public isActive(): boolean {
        return this.browser !== null && !this.isShuttingDown;
    }
}