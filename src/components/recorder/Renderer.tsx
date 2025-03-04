export class CanvasRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private offscreenCanvas: OffscreenCanvas | null = null;
    private offscreenCtx: CanvasRenderingContext2D | null = null;
    private lastFrameRequest: number | null = null;
    private imageCache: Map<string, HTMLImageElement> = new Map();
    private consecutiveFrameCount: number = 0;
    private lastDrawTime: number = 0;
    private memoryCheckCounter: number = 0;
    private lastMemoryCheck: number = 0;
    private memoryThreshold: number = 100000000; // 100MB
    
    constructor(canvas: HTMLCanvasElement) {
      this.canvas = canvas;
      
      // Get 2D context with optimized settings
      const ctx = canvas.getContext('2d', {
        alpha: false, // Disable alpha for better performance
        desynchronized: true, // Reduce latency when possible
      });
      
      if (!ctx) {
        throw new Error('Could not get 2D context from canvas');
      }
      
      this.ctx = ctx;
      
      // Apply performance optimizations
      this.ctx.imageSmoothingEnabled = false;
      
      // Set up offscreen canvas if supported
      if (typeof OffscreenCanvas !== 'undefined') {
        this.offscreenCanvas = new OffscreenCanvas(canvas.width, canvas.height);
        const offCtx = this.offscreenCanvas.getContext('2d', {
          alpha: false
        });
        
        if (offCtx) {
          this.offscreenCtx = offCtx as unknown as CanvasRenderingContext2D;
          this.offscreenCtx.imageSmoothingEnabled = false;
        }
      }
      
      // Initial timestamp
      this.lastDrawTime = performance.now();
      this.lastMemoryCheck = performance.now();
    }
    
    /**
     * Renders a screenshot to the canvas, optimized for performance
     */
    public drawScreenshot(
      screenshot: string | ImageBitmap | HTMLImageElement,
      x: number = 0,
      y: number = 0,
      width?: number,
      height?: number
    ): void {
      // Cancel any pending frame request
      if (this.lastFrameRequest !== null) {
        cancelAnimationFrame(this.lastFrameRequest);
      }
      
      // Check memory usage periodically
      this.memoryCheckCounter++;
      const now = performance.now();
      
      if (this.memoryCheckCounter >= 30 || now - this.lastMemoryCheck > 5000) {
        this.checkMemoryUsage();
        this.memoryCheckCounter = 0;
        this.lastMemoryCheck = now;
      }
      
      // Request a new frame
      this.lastFrameRequest = requestAnimationFrame(() => {
        this.renderFrame(screenshot, x, y, width, height);
      });
    }
  }