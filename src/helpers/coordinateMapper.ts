import { BROWSER_DEFAULT_HEIGHT, BROWSER_DEFAULT_WIDTH } from "../constants/const";

export class CoordinateMapper {
  private canvasWidth: number;
  private canvasHeight: number;
  private browserWidth: number;
  private browserHeight: number;
  
  constructor(
    canvasWidth: number = window.innerWidth * 0.75, 
    canvasHeight: number = window.innerHeight * 0.64,
    browserWidth: number = BROWSER_DEFAULT_WIDTH,
    browserHeight: number = BROWSER_DEFAULT_HEIGHT
  ) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.browserWidth = browserWidth;
    this.browserHeight = browserHeight;
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
    const topLeft = this.mapBrowserToCanvas({ x: rect.left, y: rect.top });
    const bottomRight = this.mapBrowserToCanvas({ x: rect.right, y: rect.bottom });
    
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    
    return new DOMRect(
      topLeft.x,
      topLeft.y,
      width,
      height
    );
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
  }
}

export const coordinateMapper = new CoordinateMapper();