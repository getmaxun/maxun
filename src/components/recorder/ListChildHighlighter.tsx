import React, { useMemo } from 'react';
import styled from 'styled-components';
import { coordinateMapper } from '../../helpers/coordinateMapper';

interface ChildElement {
  selector: string;
  info: any;
  selected?: boolean;
  fieldId?: string;
}

interface ListChildHighlighterProps {
  childElements: ChildElement[];
  canvasRect: DOMRect;
  onChildElementClick: (element: ChildElement) => void;
  displayedFieldSelectors?: Set<string>;
}

const ListChildHighlighter: React.FC<ListChildHighlighterProps> = ({ 
  childElements, 
  canvasRect,
  onChildElementClick,
  displayedFieldSelectors
}) => {
  const hasChildElements = childElements && childElements.length > 0;

  const activeSelectors = useMemo(() => {
    if (displayedFieldSelectors) {
      return displayedFieldSelectors;
    }
    return new Set(childElements
      .filter(el => el.selected)
      .map(el => el.selector));
  }, [childElements, displayedFieldSelectors]);

  return (
    <div className="list-child-highlighter">
      {hasChildElements && childElements.map((child, index) => {
        if (!child.info || !child.info.rect) return null;

        const isSelected = activeSelectors.has(child.selector);

        const mappedChildRect = coordinateMapper.mapBrowserRectToCanvas(child.info.rect);
        const childStyle = {
          top: mappedChildRect.top + canvasRect.top + window.scrollY,
          left: mappedChildRect.left + canvasRect.left + window.scrollX,
          width: mappedChildRect.width,
          height: mappedChildRect.height
        };

        return (
          <ChildElement 
            key={`child-${index}-${child.selector}`}
            style={childStyle}
            onClick={(e) => {
              e.stopPropagation();
              onChildElementClick(child);
            }}
            selected={isSelected}
            title={isSelected ? "Click to deselect" : "Click to select"}
          />
        );
      })}
    </div>
  );
};

const ChildElement = styled.div<{ selected?: boolean }>`
  position: fixed !important;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 2147483647 !important;

  /* Styling for selected elements */
  background: ${props => props.selected ? 'rgba(255, 0, 195, 0.1)' : 'rgba(128, 128, 128, 0.1)'} !important;
  outline: ${props => props.selected ? '2px solid #ff00c3' : '2px dashed #888888'} !important;

  &:hover {
    outline: 2px solid #ff9900 !important;
    background: rgba(255, 153, 0, 0.1) !important;
  }
`;

export default React.memo(ListChildHighlighter);