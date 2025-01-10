// Frontend Performance Monitoring
export class FrontendPerformanceMonitor {
    private metrics: {
        fps: number[];
        memoryUsage: MemoryInfo[];
        renderTime: number[];
        eventLatency: number[];
    };
    private lastFrameTime: number;
    private frameCount: number;

    constructor() {
        this.metrics = {
            fps: [],
            memoryUsage: [],
            renderTime: [],
            eventLatency: [],
        };
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        
        // Start monitoring
        this.startMonitoring();
    }

    private startMonitoring(): void {
        // Monitor FPS
        const measureFPS = () => {
            const currentTime = performance.now();
            const elapsed = currentTime - this.lastFrameTime;
            this.frameCount++;

            if (elapsed >= 1000) { // Calculate FPS every second
                const fps = Math.round((this.frameCount * 1000) / elapsed);
                this.metrics.fps.push(fps);
                this.frameCount = 0;
                this.lastFrameTime = currentTime;
            }
            requestAnimationFrame(measureFPS);
        };
        requestAnimationFrame(measureFPS);

        // Monitor Memory Usage
        if (window.performance && (performance as any).memory) {
            setInterval(() => {
                const memory = (performance as any).memory;
                this.metrics.memoryUsage.push({
                    usedJSHeapSize: memory.usedJSHeapSize,
                    totalJSHeapSize: memory.totalJSHeapSize,
                    timestamp: Date.now()
                });
            }, 1000);
        }
    }

    // Monitor Canvas Render Time
    public measureRenderTime(renderFunction: () => void): void {
        const startTime = performance.now();
        renderFunction();
        const endTime = performance.now();
        this.metrics.renderTime.push(endTime - startTime);
    }

    // Monitor Event Latency
    public measureEventLatency(event: MouseEvent | KeyboardEvent): void {
        const latency = performance.now() - event.timeStamp;
        this.metrics.eventLatency.push(latency);
    }

    // Get Performance Report
    public getPerformanceReport(): PerformanceReport {
        return {
            averageFPS: this.calculateAverage(this.metrics.fps),
            averageRenderTime: this.calculateAverage(this.metrics.renderTime),
            averageEventLatency: this.calculateAverage(this.metrics.eventLatency),
            memoryTrend: this.getMemoryTrend(),
            lastMemoryUsage: this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1]
        };
    }

    private calculateAverage(array: number[]): number {
        return array.length ? array.reduce((a, b) => a + b) / array.length : 0;
    }

    private getMemoryTrend(): MemoryTrend {
        if (this.metrics.memoryUsage.length < 2) return 'stable';
        const latest = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
        const previous = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 2];
        const change = latest.usedJSHeapSize - previous.usedJSHeapSize;
        if (change > 1000000) return 'increasing'; // 1MB threshold
        if (change < -1000000) return 'decreasing';
        return 'stable';
    }
}

// Backend Performance Monitoring
export class BackendPerformanceMonitor {
    private metrics: {
        screenshotTimes: number[];
        emitTimes: number[];
        memoryUsage: NodeJS.MemoryUsage[];
    };

    constructor() {
        this.metrics = {
            screenshotTimes: [],
            emitTimes: [],
            memoryUsage: []
        };
        this.startMonitoring();
    }

    private startMonitoring(): void {
        // Monitor Memory Usage
        setInterval(() => {
            this.metrics.memoryUsage.push(process.memoryUsage());
        }, 1000);
    }

    public async measureScreenshotPerformance(
        makeScreenshot: () => Promise<void>
    ): Promise<void> {
        const startTime = process.hrtime();
        await makeScreenshot();
        const [seconds, nanoseconds] = process.hrtime(startTime);
        this.metrics.screenshotTimes.push(seconds * 1000 + nanoseconds / 1000000);
    }

    public measureEmitPerformance(emitFunction: () => void): void {
        const startTime = process.hrtime();
        emitFunction();
        const [seconds, nanoseconds] = process.hrtime(startTime);
        this.metrics.emitTimes.push(seconds * 1000 + nanoseconds / 1000000);
    }

    public getPerformanceReport(): BackendPerformanceReport {
        return {
            averageScreenshotTime: this.calculateAverage(this.metrics.screenshotTimes),
            averageEmitTime: this.calculateAverage(this.metrics.emitTimes),
            currentMemoryUsage: this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1],
            memoryTrend: this.getMemoryTrend()
        };
    }

    private calculateAverage(array: number[]): number {
        return array.length ? array.reduce((a, b) => a + b) / array.length : 0;
    }

    private getMemoryTrend(): MemoryTrend {
        if (this.metrics.memoryUsage.length < 2) return 'stable';
        const latest = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
        const previous = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 2];
        const change = latest.heapUsed - previous.heapUsed;
        if (change > 1000000) return 'increasing';
        if (change < -1000000) return 'decreasing';
        return 'stable';
    }
}

interface MemoryInfo {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    timestamp: number;
}

type MemoryTrend = 'increasing' | 'decreasing' | 'stable';

interface PerformanceReport {
    averageFPS: number;
    averageRenderTime: number;
    averageEventLatency: number;
    memoryTrend: MemoryTrend;
    lastMemoryUsage: MemoryInfo;
}

interface BackendPerformanceReport {
    averageScreenshotTime: number;
    averageEmitTime: number;
    currentMemoryUsage: NodeJS.MemoryUsage;
    memoryTrend: MemoryTrend;
}