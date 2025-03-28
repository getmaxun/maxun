import { useEffect, useState } from 'react';

export const WIDTH_BREAKPOINTS = {
  xs: 0,
  sm: 600,
  md: 960,
  lg: 1280,
  xl: 1920
};

export const HEIGHT_BREAKPOINTS = {
  xs: 0,
  sm: 700,
  md: 750,
  lg: 800,
  xl: 850,
  xxl: 900,
  xxxl: 950,
  xxxxl: 1000,
  xxxxxl: 1050,
  xxxxxxl: 1100,
  xxxxxxxl: 1150,
  xxxxxxxxl: 1200,
  xxxxxxxxxl: 1250,
  xxxxxxxxxxl: 1300,
  xxxxxxxxxxxl: 1350,
  xxxxxxxxxxxxl: 1400,
  xxxxxxxxxxxxxl: 1440
};

export interface AppDimensions {
  browserWidth: number;        
  browserHeight: number;       
  panelHeight: number;         
  outputPreviewHeight: number; 
  outputPreviewWidth: number; 
  canvasWidth: number;         
  canvasHeight: number;        
}

export const getResponsiveDimensions = (): AppDimensions => {
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  const browserWidth = windowWidth * 0.735;
  const outputPreviewWidth = windowWidth * 0.743;
  
  const heightBreakpoints = [
    { height: HEIGHT_BREAKPOINTS.xxxxxxxxxxxxxl, fraction: 0.84 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxxxxxxxl, fraction: 0.83 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxxxxxxl, fraction: 0.82 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxxxxxl, fraction: 0.81 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxxxxl, fraction: 0.80 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxxxl, fraction: 0.79 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxxl, fraction: 0.78 },
    { height: HEIGHT_BREAKPOINTS.xxxxxxl, fraction: 0.77 },
    { height: HEIGHT_BREAKPOINTS.xxxxxl, fraction: 0.76 },
    { height: HEIGHT_BREAKPOINTS.xxxxl, fraction: 0.75 },
    { height: HEIGHT_BREAKPOINTS.xxxl, fraction: 0.741 },
    { height: HEIGHT_BREAKPOINTS.xxl, fraction: 0.74 },
    { height: HEIGHT_BREAKPOINTS.xl, fraction: 0.72 },
    { height: HEIGHT_BREAKPOINTS.lg, fraction: 0.70 },
    { height: HEIGHT_BREAKPOINTS.md, fraction: 0.68 },
    { height: HEIGHT_BREAKPOINTS.sm, fraction: 0.67 },
    { height: 0, fraction: 0.67 }
  ];
 
  const heightFraction = heightBreakpoints.find(bp => windowHeight >= bp.height)?.fraction ?? 0.62;
  
  const browserHeight = windowHeight * heightFraction;
  
  return {
    browserWidth,
    browserHeight,
    panelHeight: browserHeight + 137,   
    outputPreviewHeight: windowHeight * 0.7,
    outputPreviewWidth,
    canvasWidth: browserWidth,
    canvasHeight: browserHeight
  };
};

// React hook to get and update dimensions on window resize
export const useDimensions = () => {
  const [dimensions, setDimensions] = useState<AppDimensions>(getResponsiveDimensions());

  useEffect(() => {
    const handleResize = () => {
      setDimensions(getResponsiveDimensions());
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return dimensions;
};