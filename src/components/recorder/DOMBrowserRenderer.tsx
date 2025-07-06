import React, {
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import { useSocketStore } from "../../context/socket";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useTranslation } from "react-i18next";
import { AuthContext } from "../../context/auth";
import { rebuild, createMirror } from "rrweb-snapshot";
import {
  ActionType,
  clientSelectorGenerator,
} from "../../helpers/clientSelectorGenerator";

interface ElementInfo {
  tagName: string;
  hasOnlyText?: boolean;
  isIframeContent?: boolean;
  isShadowRoot?: boolean;
  innerText?: string;
  url?: string;
  imageUrl?: string;
  attributes?: Record<string, string>;
  innerHTML?: string;
  outerHTML?: string;
  isDOMMode?: boolean;
}

interface ProcessedSnapshot {
  snapshot: RRWebSnapshot;
  resources: {
    stylesheets: Array<{
      href: string;
      content: string;
      media?: string;
    }>;
    images: Array<{
      src: string;
      dataUrl: string;
      alt?: string;
    }>;
    fonts: Array<{
      url: string;
      dataUrl: string;
      format?: string;
    }>;
    scripts: Array<{
      src: string;
      content: string;
      type?: string;
    }>;
    media: Array<{
      src: string;
      dataUrl: string;
      type: string;
    }>;
  };
  baseUrl: string;
  viewport: { width: number; height: number };
  timestamp: number;
  processingStats: {
    totalReplacements: number;
    discoveredResources: {
      images: number;
      stylesheets: number;
      scripts: number;
      fonts: number;
      media: number;
    };
    cachedResources: {
      stylesheets: number;
      images: number;
      fonts: number;
      scripts: number;
      media: number;
    };
    totalCacheSize: number;
  };
}

interface RRWebSnapshot {
  type: number;
  childNodes?: RRWebSnapshot[];
  tagName?: string;
  attributes?: Record<string, string>;
  textContent: string;
  id: number;
  [key: string]: any;
}

interface RRWebDOMBrowserRendererProps {
  width: number;
  height: number;
  snapshot: ProcessedSnapshot;
  getList?: boolean;
  getText?: boolean;
  listSelector?: string | null;
  cachedChildSelectors?: string[];
  paginationMode?: boolean;
  paginationType?: string;
  limitMode?: boolean;
  onHighlight?: (data: {
    rect: DOMRect;
    selector: string;
    elementInfo: ElementInfo | null;
    childSelectors?: string[];
    groupInfo?: any;
  }) => void;
  onElementSelect?: (data: {
    rect: DOMRect;
    selector: string;
    elementInfo: ElementInfo | null;
    childSelectors?: string[];
    groupInfo?: any;
  }) => void;
  onShowDatePicker?: (info: {
    coordinates: { x: number; y: number };
    selector: string;
  }) => void;
  onShowDropdown?: (info: {
    coordinates: { x: number; y: number };
    selector: string;
    options: Array<{
      value: string;
      text: string;
      disabled: boolean;
      selected: boolean;
    }>;
  }) => void;
  onShowTimePicker?: (info: {
    coordinates: { x: number; y: number };
    selector: string;
  }) => void;
  onShowDateTimePicker?: (info: {
    coordinates: { x: number; y: number };
    selector: string;
  }) => void;
}

export const DOMBrowserRenderer: React.FC<RRWebDOMBrowserRendererProps> = ({
  width,
  height,
  snapshot,
  getList = false,
  getText = false,
  listSelector = null,
  cachedChildSelectors = [],
  paginationMode = false,
  paginationType = "",
  limitMode = false,
  onHighlight,
  onElementSelect,
  onShowDatePicker,
  onShowDropdown,
  onShowTimePicker,
  onShowDateTimePicker,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [lastMousePosition, setLastMousePosition] = useState({ x: 0, y: 0 });
  const [currentHighlight, setCurrentHighlight] = useState<{
    element: Element;
    rect: DOMRect;
    selector: string;
    elementInfo: ElementInfo;
    childSelectors?: string[];
  } | null>(null);

  const { socket } = useSocketStore();
  const { setLastAction, lastAction } = useGlobalInfoStore();

  const { state } = useContext(AuthContext);
  const { user } = state;

  const MOUSE_MOVE_THROTTLE = 16; // ~60fps
  const lastMouseMoveTime = useRef(0);

  const notifyLastAction = (action: string) => {
    if (lastAction !== action) {
      setLastAction(action);
    }
  };

  const isInCaptureMode = getText || getList;

  useEffect(() => {
    clientSelectorGenerator.setGetList(getList);
    clientSelectorGenerator.setListSelector(listSelector || "");
    clientSelectorGenerator.setPaginationMode(paginationMode);
  }, [getList, listSelector, paginationMode]);

  useEffect(() => {
    if (listSelector) {
      clientSelectorGenerator.setListSelector(listSelector);
      clientSelectorGenerator.setGetList(getList);
      clientSelectorGenerator.setPaginationMode(paginationMode);
    }
  }, [listSelector, getList, paginationMode]);

  /**
   * Handle client-side highlighting for DOM mode using complete backend logic
   */
  const handleDOMHighlighting = useCallback(
    (x: number, y: number, iframeDoc: Document) => {
      try {
        if (!getText && !getList) {
          setCurrentHighlight(null);
          if (onHighlight) {
            onHighlight({
              rect: new DOMRect(0, 0, 0, 0),
              selector: "",
              elementInfo: null,
            });
          }
          return;
        }

        const highlighterData =
          clientSelectorGenerator.generateDataForHighlighter(
            { x, y },
            iframeDoc,
            true,
            cachedChildSelectors
          );

        if (!highlighterData) {
          setCurrentHighlight(null);
          if (onHighlight) {
            onHighlight({
              rect: new DOMRect(0, 0, 0, 0),
              selector: "",
              elementInfo: null,
            });
          }
          return;
        }

        const { rect, selector, elementInfo, childSelectors, groupInfo } =
          highlighterData;

        let shouldHighlight = false;

        if (getList) {
          // First phase: Allow any group to be highlighted for selection
          if (!listSelector && groupInfo?.isGroupElement) {
            shouldHighlight = true;
          }
          // Second phase: Show valid children within selected group
          else if (listSelector) {
            if (limitMode) {
              shouldHighlight = false;
            } else if (
              paginationMode &&
              paginationType !== "" &&
              !["none", "scrollDown", "scrollUp"].includes(paginationType)
            ) {
              shouldHighlight = true;
            } else if (childSelectors && childSelectors.length > 0) {
              console.log("✅ Child selectors present, highlighting enabled");
              shouldHighlight = true;
            } else {
              console.log("❌ No child selectors available");
              shouldHighlight = false;
            }
          }
          // No list selector - show regular highlighting
          else {
            shouldHighlight = true;
          }
        } else {
          // getText mode - always highlight
          shouldHighlight = true;
        }

        if (shouldHighlight) {
          const element = iframeDoc.elementFromPoint(x, y);
          if (element) {
            setCurrentHighlight({
              element,
              rect: rect,
              selector,
              elementInfo: {
                ...elementInfo,
                tagName: elementInfo?.tagName ?? "",
                isDOMMode: true,
              },
              childSelectors,
            });

            if (onHighlight) {
              onHighlight({
                rect: rect,
                elementInfo: {
                  ...elementInfo,
                  tagName: elementInfo?.tagName ?? "",
                  isDOMMode: true,
                },
                selector,
                childSelectors,
                groupInfo, 
              });
            }
          }
        } else {
          setCurrentHighlight(null);
          if (onHighlight) {
            onHighlight({
              rect: new DOMRect(0, 0, 0, 0),
              selector: "",
              elementInfo: null,
            });
          }
        }
      } catch (error) {
        console.error("Error in DOM highlighting:", error);
        setCurrentHighlight(null);
      }
    },
    [
      getText,
      getList,
      listSelector,
      paginationMode,
      cachedChildSelectors,
      paginationType,
      limitMode,
      onHighlight,
    ]
  );

  /**
   * Set up enhanced interaction handlers for DOM mode
   */
  const setupIframeInteractions = useCallback(
    (iframeDoc: Document) => {
      const existingHandlers = (iframeDoc as any)._domRendererHandlers;
      if (existingHandlers) {
        Object.entries(existingHandlers).forEach(([event, handler]) => {
          iframeDoc.removeEventListener(event, handler as EventListener, false); // Changed to false
        });
      }

      const handlers: { [key: string]: EventListener } = {};

      const mouseMoveHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        if (!isInCaptureMode) {
          return;
        }

        const now = performance.now();
        if (now - lastMouseMoveTime.current < MOUSE_MOVE_THROTTLE) {
          return;
        }
        lastMouseMoveTime.current = now;

        const mouseEvent = e as MouseEvent;
        const iframeX = mouseEvent.clientX;
        const iframeY = mouseEvent.clientY;

        const iframe = iframeRef.current;
        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          setLastMousePosition({
            x: iframeX + iframeRect.left,
            y: iframeY + iframeRect.top,
          });
        }

        handleDOMHighlighting(iframeX, iframeY, iframeDoc);
        notifyLastAction("move");
      };

      const mouseDownHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        const mouseEvent = e as MouseEvent;
        const target = mouseEvent.target as Element;
        const iframeX = mouseEvent.clientX;
        const iframeY = mouseEvent.clientY;

        if (isInCaptureMode) {
          e.preventDefault();
          e.stopPropagation();

          if (currentHighlight && onElementSelect) {
            // Get the group info for the current highlight
            const highlighterData =
              clientSelectorGenerator.generateDataForHighlighter(
                { x: iframeX, y: iframeY },
                iframeDoc,
                true,
                cachedChildSelectors
              );

            onElementSelect({
              rect: currentHighlight.rect,
              selector: currentHighlight.selector,
              elementInfo: currentHighlight.elementInfo,
              childSelectors:
                cachedChildSelectors.length > 0
                  ? cachedChildSelectors
                  : highlighterData?.childSelectors || [],
              groupInfo: highlighterData?.groupInfo,
            });
          }
          notifyLastAction("select element");
          return;
        }

        const linkElement = target.closest("a[href]") as HTMLAnchorElement;
        if (linkElement && linkElement.href && socket) {
          e.preventDefault();
          e.stopPropagation();

          const href = linkElement.href;

          if (linkElement.target) {
            linkElement.target = "";
          }

          const originalHref = linkElement.href;
          linkElement.removeAttribute("href");

          setTimeout(() => {
            linkElement.setAttribute("href", originalHref);
          }, 100);

          const isSPALink =
            href.endsWith("#") ||
            (href.includes("#") && new URL(href).hash !== "");

          const selector = clientSelectorGenerator.generateSelector(
            iframeDoc,
            { x: iframeX, y: iframeY },
            ActionType.Click
          );

          const elementInfo = clientSelectorGenerator.getElementInformation(
            iframeDoc,
            { x: iframeX, y: iframeY },
            clientSelectorGenerator.getCurrentState().listSelector,
            clientSelectorGenerator.getCurrentState().getList
          );

          if (selector && socket) {
            socket.emit("dom:click", {
              selector,
              url: snapshot.baseUrl,
              userId: user?.id || "unknown",
              elementInfo,
              coordinates: undefined,
              isSPA: isSPALink,
            });

            notifyLastAction(
              isSPALink ? `SPA navigation to ${href}` : `navigate to ${href}`
            );
          }
          return;
        }

        const selector = clientSelectorGenerator.generateSelector(
          iframeDoc,
          { x: iframeX, y: iframeY },
          ActionType.Click
        );

        const elementInfo = clientSelectorGenerator.getElementInformation(
          iframeDoc,
          { x: iframeX, y: iframeY },
          clientSelectorGenerator.getCurrentState().listSelector,
          clientSelectorGenerator.getCurrentState().getList
        );

        if (selector && elementInfo && socket) {
          if (elementInfo?.tagName === "SELECT" && elementInfo.innerHTML) {
            const inputElement = target as HTMLInputElement;
            inputElement.blur();

            const wasDisabled = inputElement.disabled;
            inputElement.disabled = true;

            setTimeout(() => {
              inputElement.disabled = wasDisabled;
            }, 100);

            const options = elementInfo.innerHTML
              .split("<option")
              .slice(1)
              .map((optionHtml) => {
                const valueMatch = optionHtml.match(/value="([^"]*)"/);
                const textMatch = optionHtml.match(/>([^<]*)</);
                const text = textMatch
                  ? textMatch[1].replace(/\n/g, "").replace(/\s+/g, " ").trim()
                  : "";

                return {
                  value: valueMatch ? valueMatch[1] : "",
                  text,
                  disabled: optionHtml.includes('disabled="disabled"'),
                  selected: optionHtml.includes('selected="selected"'),
                };
              });

            if (onShowDropdown) {
              onShowDropdown({
                coordinates: { x: iframeX, y: iframeY },
                selector,
                options,
              });
            }
            notifyLastAction("dropdown opened");
            return;
          }

          if (elementInfo?.tagName === "INPUT") {
            const inputType = elementInfo.attributes?.type;
            const inputElement = target as HTMLInputElement;
            if (["date", "time", "datetime-local"].includes(inputType || "")) {
              e.preventDefault();
              e.stopPropagation();

              inputElement.blur();

              const wasDisabled = inputElement.disabled;
              inputElement.disabled = true;

              setTimeout(() => {
                inputElement.disabled = wasDisabled;
              }, 100);

              const pickerInfo = {
                coordinates: { x: iframeX, y: iframeY },
                selector,
              };

              switch (inputType) {
                case "date":
                case "month":
                case "week":
                  if (onShowDatePicker) {
                    onShowDatePicker(pickerInfo);
                  }
                  break;
                case "time":
                  if (onShowTimePicker) {
                    onShowTimePicker(pickerInfo);
                  }
                  break;
                case "datetime-local":
                  if (onShowDateTimePicker) {
                    onShowDateTimePicker(pickerInfo);
                  }
                  break;
              }

              notifyLastAction(`${inputType} picker opened`);
              return;
            }
          }

          if (
            elementInfo?.tagName !== "INPUT" &&
            elementInfo?.tagName !== "SELECT"
          ) {
            socket.emit("dom:click", {
              selector,
              url: snapshot.baseUrl,
              userId: user?.id || "unknown",
              elementInfo,
              coordinates: { x: iframeX, y: iframeY },
              isSPA: false,
            });
          }
        }

        notifyLastAction("click");
      };

      const mouseUpHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        if (!isInCaptureMode) {
          notifyLastAction("release");
        }
      };

      const keyDownHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        const keyboardEvent = e as KeyboardEvent;
        const target = keyboardEvent.target as HTMLElement;

        if (!isInCaptureMode && socket && snapshot?.baseUrl) {
          const iframe = iframeRef.current;
          if (iframe) {
            const iframeRect = iframe.getBoundingClientRect();
            const iframeX = lastMousePosition.x - iframeRect.left;
            const iframeY = lastMousePosition.y - iframeRect.top;

            const selector = clientSelectorGenerator.generateSelector(
              iframeDoc,
              { x: iframeX, y: iframeY },
              ActionType.Keydown
            );

            const elementInfo = clientSelectorGenerator.getElementInformation(
              iframeDoc,
              { x: iframeX, y: iframeY },
              clientSelectorGenerator.getCurrentState().listSelector,
              clientSelectorGenerator.getCurrentState().getList
            );

            if (selector) {
              socket.emit("dom:keypress", {
                selector,
                key: keyboardEvent.key,
                url: snapshot.baseUrl,
                userId: user?.id || "unknown",
                inputType: elementInfo?.attributes?.type || "text",
              });
            }
          }

          notifyLastAction(`${keyboardEvent.key} typed`);
        }

        if (
          ["INPUT", "TEXTAREA"].includes(target.tagName) &&
          !isInCaptureMode
        ) {
          return;
        }
      };

      const keyUpHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        const keyboardEvent = e as KeyboardEvent;

        if (!isInCaptureMode && socket) {
          socket.emit("input:keyup", { key: keyboardEvent.key });
        }
      };

      const wheelHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        e.preventDefault();

        if (!isInCaptureMode) {
          const wheelEvent = e as WheelEvent;
          const deltaX = Math.round(wheelEvent.deltaX / 10) * 10;
          const deltaY = Math.round(wheelEvent.deltaY / 10) * 10;

          if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
            if (socket) {
              socket.emit("dom:scroll", {
                deltaX,
                deltaY,
              });
            }
            notifyLastAction("scroll");
          }
        }
      };

      const clickHandler: EventListener = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        if (isInCaptureMode) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      };

      const preventDefaults = (e: Event) => {
        if (e.target && !iframeDoc.contains(e.target as Node)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        return false;
      };

      handlers.mousedown = mouseDownHandler;
      handlers.mouseup = mouseUpHandler;
      handlers.mousemove = mouseMoveHandler;
      handlers.wheel = wheelHandler;
      handlers.keydown = keyDownHandler;
      handlers.keyup = keyUpHandler;
      handlers.click = clickHandler;
      handlers.submit = preventDefaults;
      handlers.beforeunload = preventDefaults;

      Object.entries(handlers).forEach(([event, handler]) => {
        iframeDoc.addEventListener(event, handler, false);
      });

      // Store handlers for cleanup
      (iframeDoc as any)._domRendererHandlers = handlers;

      // Make iframe focusable for keyboard events
      if (iframeRef.current) {
        iframeRef.current.tabIndex = 0;
      }
    },
    [
      socket,
      lastMousePosition,
      notifyLastAction,
      handleDOMHighlighting,
      currentHighlight,
      onElementSelect,
      isInCaptureMode,
      snapshot,
      user?.id,
      onShowDatePicker,
      onShowDropdown,
      onShowTimePicker,
      onShowDateTimePicker,
    ]
  );

  /**
   * Render DOM snapshot using rrweb
   */
  const renderRRWebSnapshot = useCallback(
    (snapshotData: ProcessedSnapshot) => {
      if (!iframeRef.current) {
        console.warn("No iframe reference available");
        return;
      }

      if (isInCaptureMode) {
        return; // Skip rendering in capture mode
      }

      try {
        setRenderError(null);
        setIsRendered(false);

        const iframe = iframeRef.current!;
        const iframeDoc = iframe.contentDocument!;

        const styleTags = Array.from(
          document.querySelectorAll('link[rel="stylesheet"], style')
        )
          .map((tag) => tag.outerHTML)
          .join("\n");

        const enhancedCSS = `
          /* rrweb rebuilt content styles */
          html, body {
            margin: 0 !important;
            padding: 8px !important;
            overflow-x: hidden !important;
          }

          html::-webkit-scrollbar,
          body::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
              background: transparent !important;
          }
          
          /* Hide scrollbars for all elements */
          *::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
              background: transparent !important;
          }
          
          * {
              scrollbar-width: none !important; /* Firefox */
              -ms-overflow-style: none !important; /* Internet Explorer 10+ */
          }
          
          /* Make everything interactive */
          * { 
              cursor: "pointer" !important; 
          }
        `;

        const skeleton = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <base href="${snapshotData.baseUrl}">
              ${styleTags}
              <style>${enhancedCSS}</style>
            </head>
            <body></body>
          </html>
        `;

        if (!iframeDoc) {
          throw new Error("Cannot access iframe document");
        }

        // Write the skeleton into the iframe
        iframeDoc.open();
        iframeDoc.write(skeleton);
        iframeDoc.close();

        const mirror = createMirror();

        try {
          rebuild(snapshotData.snapshot, {
            doc: iframeDoc,
            mirror: mirror,
            cache: { stylesWithHoverClass: new Map() },
            afterAppend: (node) => {
              if (node.nodeType === Node.TEXT_NODE && node.textContent) {
                const text = node.textContent.trim();

                if (
                  text.startsWith("<") &&
                  text.includes(">") &&
                  text.length > 50
                ) {
                  if (node.parentNode) {
                    node.parentNode.removeChild(node);
                  }
                }
              }
            },
          });
        } catch (rebuildError) {
          console.error("rrweb rebuild failed:", rebuildError);
          throw new Error(`rrweb rebuild failed: ${rebuildError}`);
        }

        setIsRendered(true);
        setupIframeInteractions(iframeDoc);
      } catch (error) {
        console.error("Error rendering rrweb snapshot:", error);
        setRenderError(error instanceof Error ? error.message : String(error));
        showErrorInIframe(error);
      }
    },
    [setupIframeInteractions, isInCaptureMode]
  );

  useEffect(() => {
    if (snapshot && iframeRef.current) {
      renderRRWebSnapshot(snapshot);
    }
  }, [snapshot]);

  useEffect(() => {
    if (isRendered && iframeRef.current) {
      const iframeDoc = iframeRef.current.contentDocument;
      if (iframeDoc) {
        setupIframeInteractions(iframeDoc);
      }
    }
  }, [getText, getList, listSelector, isRendered, setupIframeInteractions]);

  /**
   * Show error message in iframe
   */
  const showErrorInIframe = (error: any) => {
    if (!iframeRef.current) return;

    const iframe = iframeRef.current;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;

    if (iframeDoc) {
      try {
        iframeDoc.open();
        iframeDoc.write(`
            <html>
                <head>
                    <style>
                        body { 
                            padding: 20px; 
                            font-family: Arial, sans-serif; 
                            background: #f5f5f5;
                        }
                        .error-container {
                            background: white;
                            border: 1px solid #ff00c3;
                            border-radius: 5px;
                            padding: 20px;
                            margin: 20px 0;
                        }
                        .retry-btn {
                            background: #ff00c3;
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-top: 10px;
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h3 style="color: #ff00c3;">Error Loading DOM Content</h3>
                        <p>Failed to render the page in DOM mode.</p>
                        <p><strong>Common causes:</strong></p>
                        <ul>
                            <li>Page is still loading or navigating</li>
                            <li>Resource proxy timeouts or failures</li>
                            <li>Network connectivity issues</li>
                            <li>Invalid HTML structure</li>
                        </ul>
                        <p><strong>Solutions:</strong></p>
                        <ul>
                            <li>Try switching back to Screenshot mode</li>
                            <li>Wait for the page to fully load and try again</li>
                            <li>Check your network connection</li>
                            <li>Refresh the browser page</li>
                        </ul>
                        <button class="retry-btn" onclick="window.parent.postMessage('retry-dom-mode', '*')">
                            Retry DOM Mode
                        </button>
                        <details style="margin-top: 15px;">
                            <summary style="cursor: pointer; color: #666;">Technical details</summary>
                            <pre style="background: #f0f0f0; padding: 10px; margin-top: 10px; overflow: auto; font-size: 12px;">${error.toString()}</pre>
                        </details>
                    </div>
                </body>
            </html>
        `);
        iframeDoc.close();

        window.addEventListener("message", (event) => {
          if (event.data === "retry-dom-mode") {
            if (socket) {
              socket.emit("enable-dom-streaming");
            }
          }
        });
      } catch (e) {
        console.error("Failed to write error message to iframe:", e);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (iframeRef.current) {
        const iframeDoc = iframeRef.current.contentDocument;
        if (iframeDoc) {
          const handlers = (iframeDoc as any)._domRendererHandlers;
          if (handlers) {
            Object.entries(handlers).forEach(([event, handler]) => {
              iframeDoc.removeEventListener(
                event,
                handler as EventListener,
                true
              );
            });
          }
        }
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: width,
        height: height,
        overflow: "hidden !important",
        position: "relative",
        borderRadius: "0px 0px 5px 5px",
        backgroundColor: "white",
      }}
    >
      <iframe
        ref={iframeRef}
        id="dom-browser-iframe"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          overflow: "hidden !important",
        }}
        sandbox="allow-same-origin allow-forms allow-scripts"
        title="DOM Browser Content"
        tabIndex={0}
      />

      {/* Loading indicator */}
      {!isRendered && !renderError && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(255, 255, 255, 0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            color: "#666",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "3px solid #ff00c3",
              borderTop: "3px solid transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <div>Loading website...</div>
          <style>{`
              @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
              }
          `}</style>
        </div>
      )}

      {/* Error indicator */}
      {renderError && (
        <div
          style={{
            position: "absolute",
            top: 30,
            right: 5,
            background: "rgba(255, 0, 0, 0.9)",
            color: "white",
            padding: "2px 8px",
            borderRadius: "3px",
            fontSize: "10px",
            zIndex: 1000,
            maxWidth: "200px",
          }}
        >
          RENDER ERROR
        </div>
      )}

      {/* Capture mode overlay */}
      {isInCaptureMode && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            cursor: "pointer !important",
            pointerEvents: "none",
            zIndex: 999,
            borderRadius: "0px 0px 5px 5px",
          }}
        />
      )}
    </div>
  );
};
