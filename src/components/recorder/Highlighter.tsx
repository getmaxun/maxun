import React from 'react';
import styled from "styled-components";
import { coordinateMapper } from '../../helpers/coordinateMapper';

interface HighlighterProps {
  unmodifiedRect: DOMRect;
  displayedSelector: string;
  width: number;
  height: number;
  canvasRect: DOMRect;
};

const HighlighterComponent = ({ unmodifiedRect, displayedSelector = '', width, height, canvasRect }: HighlighterProps) => {
  if (!unmodifiedRect) {
    return null;
  } else {
    const mappedRect = coordinateMapper.mapBrowserRectToCanvas(unmodifiedRect);

    const rect = {
      top: mappedRect.top + canvasRect.top + window.scrollY,
      left: mappedRect.left + canvasRect.left + window.scrollX,
      right: mappedRect.right + canvasRect.left,
      bottom: mappedRect.bottom + canvasRect.top,
      width: mappedRect.width,
      height: mappedRect.height,
    };


    return (
      <div>
        <HighlighterOutline
          id="Highlighter-outline"
          top={rect.top}
          left={rect.left}
          width={rect.width}
          height={rect.height}
        />
        {/* <HighlighterLabel
          id="Highlighter-label"
          top={rect.top + rect.height + 8}
          left={rect.left}
        >
          {displayedSelector}
        </HighlighterLabel> */}
      </div>
    );
  }
}

export const Highlighter = React.memo(HighlighterComponent);

const HighlighterOutline = styled.div<HighlighterOutlineProps>`
  box-sizing: border-box;
  pointer-events: none !important;
  position: fixed !important;
  background: #ff5d5b26 !important;
  outline: 2px solid #ff00c3 !important;
  z-index: 2147483647 !important;
  top: ${(p: HighlighterOutlineProps) => p.top}px;
  left: ${(p: HighlighterOutlineProps) => p.left}px;
  width: ${(p: HighlighterOutlineProps) => p.width}px;
  height: ${(p: HighlighterOutlineProps) => p.height}px;
`;

const HighlighterLabel = styled.div<HighlighterLabelProps>`
  pointer-events: none !important;
  position: fixed !important;
  background: #080a0b !important;
  color: white !important;
  padding: 8px !important;
  font-family: monospace !important;
  border-radius: 5px !important;
  z-index: 2147483647 !important;
  top: ${(p: HighlighterLabelProps) => p.top}px;
  left: ${(p: HighlighterLabelProps) => p.left}px;
`;

interface HighlighterLabelProps {
  top: number;
  left: number;
}

interface HighlighterOutlineProps {
  top: number;
  left: number;
  width: number;
  height: number;
}
