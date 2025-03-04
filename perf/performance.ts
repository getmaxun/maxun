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

// Enhanced Performance Monitor with Memory Management
export class EnhancedPerformanceMonitor extends FrontendPerformanceMonitor {
    private memoryWarningThreshold: number = 100000000; // 100MB
    private memoryAlertCallback?: (usage: MemoryInfo) => void;
    private frameTimeHistory: number[] = [];
    private maxMetricsHistory: number = 100; // Keep only the last 100 readings
    private isThrottled: boolean = false;
    private rafHandle: number | null = null;
    private memoryCheckInterval: NodeJS.Timeout | null = null;

    constructor(options?: {
        memoryWarningThreshold?: number,
        maxMetricsHistory?: number,
        memoryAlertCallback?: (usage: MemoryInfo) => void
    }) {
        super();

        if (options) {
            if (options.memoryWarningThreshold) {
                this.memoryWarningThreshold = options.memoryWarningThreshold;
            }

            if (options.maxMetricsHistory) {
                this.maxMetricsHistory = options.maxMetricsHistory;
            }

            if (options.memoryAlertCallback) {
                this.memoryAlertCallback = options.memoryAlertCallback;
            }
        }

        // Override the parent's monitoring with our enhanced version
        this.startEnhancedMonitoring();
    }

    private startEnhancedMonitoring(): void {
        // Stop any existing monitoring from parent class
        if (this.rafHandle) {
            cancelAnimationFrame(this.rafHandle);
        }

        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }

        // Enhanced FPS monitoring with frame time tracking
        let lastFrameTime = performance.now();
        let frameCount = 0;
        let frameTimes: number[] = [];

        const measureFPS = () => {
            const now = performance.now();
            const frameTime = now - lastFrameTime;
            lastFrameTime = now;

            // Track individual frame times for jank detection
            frameTimes.push(frameTime);
            if (frameTimes.length > 60) { // Keep only last 60 frame times
                frameTimes.shift();
            }

            frameCount++;
            this.frameTimeHistory.push(frameTime);

            // Calculate FPS every second
            if (this.frameTimeHistory.length >= 60) {
                const totalTime = this.frameTimeHistory.reduce((sum, time) => sum + time, 0);
                const fps = Math.round((this.frameTimeHistory.length * 1000) / totalTime);

                // Get metrics from parent class
                const metrics = this.getMetrics();
                metrics.fps.push(fps);

                // Limit metrics history
                if (metrics.fps.length > this.maxMetricsHistory) {
                    metrics.fps.shift();
                }

                // Detect jank (long frames)
                const jankThreshold = 16.7 * 2; // 2x normal frame time at 60fps
                const jankFrames = frameTimes.filter(time => time > jankThreshold);

                if (jankFrames.length > 10) { // If more than 10 out of 60 frames are janky
                    this.detectPerformanceIssue('jank', {
                        jankFrames: jankFrames.length,
                        averageJankTime: jankFrames.reduce((sum, time) => sum + time, 0) / jankFrames.length
                    });
                }

                // Reset for next measurement
                this.frameTimeHistory = [];
                frameTimes = [];
            }

            this.rafHandle = requestAnimationFrame(measureFPS);
        };

        this.rafHandle = requestAnimationFrame(measureFPS);

        // Enhanced memory monitoring
        if (window.performance && (performance as any).memory) {
            this.memoryCheckInterval = setInterval(() => {
                const memory = (performance as any).memory;
                const memoryInfo = {
                    usedJSHeapSize: memory.usedJSHeapSize,
                    totalJSHeapSize: memory.totalJSHeapSize,
                    timestamp: Date.now()
                };

                // Get metrics from parent class
                const metrics = this.getMetrics();
                metrics.memoryUsage.push(memoryInfo);

                // Limit metrics history
                if (metrics.memoryUsage.length > this.maxMetricsHistory) {
                    metrics.memoryUsage.shift();
                }

                // Check for memory warnings
                if (memoryInfo.usedJSHeapSize > this.memoryWarningThreshold) {
                    this.detectPerformanceIssue('memory', memoryInfo);

                    if (this.memoryAlertCallback) {
                        this.memoryAlertCallback(memoryInfo);
                    }
                }

                // Check for memory leaks (steady increase)
                if (metrics.memoryUsage.length >= 10) {
                    const recentMemory = metrics.memoryUsage.slice(-10);
                    let increasingCount = 0;

                    for (let i = 1; i < recentMemory.length; i++) {
                        if (recentMemory[i].usedJSHeapSize > recentMemory[i - 1].usedJSHeapSize) {
                            increasingCount++;
                        }
                    }

                    // If memory increased in 8 out of 9 consecutive readings
                    if (increasingCount >= 8) {
                        this.detectPerformanceIssue('memoryLeak', {
                            startMemory: recentMemory[0].usedJSHeapSize,
                            currentMemory: recentMemory[recentMemory.length - 1].usedJSHeapSize,
                            increaseRate: (recentMemory[recentMemory.length - 1].usedJSHeapSize - recentMemory[0].usedJSHeapSize) /
                                (recentMemory[recentMemory.length - 1].timestamp - recentMemory[0].timestamp) * 1000 // bytes per second
                        });
                    }
                }
            }, 1000);
        }
    }

    // Method to detect various performance issues
    private detectPerformanceIssue(type: 'jank' | 'memory' | 'memoryLeak', data: any): void {
        console.warn(`Performance issue detected: ${type}`, data);

        if (type === 'memory' || type === 'memoryLeak') {
            // Auto-throttle rendering if memory issues detected
            if (!this.isThrottled) {
                this.throttleRendering();
            }

            // Suggest garbage collection
            this.suggestGarbageCollection();
        }
    }

    // Get access to the metrics from parent class
    private getMetrics(): any {
        return (this as any).metrics;
    }

    // Throttle rendering to reduce memory pressure
    private throttleRendering(): void {
        this.isThrottled = true;
        console.info('Throttling rendering due to memory pressure');
        // Application code would implement throttling behavior
    }

    // Un-throttle rendering when memory pressure is reduced
    public unthrottleRendering(): void {
        if (this.isThrottled) {
            this.isThrottled = false;
            console.info('Resuming normal rendering');
        }
    }

    // Suggest garbage collection to the browser
    private suggestGarbageCollection(): void {
        if (window.gc) {
            try {
                window.gc();
            } catch (e) {
                // gc() might not be available without special flags
            }
        }

        // Alternative approach to encourage garbage collection
        const largeArray = new Array(1000000).fill(0);
        largeArray.length = 0;
    }

    // Enhanced performance report with more detailed metrics
    public getEnhancedPerformanceReport(): EnhancedPerformanceReport {
        const baseReport = super.getPerformanceReport();
        const metrics = this.getMetrics();

        // Calculate 95th percentile render time
        const sortedRenderTimes = [...metrics.renderTime].sort((a, b) => a - b);
        const idx95 = Math.floor(sortedRenderTimes.length * 0.95);
        const renderTime95Percentile = sortedRenderTimes[idx95] || 0;

        // Calculate memory growth rate
        let memoryGrowthRate = 0;
        if (metrics.memoryUsage.length >= 2) {
            const first = metrics.memoryUsage[0];
            const last = metrics.memoryUsage[metrics.memoryUsage.length - 1];
            const timeDiffInSeconds = (last.timestamp - first.timestamp) / 1000;
            memoryGrowthRate = timeDiffInSeconds > 0
                ? (last.usedJSHeapSize - first.usedJSHeapSize) / timeDiffInSeconds
                : 0;
        }

        return {
            ...baseReport,
            renderTime95Percentile,
            memoryGrowthRate,
            isThrottled: this.isThrottled,
            heapUsagePercentage: baseReport.lastMemoryUsage
                ? (baseReport.lastMemoryUsage.usedJSHeapSize / baseReport.lastMemoryUsage.totalJSHeapSize) * 100
                : 0
        };
    }

    // Clean up resources when no longer needed
    public dispose(): void {
        if (this.rafHandle) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }

        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
    }
}

// Extended types
interface EnhancedPerformanceReport extends PerformanceReport {
    renderTime95Percentile: number;
    memoryGrowthRate: number; // bytes per second
    isThrottled: boolean;
    heapUsagePercentage: number;
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