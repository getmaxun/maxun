export interface WorkerConfig {
    workerIndex: number;
    startIndex: number;
    endIndex: number;
    batchSize: number;
    pageUrls: string[];
    listSelector: string;
    fields: any;
    pagination: {
        type: string;
        selector: string;
    };
}

export interface SharedState {
    totalScraped: number;
    results: any[];
}

export interface WorkerProgressData {
    percentage: number;
    currentUrl: string;
    scrapedItems: number;
    timeElapsed: number;
    estimatedTimeRemaining: number;
    failures: number;
    performance: PerformanceMetrics;
}

export interface PerformanceMetrics {
    startTime: number;
    endTime: number;
    duration: number;
    pagesProcessed: number;
    itemsScraped: number;
    failedPages: number;
    averageTimePerPage: number;
    memoryUsage: {
        heapUsed: number;
        heapTotal: number;
        external: number;
        rss: number;
    };
    cpuUsage: {
        user: number;
        system: number;
    };
}

export interface GlobalMetrics {
    totalPagesProcessed: number;
    totalItemsScraped: number;
    totalFailures: number;
    workersActive: number;
    averageSpeed: number;
    timeElapsed: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
}