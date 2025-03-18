import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppDimensions, getResponsiveDimensions } from "../helpers/dimensionUtils";

interface BrowserDimensionsContext extends AppDimensions {
  setWidth: (newWidth: number) => void;
  updateDimensions: () => void;
}

const initialDimensions = getResponsiveDimensions();

const browserDimensionsContext = createContext<BrowserDimensionsContext>({
  ...initialDimensions,
  setWidth: () => {},
  updateDimensions: () => {}
});

export const useBrowserDimensionsStore = () => useContext(browserDimensionsContext);

export const BrowserDimensionsProvider = ({ children }: { children: JSX.Element }) => {
  const [dimensions, setDimensions] = useState<AppDimensions>(initialDimensions);

  const updateDimensions = useCallback(() => {
    setDimensions(getResponsiveDimensions());
  }, []);

  const setWidth = useCallback((newWidth: number) => {
    setDimensions((prevDimensions: any) => ({
      ...prevDimensions,
      browserWidth: newWidth,
      canvasWidth: newWidth,
      browserHeight: Math.round(newWidth / 1.6),
      canvasHeight: Math.round(newWidth / 1.6)
    }));
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateDimensions);
    return () => {
      window.removeEventListener('resize', updateDimensions);
    };
  }, [updateDimensions]);

  return (
    <browserDimensionsContext.Provider
      value={{
        ...dimensions,
        setWidth,
        updateDimensions
      }}
    >
      {children}
    </browserDimensionsContext.Provider>
  );
};