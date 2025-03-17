import React, { createContext, useCallback, useContext, useState } from "react";

interface BrowserDimensions {
  width: number;
  height: number;
  setWidth: (newWidth: number) => void;
};

class BrowserDimensionsStore implements Partial<BrowserDimensions> {
  width: number = window.innerWidth * 0.7;
  height: number = window.innerHeight * 0.72;
};

const browserDimensionsStore = new BrowserDimensionsStore();
const browserDimensionsContext = createContext<BrowserDimensions>(browserDimensionsStore as BrowserDimensions);

export const useBrowserDimensionsStore = () => useContext(browserDimensionsContext);

export const BrowserDimensionsProvider = ({ children }: { children: JSX.Element }) => {
  const [width, setWidth] = useState<number>(browserDimensionsStore.width);
  const [height, setHeight] = useState<number>(browserDimensionsStore.height);

  const setNewWidth = useCallback((newWidth: number) => {
    setWidth(newWidth);
    setHeight(Math.round(newWidth / 1.6));
  }, [setWidth, setHeight]);

  return (
    <browserDimensionsContext.Provider
      value={{
        width,
        height,
        setWidth: setNewWidth,
      }}
    >
      {children}
    </browserDimensionsContext.Provider>
  );
};
