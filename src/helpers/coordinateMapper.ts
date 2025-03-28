// coordinateMapper.ts
import { BROWSER_DEFAULT_HEIGHT, BROWSER_DEFAULT_WIDTH } from "../constants/const";
import { getResponsiveDimensions } from "./dimensionUtils";

export class CoordinateMapper {
  private canvasWidth: number;
  private canvasHeight: number;
  private browserWidth: number;
  private browserHeight: number;
  
  private lastBrowserRect: { left: number, top: number, right: number, bottom: number } | null = null;
  private lastCanvasRect: DOMRect | null = null;
  
  constructor() {
    const dimensions = getResponsiveDimensions();
    this.canvasWidth = dimensions.canvasWidth;
    this.canvasHeight = dimensions.canvasHeight;
    this.browserWidth = BROWSER_DEFAULT_WIDTH;
    this.browserHeight = BROWSER_DEFAULT_HEIGHT;
  }
  
  mapCanvasToBrowser(coord: { x: number, y: number }): { x: number, y: number } {
    return {
      x: (coord.x / this.canvasWidth) * this.browserWidth,
      y: (coord.y / this.canvasHeight) * this.browserHeight
    };
  }
  
  mapBrowserToCanvas(coord: { x: number, y: number }): { x: number, y: number } {
    return {
      x: (coord.x / this.browserWidth) * this.canvasWidth,
      y: (coord.y / this.browserHeight) * this.canvasHeight
    };
  }
  
  mapBrowserRectToCanvas(rect: DOMRect): DOMRect {
    if (this.lastBrowserRect && 
        this.lastBrowserRect.left === rect.left &&
        this.lastBrowserRect.top === rect.top &&
        this.lastBrowserRect.right === rect.right &&
        this.lastBrowserRect.bottom === rect.bottom) {
      return this.lastCanvasRect!;
    }
    
    const topLeft = this.mapBrowserToCanvas({ x: rect.left, y: rect.top });
    const bottomRight = this.mapBrowserToCanvas({ x: rect.right, y: rect.bottom });
    
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    
    const result = new DOMRect(
      topLeft.x,
      topLeft.y,
      width,
      height
    );
    
    this.lastBrowserRect = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom
    };
    this.lastCanvasRect = result;
    
    return result;
  }
  
  mapCanvasRectToBrowser(rect: DOMRect): DOMRect {
    const topLeft = this.mapCanvasToBrowser({ x: rect.left, y: rect.top });
    const bottomRight = this.mapCanvasToBrowser({ x: rect.right, y: rect.bottom });
    
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    
    return new DOMRect(
      topLeft.x,
      topLeft.y,
      width,
      height
    );
  }
  
  updateDimensions(canvasWidth?: number, canvasHeight?: number, browserWidth?: number, browserHeight?: number) {
    if (canvasWidth) this.canvasWidth = canvasWidth;
    if (canvasHeight) this.canvasHeight = canvasHeight;
    if (browserWidth) this.browserWidth = browserWidth;
    if (browserHeight) this.browserHeight = browserHeight;
    
    this.lastBrowserRect = null;
    this.lastCanvasRect = null;
  }
}

export const coordinateMapper = new CoordinateMapper();