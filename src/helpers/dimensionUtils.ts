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
  
  const browserWidth = windowWidth * 0.7;
  const outputPreviewWidth = windowWidth * 0.716;
  
  let heightFraction = 0.62; 
  
  if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxxxxxxxl) { 
    heightFraction = 0.82;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxxxxxxl) { 
    heightFraction = 0.81;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxxxxxl) { 
    heightFraction = 0.80;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxxxxl) { 
    heightFraction = 0.79;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxxxl) { 
    heightFraction = 0.78;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxxl) { 
    heightFraction = 0.77;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxxl) { 
    heightFraction = 0.76;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxxl) { 
    heightFraction = 0.75;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxxl) { 
    heightFraction = 0.74;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxxl) { 
    heightFraction = 0.73;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxxl) { 
    heightFraction = 0.72;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xxl) { 
    heightFraction = 0.71;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xl) { 
    heightFraction = 0.70;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.lg) { 
    heightFraction = 0.68;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.md) { 
    heightFraction = 0.66;
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.sm) { 
    heightFraction = 0.63;
  }
  
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