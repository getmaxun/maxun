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
  md: 800,    
  lg: 900,    
  xl: 1080,   
  xxl: 1440   
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
  
  let heightFraction = 0.64; 
  
  if (windowHeight >= HEIGHT_BREAKPOINTS.xxl) {
    heightFraction = 0.82; 
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.xl) {
    heightFraction = 0.76; 
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.lg) {
    heightFraction = 0.71; 
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.md) {
    heightFraction = 0.64; 
  } else if (windowHeight >= HEIGHT_BREAKPOINTS.sm) {
    heightFraction = 0.62; 
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