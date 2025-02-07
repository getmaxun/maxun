import React, { useCallback, useEffect, useRef, useState, PropsWithChildren } from 'react';
import { useBrowserDimensionsStore } from '../../context/browserDimensions';
import { useSocketStore } from '../../context/socket';
import { throttle } from 'lodash';

const ResizableBrowser: React.FC<PropsWithChildren> = ({ children }) => {
  const { 
    width, 
    height, 
    setWidth, 
    setHeight,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight 
  } = useBrowserDimensionsStore();
  
  const { socket } = useSocketStore();
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [resizeType, setResizeType] = useState<'right' | 'bottom' | 'corner' | null>(null);
  const [showResizeHandles, setShowResizeHandles] = useState(false);
  
  const browserRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startDimensionsRef = useRef({ width: 0, height: 0 });

  const updateBackendDimensions = useCallback(
    throttle((newWidth: number, newHeight: number) => {
      socket?.emit('setViewportSize', { width: newWidth, height: newHeight });
    }, 100),
    [socket]
  );

  const handleResizeStart = useCallback((e: React.MouseEvent, type: 'right' | 'bottom' | 'corner') => {
    e.preventDefault();
    setIsResizing(true);
    setResizeType(type);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startDimensionsRef.current = { width, height };
    document.body.style.userSelect = 'none'; // Prevent text selection while resizing
  }, [width, height]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = e.clientX - startPosRef.current.x;
    const deltaY = e.clientY - startPosRef.current.y;
    
    let newWidth = width;
    let newHeight = height;

    switch (resizeType) {
      case 'right':
        newWidth = Math.min(Math.max(startDimensionsRef.current.width + deltaX, minWidth), maxWidth);
        setWidth(newWidth);
        break;
      case 'bottom':
        newHeight = Math.min(Math.max(startDimensionsRef.current.height + deltaY, minHeight), maxHeight);
        setHeight(newHeight);
        break;
      case 'corner':
        newWidth = Math.min(Math.max(startDimensionsRef.current.width + deltaX, minWidth), maxWidth);
        newHeight = Math.min(Math.max(startDimensionsRef.current.height + deltaY, minHeight), maxHeight);
        setWidth(newWidth);
        setHeight(newHeight);
        break;
    }

    updateBackendDimensions(newWidth, newHeight);
  }, [isResizing, resizeType, setWidth, setHeight, minWidth, minHeight, maxWidth, maxHeight, width, height, updateBackendDimensions]);

  const handleResizeEnd = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      setResizeType(null);
      document.body.style.userSelect = ''; // Re-enable text selection
      socket?.emit('setViewportSize', { width, height });
    }
  }, [isResizing, socket, width, height]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  return (
    <div 
      ref={browserRef}
      className="relative bg-white rounded-lg shadow-lg"
      style={{ 
        width: `${width}px`,
        height: `${height + 80}px`, // Add space for browser chrome
        transition: isResizing ? 'none' : 'all 0.3s ease',
      }}
      onMouseEnter={() => setShowResizeHandles(true)}
      onMouseLeave={() => !isResizing && setShowResizeHandles(false)}
    >
      {children}
      
      {/* Right resize handle */}
      <div
        className={`absolute top-0 right-0 w-2 h-full cursor-ew-resize group
          ${showResizeHandles || isResizing ? 'bg-pink-200 hover:bg-pink-300' : ''}`}
        onMouseDown={(e) => handleResizeStart(e, 'right')}
      >
        <div className={`absolute right-0 top-1/2 -translate-y-1/2 
          ${showResizeHandles || isResizing ? 'visible' : 'invisible'}
          bg-pink-400 rounded-full p-1 transform translate-x-1/2`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
            <path d="M8 18h8v-2H8v2zm0-4h8v-2H8v2zm0-4h8V8H8v2z"/>
          </svg>
        </div>
      </div>

      {/* Bottom resize handle */}
      <div
        className={`absolute bottom-0 left-0 w-full h-2 cursor-ns-resize
          ${showResizeHandles || isResizing ? 'bg-pink-200 hover:bg-pink-300' : ''}`}
        onMouseDown={(e) => handleResizeStart(e, 'bottom')}
      >
        <div className={`absolute bottom-0 left-1/2 -translate-x-1/2
          ${showResizeHandles || isResizing ? 'visible' : 'invisible'}
          bg-pink-400 rounded-full p-1 transform translate-y-1/2`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
            <path d="M7 10l5 5 5-5H7z"/>
          </svg>
        </div>
      </div>

      {/* Corner resize handle */}
      <div
        className={`absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize
          ${showResizeHandles || isResizing ? 'bg-pink-400 rounded-bl' : ''}`}
        onMouseDown={(e) => handleResizeStart(e, 'corner')}
      >
        <svg
          className={`absolute bottom-1 right-1 ${showResizeHandles || isResizing ? 'visible' : 'invisible'}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="white"
        >
          <path d="M19 19H15V15H19V19ZM19 13H15V9H19V13ZM13 19H9V15H13V19Z"/>
        </svg>
      </div>
      
      {/* Size indicator */}
      {(isResizing || showResizeHandles) && (
        <div className="absolute bottom-4 right-4 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm">
          {width} × {height}
        </div>
      )}
    </div>
  );
};

export default ResizableBrowser;