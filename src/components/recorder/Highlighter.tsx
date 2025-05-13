import React from 'react';
import styled from "styled-components";
import { coordinateMapper } from '../../helpers/coordinateMapper';

interface HighlighterProps {
  unmodifiedRect: DOMRect;
  displayedSelector: string;
  width: number;
  height: number;
  canvasRect: DOMRect;
  isDeselected?: boolean;
};

const HighlighterComponent = ({ 
  unmodifiedRect, 
  displayedSelector = '', 
  width, 
  height, 
  canvasRect,
  isDeselected = false 
}: HighlighterProps) => {
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
          isDeselected={isDeselected}
        />
        {/* {displayedSelector && !isDeselected && (
          <HighlighterLabel 
            top={rect.top - 30} 
            left={rect.left}
          >
            {displayedSelector.length > 30 ? displayedSelector.substring(0, 30) + '...' : displayedSelector}
          </HighlighterLabel>
        )} */}
        {isDeselected && (
          <HighlighterLabel 
            top={rect.top - 30} 
            left={rect.left}
          >
            Click to re-select
          </HighlighterLabel>
        )}
      </div>
    );
  }
}

export const Highlighter = React.memo(HighlighterComponent);

interface HighlighterOutlineProps {
  top: number;
  left: number;
  width: number;
  height: number;
  isDeselected?: boolean;
}

interface HighlighterLabelProps {
  top: number;
  left: number;
}

const HighlighterOutline = styled.div<HighlighterOutlineProps>`
  box-sizing: border-box;
  pointer-events: none !important;
  position: fixed !important;
  background: ${(p) => p.isDeselected ? 'rgba(128, 128, 128, 0.1)' : 'rgba(255, 93, 91, 0.15)'} !important;
  outline: ${(p) => p.isDeselected ? '2px dashed #888888' : '2px solid #ff00c3'} !important;
  z-index: 2147483647 !important;
  top: ${(p) => p.top}px;
  left: ${(p) => p.left}px;
  width: ${(p) => p.width}px;
  height: ${(p) => p.height}px;
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
  top: ${(p) => p.top}px;
  left: ${(p) => p.left}px;
`;