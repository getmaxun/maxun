import React, {
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import { useSocketStore } from "../../context/socket";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { AuthContext } from "../../context/auth";
import { Replayer } from "rrweb"
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

interface RRWebDOMBrowserRendererProps {
  width: number;
  height: number;
  getList?: boolean;
  getText?: boolean;
  listSelector?: string | null;
  cachedChildSelectors?: string[];
  paginationMode?: boolean;
  paginationSelector?: string;
  paginationType?: string;
  limitMode?: boolean;
  isCachingChildSelectors?: boolean;
  onHighlight?: (data: {
    rect: DOMRect;
    selector: string;
    isShadow?: boolean;
    elementInfo: ElementInfo | null;
    childSelectors?: string[];
    groupInfo?: any;
    similarElements?: any;
  }) => void;
  onElementSelect?: (data: {
    rect: DOMRect;
    selector: string;
    isShadow?: boolean;
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
  getList = false,
  getText = false,
  listSelector = null,
  cachedChildSelectors = [],
  paginationMode = false,
  paginationSelector = "",
  paginationType = "",
  limitMode = false,
  isCachingChildSelectors = false,
  onHighlight,
  onElementSelect,
  onShowDatePicker,
  onShowDropdown,
  onShowTimePicker,
  onShowDateTimePicker,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerIframeRef = useRef<HTMLIFrameElement | null>(null);
  const replayerRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isRendered, setIsRendered] = useState(false);
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

  const MOUSE_MOVE_THROTTLE = 16;
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

        const { rect, selector, elementInfo, childSelectors, groupInfo, similarElements, isShadow } =
          highlighterData;

        let shouldHighlight = false;

        if (getList) {
          if (!listSelector && groupInfo?.isGroupElement) {
            shouldHighlight = true;
          }
          else if (listSelector) {
            if (limitMode) {
              shouldHighlight = false;
            } else if (
              paginationMode &&
              paginationSelector &&
              paginationType !== "" &&
              !["none", "scrollDown", "scrollUp"].includes(paginationType)
            ) {
              shouldHighlight = false;
            } else if (
              paginationMode &&
              !paginationSelector &&
              paginationType !== "" &&
              !["none", "scrollDown", "scrollUp"].includes(paginationType)
            ) {
              shouldHighlight = true;
            } else if (childSelectors && childSelectors.length > 0) {
              shouldHighlight = true;
            } else {
              shouldHighlight = false;
            }
          }
          else {
            shouldHighlight = true;
          }
        } else {
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
                isShadow,
                childSelectors,
                groupInfo,
                similarElements,
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
      paginationSelector,
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
          const options: boolean | AddEventListenerOptions = ['wheel', 'touchstart', 'touchmove'].includes(event)
            ? { passive: false }
            : false;
          iframeDoc.removeEventListener(event, handler as EventListener, options);
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

        const iframe = replayerIframeRef.current;
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
              isShadow: highlighterData?.isShadow,
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
          const originalTarget = linkElement.target;

          if (linkElement.target) {
            linkElement.target = "";
          }

          const originalHref = linkElement.href;
          linkElement.removeAttribute("href");

          setTimeout(() => {
            try {
              linkElement.setAttribute("href", originalHref);
              if (originalTarget) {
                linkElement.setAttribute("target", originalTarget);
              }
            } catch (error) {
              console.warn("Could not restore link attributes:", error);
            }
          }, 100);

          const isSPALink = href.startsWith('#');

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

          if (elementInfo?.tagName === "INPUT" || elementInfo?.tagName === "TEXTAREA") {
            const element = target as HTMLElement;
            const elementRect = element.getBoundingClientRect();
            const relativeX = iframeX - elementRect.left;
            const relativeY = iframeY - elementRect.top;

            socket.emit("dom:click", {
              selector,
              userId: user?.id || "unknown",
              elementInfo,
              coordinates: { x: relativeX, y: relativeY },
              isSPA: false,
            });
          } else if (elementInfo?.tagName !== "SELECT") {
            socket.emit("dom:click", {
              selector,
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

        if (!isInCaptureMode && socket) {
          const iframe = replayerIframeRef.current;
          if (iframe) {
            const focusedElement = iframeDoc.activeElement as HTMLElement;
            let coordinates = { x: 0, y: 0 };

            if (focusedElement && focusedElement !== iframeDoc.body) {
              const rect = focusedElement.getBoundingClientRect();
              coordinates = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              };
            } else {
              const iframeRect = iframe.getBoundingClientRect();
              coordinates = {
                x: lastMousePosition.x - iframeRect.left,
                y: lastMousePosition.y - iframeRect.top
              };
            }

            const selector = clientSelectorGenerator.generateSelector(
              iframeDoc,
              coordinates,
              ActionType.Keydown
            );

            const elementInfo = clientSelectorGenerator.getElementInformation(
              iframeDoc,
              coordinates,
              clientSelectorGenerator.getCurrentState().listSelector,
              clientSelectorGenerator.getCurrentState().getList
            );

            if (selector) {
              socket.emit("dom:keypress", {
                selector,
                key: keyboardEvent.key,
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

        if (isCachingChildSelectors) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

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
        const options: boolean | AddEventListenerOptions = ['wheel', 'touchstart', 'touchmove'].includes(event)
          ? { passive: false }
          : false;
        iframeDoc.addEventListener(event, handler, options);
      });

      (iframeDoc as any)._domRendererHandlers = handlers;

      const iframe = replayerIframeRef.current;
      if (iframe) {
        iframe.tabIndex = 0;
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
      user?.id,
      onShowDatePicker,
      onShowDropdown,
      onShowTimePicker,
      onShowDateTimePicker,
      cachedChildSelectors
    ]
  );

  /**
   * Cleanup replayer on unmount
   */
  useEffect(() => {
    return () => {
      if (replayerRef.current) {
        replayerRef.current.pause();
        replayerRef.current = null;
      }
    };
  }, []);

  /**
   * Listen for rrweb events from backend and add to replayer
   */
  useEffect(() => {
    if (!socket) {
      console.warn('No socket available, skipping event listener setup');
      return;
    }

    const handleRRWebEvent = (event: any) => {
      if (!replayerRef.current && event.type === 2) {
        const container = document.getElementById('mirror-container');
        if (!container) {
          console.warn('Container #mirror-container not found');
          return;
        }
        
        const replayer = new Replayer([], {
          root: container,
          liveMode: true,
          mouseTail: false
        });

        replayer.startLive();     
        replayer.addEvent(event);
        
        replayerRef.current = replayer;

        setTimeout(() => {
          const replayerWrapper = container.querySelector('.replayer-wrapper');
          const replayerIframe = replayerWrapper?.querySelector('iframe') as HTMLIFrameElement;

          if (replayerIframe) {
            replayerIframe.style.width = '100%';
            replayerIframe.style.height = '100%';
            replayerIframe.style.border = 'none';
            replayerIframe.style.position = 'absolute';
            replayerIframe.style.top = '0';
            replayerIframe.style.left = '0';
            replayerIframe.style.backgroundColor = '#ffffff';
            replayerIframe.style.display = 'block';
            replayerIframe.style.pointerEvents = 'auto';
            
            replayerIframe.id = 'dom-browser-iframe';

            replayerIframeRef.current = replayerIframe;

            try {
              const iframeDoc = replayerIframe.contentDocument;
              if (iframeDoc) {
                setupIframeInteractions(iframeDoc);
              }
            } catch (err) {
              console.warn('Error accessing iframe:', err);
            }
            
            replayer.on('fullsnapshot-rebuilded', () => {
              const iframe = replayerIframeRef.current;
              if (iframe && iframe.contentDocument) {
                setupIframeInteractions(iframe.contentDocument);
                
                iframe.style.pointerEvents = 'auto';
                const wrapper = container.querySelector('.replayer-wrapper') as HTMLElement;
                if(wrapper) wrapper.style.pointerEvents = 'auto';
                
                setIsRendered(true);
              }
            });
            
          } else {
            console.warn('Could not find iframe in replayer-wrapper');
          }
        }, 150);
      } else if (replayerRef.current) {
        replayerRef.current.addEvent(event);
      }
    };

    socket.on('rrweb-event', handleRRWebEvent);
    socket.emit('request-refresh');

    return () => {
      socket.off('rrweb-event', handleRRWebEvent);
    };
  }, [socket, setupIframeInteractions]);

  useEffect(() => {
    const iframe = replayerIframeRef.current;
    if (iframe && iframe.contentDocument) {
      setupIframeInteractions(iframe.contentDocument);
    }
  }, [setupIframeInteractions]);

  return (
    <div
      id="mirror-container"
      ref={containerRef}
      style={{
        width: width,
        height: height,
        position: "relative",
        backgroundColor: "#ffffff",
        overflow: "hidden",
        isolation: "isolate",
      }}
    >
      {!isRendered && (
        <DOMLoadingIndicator />
      )}
    </div>
  );
};

const DOMLoadingIndicator: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const { socket } = useSocketStore();
  const { state } = useContext(AuthContext);
  const { user } = state;

  useEffect(() => {
    if (!socket) return;

    const handleLoadingProgress = (data: {
      progress: number;
      pendingRequests: number;
      userId: string;
    }) => {
      if (!data.userId || data.userId === user?.id) {
        if (!hasStartedLoading && data.progress > 0) {
          setHasStartedLoading(true);
        }

        if (!hasStartedLoading || data.progress >= progress) {
          setProgress(data.progress);
        }
      }
    };

    socket.on("domLoadingProgress", handleLoadingProgress);

    return () => {
      socket.off("domLoadingProgress", handleLoadingProgress);
    };
  }, [socket, user?.id, hasStartedLoading, progress]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "#f5f5f5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "15px",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          fontSize: "18px",
          fontWeight: "500",
          color: "#333",
        }}
      >
        Loading {progress}%
      </div>

      <div
        style={{
          width: "240px",
          height: "6px",
          background: "#e0e0e0",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "linear-gradient(90deg, #ff00c3, #ff66d9)",
            borderRadius: "3px",
            transition: "width 0.3s ease-out",
          }}
        />
      </div>
    </div>
  );
};
