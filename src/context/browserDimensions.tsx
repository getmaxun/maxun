import React, { createContext, useCallback, useContext, useState } from "react";

interface BrowserDimensions {
  width: number;
  height: number;
  setWidth: (newWidth: number) => void;
  setHeight: (newHeight: number) => void;
  setDimensions: (width: number, height: number) => void;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

class BrowserDimensionsStore implements Partial<BrowserDimensions> {
  width: number = 900;
  height: number = 400;
  minWidth: number = 400;
  minHeight: number = 200;
  maxWidth: number = window.innerWidth - 40; // Leave some margin
  maxHeight: number = window.innerHeight - 100; // Leave space for browser chrome
}

const browserDimensionsStore = new BrowserDimensionsStore();
const browserDimensionsContext = createContext<BrowserDimensions>(browserDimensionsStore as BrowserDimensions);

export const useBrowserDimensionsStore = () => useContext(browserDimensionsContext);

export const BrowserDimensionsProvider = ({ children }: { children: JSX.Element }) => {
  const [width, setWidth] = useState<number>(browserDimensionsStore.width);
  const [height, setHeight] = useState<number>(browserDimensionsStore.height);

  const handleSetWidth = useCallback((newWidth: number) => {
    const clampedWidth = Math.min(
      Math.max(newWidth, browserDimensionsStore.minWidth),
      browserDimensionsStore.maxWidth
    );
    setWidth(clampedWidth);
  }, []);

  const handleSetHeight = useCallback((newHeight: number) => {
    const clampedHeight = Math.min(
      Math.max(newHeight, browserDimensionsStore.minHeight),
      browserDimensionsStore.maxHeight
    );
    setHeight(clampedHeight);
  }, []);

  const handleSetDimensions = useCallback((newWidth: number, newHeight: number) => {
    handleSetWidth(newWidth);
    handleSetHeight(newHeight);
  }, [handleSetWidth, handleSetHeight]);

  return (
    <browserDimensionsContext.Provider
      value={{
        width,
        height,
        setWidth: handleSetWidth,
        setHeight: handleSetHeight,
        setDimensions: handleSetDimensions,
        minWidth: browserDimensionsStore.minWidth,
        minHeight: browserDimensionsStore.minHeight,
        maxWidth: browserDimensionsStore.maxWidth,
        maxHeight: browserDimensionsStore.maxHeight,
      }}
    >
      {children}
    </browserDimensionsContext.Provider>
  );
};
