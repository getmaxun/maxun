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

  private renderFrame(
    screenshot: string | ImageBitmap | HTMLImageElement,
    x: number,
    y: number,
    width?: number,
    height?: number
  ): void {
    // Target context (offscreen if available, otherwise main)
    const targetCtx = this.offscreenCtx || this.ctx;

    // Start timing the render
    const startTime = performance.now();
    const timeSinceLastDraw = startTime - this.lastDrawTime;

    // Adaptive frame skipping for high-frequency updates
    // If we're getting updates faster than 60fps and this isn't the first frame
    if (timeSinceLastDraw < 16 && this.consecutiveFrameCount > 5) {
      this.consecutiveFrameCount++;

      // Skip some frames when we're getting excessive updates
      if (this.consecutiveFrameCount % 2 !== 0) {
        return;
      }
    } else {
      this.consecutiveFrameCount = 0;
    }

    try {
      if (typeof screenshot === 'string') {
        // Check if we have this image in cache
        let img = this.imageCache.get(screenshot);

        if (!img) {
          img = new Image();
          img.src = screenshot;
          this.imageCache.set(screenshot, img);

          // If image isn't loaded yet, draw when it loads
          if (!img.complete) {
            img.onload = () => {
              if (img) {
                this.drawScreenshot(img, x, y, width, height);
              }
            };
            return;
          }
        }

        targetCtx.drawImage(
          img,
          x, y,
          width || img.width,
          height || img.height
        );
      } else {
        // Draw ImageBitmap or HTMLImageElement directly
        targetCtx.drawImage(
          screenshot,
          x, y,
          width || screenshot.width,
          height || screenshot.height
        );
      }

      // If using offscreen canvas, copy to main canvas
      if (this.offscreenCanvas && this.offscreenCtx) {
        if ('transferToImageBitmap' in this.offscreenCanvas) {
          // Use more efficient transfer when available
          const bitmap = this.offscreenCanvas.transferToImageBitmap();
          this.ctx.drawImage(bitmap, 0, 0);
        } else {
          // Fallback to drawImage
          this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        }
      }

      // Update timestamp
      this.lastDrawTime = performance.now();
    } catch (error) {
      console.error('Error rendering frame:', error);
    }
  }

  /**
   * Checks current memory usage and cleans up if necessary
   */
  private checkMemoryUsage(): void {
    if (window.performance && (performance as any).memory) {
      const memory = (performance as any).memory;

      if (memory.usedJSHeapSize > this.memoryThreshold) {
        this.cleanupMemory();
      }
    }
  }

  /**
   * Cleans up resources to reduce memory usage
   */
  private cleanupMemory(): void {
    // Limit image cache size
    if (this.imageCache.size > 20) {
      // Keep only the most recent 10 images
      const keysToDelete = Array.from(this.imageCache.keys()).slice(0, this.imageCache.size - 10);
      keysToDelete.forEach(key => {
        this.imageCache.delete(key);
      });
    }

    // Suggest garbage collection
    if (window.gc) {
      try {
        window.gc();
      } catch (e) {
        // GC not available, ignore
      }
    }
  }

  /**
   * Update canvas dimensions
   */
  public updateCanvasSize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;

    // Re-apply context settings
    this.ctx.imageSmoothingEnabled = false;

    // Update offscreen canvas if available
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;

      if (this.offscreenCtx) {
        this.offscreenCtx.imageSmoothingEnabled = false;
      }
    }
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    // Cancel any pending frame requests
    if (this.lastFrameRequest !== null) {
      cancelAnimationFrame(this.lastFrameRequest);
      this.lastFrameRequest = null;
    }

    // Clear the image cache
    this.imageCache.clear();

    // Clear canvases
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.offscreenCtx && this.offscreenCanvas) {
      this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
    }
  }
}