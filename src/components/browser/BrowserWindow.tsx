import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Button } from '@mui/material';
import Canvas from "../recorder/Canvas";
import { Highlighter } from "../recorder/Highlighter";
import { GenericModal } from '../ui/GenericModal';
import { useActionContext } from '../../context/browserActions';
import { useBrowserSteps, TextStep } from '../../context/browserSteps';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../context/auth';
import { coordinateMapper } from '../../helpers/coordinateMapper';
import { useBrowserDimensionsStore } from '../../context/browserDimensions';
import { clientSelectorGenerator } from "../../helpers/clientSelectorGenerator";
import DatePicker from "../pickers/DatePicker";
import Dropdown from "../pickers/Dropdown";
import TimePicker from "../pickers/TimePicker";
import DateTimeLocalPicker from "../pickers/DateTimeLocalPicker";
import { DOMBrowserRenderer } from '../recorder/DOMBrowserRenderer';

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

interface AttributeOption {
    label: string;
    value: string;
}

interface ScreencastData {
    image: string;
    userId: string;
    viewport?: ViewportInfo | null;
}

interface ViewportInfo {
    width: number;
    height: number;
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

interface RRWebDOMCastData {
  snapshotData: ProcessedSnapshot;
  userId: string;
  timestamp: number;
}

const getAttributeOptions = (tagName: string, elementInfo: ElementInfo | null): AttributeOption[] => {
    if (!elementInfo) return [];
    switch (tagName.toLowerCase()) {
        case 'a':
            const anchorOptions: AttributeOption[] = [];
            if (elementInfo.innerText) {
                anchorOptions.push({ label: `Text: ${elementInfo.innerText}`, value: 'innerText' });
            }
            if (elementInfo.url) {
                anchorOptions.push({ label: `URL: ${elementInfo.url}`, value: 'href' });
            }
            return anchorOptions;
        case 'img':
            const imgOptions: AttributeOption[] = [];
            if (elementInfo.innerText) {
                imgOptions.push({ label: `Alt Text: ${elementInfo.innerText}`, value: 'alt' });
            }
            if (elementInfo.imageUrl) {
                imgOptions.push({ label: `Image URL: ${elementInfo.imageUrl}`, value: 'src' });
            }
            return imgOptions;
        default:
            return [{ label: `Text: ${elementInfo.innerText}`, value: 'innerText' }];
    }
};

export const BrowserWindow = () => {
    const { t } = useTranslation();
    const { browserWidth, browserHeight } = useBrowserDimensionsStore();
    const [canvasRef, setCanvasReference] = useState<React.RefObject<HTMLCanvasElement> | undefined>(undefined);
    const [screenShot, setScreenShot] = useState<string>("");
    const [highlighterData, setHighlighterData] = useState<{ rect: DOMRect, selector: string, elementInfo: ElementInfo | null, childSelectors?: string[] } | null>(null);
    const [showAttributeModal, setShowAttributeModal] = useState(false);
    const [attributeOptions, setAttributeOptions] = useState<AttributeOption[]>([]);
    const [selectedElement, setSelectedElement] = useState<{ selector: string, info: ElementInfo | null } | null>(null);
    const [currentListId, setCurrentListId] = useState<number | null>(null);
    const [viewportInfo, setViewportInfo] = useState<ViewportInfo>({ width: browserWidth, height: browserHeight });
    const [isDOMMode, setIsDOMMode] = useState(false);
    const [currentSnapshot, setCurrentSnapshot] = useState<ProcessedSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const [listSelector, setListSelector] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, TextStep>>({});
    const [paginationSelector, setPaginationSelector] = useState<string>('');

    const highlighterUpdateRef = useRef<number>(0);

    const { socket } = useSocketStore();
    const { notify, currentTextActionId, currentListActionId } = useGlobalInfoStore();
    const { getText, getList, paginationMode, paginationType, limitMode, captureStage } = useActionContext();
    const { addTextStep, addListStep, updateListStepData } = useBrowserSteps();
  
    const { state } = useContext(AuthContext);
    const { user } = state;

    const [datePickerInfo, setDatePickerInfo] = useState<{
        coordinates: { x: number; y: number };
        selector: string;
    } | null>(null);

    const [dropdownInfo, setDropdownInfo] = useState<{
        coordinates: { x: number; y: number };
        selector: string;
        options: Array<{
            value: string;
            text: string;
            disabled: boolean;
            selected: boolean;
        }>;
    } | null>(null);

    const [timePickerInfo, setTimePickerInfo] = useState<{
        coordinates: { x: number; y: number };
        selector: string;
    } | null>(null);

    const [dateTimeLocalInfo, setDateTimeLocalInfo] = useState<{
        coordinates: { x: number; y: number };
        selector: string;
    } | null>(null);

    const dimensions = {
        width: browserWidth,
        height: browserHeight
    };

    const handleShowDatePicker = useCallback(
        (info: { coordinates: { x: number; y: number }; selector: string }) => {
            setDatePickerInfo(info);
        },
        []
    );

    const handleShowDropdown = useCallback(
        (info: {
            coordinates: { x: number; y: number };
            selector: string;
            options: Array<{
                value: string;
                text: string;
                disabled: boolean;
                selected: boolean;
            }>;
        }) => {
            setDropdownInfo(info);
        },
        []
    );

    const handleShowTimePicker = useCallback(
        (info: { coordinates: { x: number; y: number }; selector: string }) => {
            setTimePickerInfo(info);
        },
        []
    );

    const handleShowDateTimePicker = useCallback(
        (info: { coordinates: { x: number; y: number }; selector: string }) => {
            setDateTimeLocalInfo(info);
        },
        []
    );

    const rrwebSnapshotHandler = useCallback(
        (data: RRWebDOMCastData) => {
        if (!data.userId || data.userId === user?.id) {
            if (data.snapshotData && data.snapshotData.snapshot) {
                setCurrentSnapshot(data.snapshotData);
                setIsDOMMode(true);
                socket?.emit("dom-mode-enabled");

                setIsLoading(false);
            } else {
                setIsLoading(false);
            }
        }
        },
        [user?.id, socket]
    );

    const domModeHandler = useCallback(
        (data: any) => {
            if (!data.userId || data.userId === user?.id) {
                setIsDOMMode(true);
                socket?.emit("dom-mode-enabled");
                setIsLoading(false);
            }
        },
        [user?.id, socket]
    );

    const screenshotModeHandler = useCallback(
        (data: any) => {
            if (!data.userId || data.userId === user?.id) {
                setIsDOMMode(false);
                socket?.emit("screenshot-mode-enabled");
                setCurrentSnapshot(null);
                setIsLoading(false);
            }
        },
        [user?.id]
    );

    const domModeErrorHandler = useCallback(
        (data: any) => {
            if (!data.userId || data.userId === user?.id) {
                setIsDOMMode(false);
                setCurrentSnapshot(null);
                setIsLoading(false);
            }
        },
        [user?.id]
    );

    useEffect(() => {
        if (isDOMMode) {
        clientSelectorGenerator.setGetList(getList);
        clientSelectorGenerator.setListSelector(listSelector || "");
        clientSelectorGenerator.setPaginationMode(paginationMode);
        }
    }, [isDOMMode, getList, listSelector, paginationMode]);

    useEffect(() => {
        if (isDOMMode && listSelector) {
            socket?.emit("setGetList", { getList: true });
            socket?.emit("listSelector", { selector: listSelector });

            clientSelectorGenerator.setListSelector(listSelector);
        }
    }, [isDOMMode, listSelector, socket, getList]);

    useEffect(() => {
        coordinateMapper.updateDimensions(dimensions.width, dimensions.height, viewportInfo.width, viewportInfo.height);
    }, [viewportInfo, dimensions.width, dimensions.height]);

    useEffect(() => {
        if (listSelector) {
          sessionStorage.setItem('recordingListSelector', listSelector);
        }
    }, [listSelector]);

    useEffect(() => {
        const storedListSelector = sessionStorage.getItem('recordingListSelector');
        
        // Only restore state if it exists in sessionStorage
        if (storedListSelector && !listSelector) {
          setListSelector(storedListSelector);
        }
    }, []); 

    const onMouseMove = (e: MouseEvent) => {
        if (canvasRef && canvasRef.current && highlighterData) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            // mousemove outside the browser window
            if (
                e.pageX < canvasRect.left
                || e.pageX > canvasRect.right
                || e.pageY < canvasRect.top
                || e.pageY > canvasRect.bottom
            ) {
                setHighlighterData(null);
            }
        }
    };

    const resetListState = useCallback(() => {
        setListSelector(null);
        setFields({});
        setCurrentListId(null);
    }, []);

    useEffect(() => {
        if (!getList) {
            resetListState();
        }
    }, [getList, resetListState]);

    const screencastHandler = useCallback((data: string | ScreencastData) => {
        if (typeof data === 'string') {
            setScreenShot(data);
        } else if (data && typeof data === 'object' && 'image' in data) {
            if (!data.userId || data.userId === user?.id) {
                setScreenShot(data.image);
                
                if (data.viewport) {
                    setViewportInfo(data.viewport);
                }
            }
        }
    }, [screenShot, user?.id]);

    useEffect(() => {
        if (socket) {
            socket.on("screencast", screencastHandler);
            socket.on("domcast", rrwebSnapshotHandler);
            socket.on("dom-mode-enabled", domModeHandler);
            socket.on("screenshot-mode-enabled", screenshotModeHandler);
            socket.on("dom-mode-error", domModeErrorHandler);
        }

        if (canvasRef?.current && !isDOMMode && screenShot) {
            drawImage(screenShot, canvasRef.current);
        }

        return () => {
            if (socket) {
                console.log("Cleaning up DOM streaming event listeners");
                socket.off("screencast", screencastHandler);
                socket.off("domcast", rrwebSnapshotHandler);
                socket.off("dom-mode-enabled", domModeHandler);
                socket.off("screenshot-mode-enabled", screenshotModeHandler);
                socket.off("dom-mode-error", domModeErrorHandler);
            }
        };
    }, [
        socket,
        screenShot,
        canvasRef,
        isDOMMode,
        screencastHandler,
        rrwebSnapshotHandler,
        domModeHandler,
        screenshotModeHandler,
        domModeErrorHandler,
    ]);

    const domHighlighterHandler = useCallback(
        (data: {
            rect: DOMRect;
            selector: string;
            elementInfo: ElementInfo | null;
            childSelectors?: string[];
            isDOMMode?: boolean;
        }) => {
            if (!isDOMMode || !currentSnapshot) {
                return;
            }

            let iframeElement = document.querySelector(
                "#dom-browser-iframe"
            ) as HTMLIFrameElement;

            if (!iframeElement) {
                iframeElement = document.querySelector(
                "#browser-window iframe"
                ) as HTMLIFrameElement;
            }

            if (!iframeElement) {
                const browserWindow = document.querySelector("#browser-window");
                if (browserWindow) {
                iframeElement = browserWindow.querySelector(
                    "iframe"
                ) as HTMLIFrameElement;
                }
            }

            if (!iframeElement) {
                console.error("Could not find iframe element for DOM highlighting");
                return;
            }

            const iframeRect = iframeElement.getBoundingClientRect();
            const IFRAME_BODY_PADDING = 16;

            const absoluteRect = new DOMRect(
                data.rect.x + iframeRect.left - IFRAME_BODY_PADDING,
                data.rect.y + iframeRect.top - IFRAME_BODY_PADDING,
                data.rect.width,
                data.rect.height
            );

            const mappedData = {
                ...data,
                rect: absoluteRect,
            };

            if (getList === true) {
                if (listSelector) {
                    socket?.emit("listSelector", { selector: listSelector });
                    const hasValidChildSelectors =
                        Array.isArray(mappedData.childSelectors) &&
                        mappedData.childSelectors.length > 0;

                    if (limitMode) {
                        setHighlighterData(null);
                    } else if (paginationMode) {
                        if (
                        paginationType !== "" &&
                        !["none", "scrollDown", "scrollUp"].includes(paginationType)
                        ) {
                            setHighlighterData(mappedData);
                        } else {
                            setHighlighterData(null);
                        }
                    } else if (
                        mappedData.childSelectors &&
                        mappedData.childSelectors.includes(mappedData.selector)
                    ) {
                        setHighlighterData(mappedData);
                    } else if (
                        mappedData.elementInfo?.isIframeContent &&
                        mappedData.childSelectors
                    ) {
                        const isIframeChild = mappedData.childSelectors.some(
                            (childSelector) =>
                                mappedData.selector.includes(":>>") &&
                                childSelector
                                .split(":>>")
                                .some((part) => mappedData.selector.includes(part.trim()))
                            );
                        setHighlighterData(isIframeChild ? mappedData : null);
                    } else if (
                        mappedData.selector.includes(":>>") &&
                        hasValidChildSelectors
                    ) {
                        const selectorParts = mappedData.selector
                            .split(":>>")
                            .map((part) => part.trim());
                            const isValidMixedSelector = selectorParts.some((part) =>
                            mappedData.childSelectors!.some((childSelector) =>
                                childSelector.includes(part)
                                )
                            );
                        setHighlighterData(isValidMixedSelector ? mappedData : null);
                    } else if (
                        mappedData.elementInfo?.isShadowRoot &&
                        mappedData.childSelectors
                    ) {
                        const isShadowChild = mappedData.childSelectors.some(
                            (childSelector) =>
                                mappedData.selector.includes(">>") &&
                                childSelector
                                .split(">>")
                                .some((part) => mappedData.selector.includes(part.trim()))
                            );
                        setHighlighterData(isShadowChild ? mappedData : null);
                    } else if (
                        mappedData.selector.includes(">>") &&
                        hasValidChildSelectors
                    ) {
                        const selectorParts = mappedData.selector
                            .split(">>")
                            .map((part) => part.trim());
                            const isValidMixedSelector = selectorParts.some((part) =>
                            mappedData.childSelectors!.some((childSelector) =>
                                childSelector.includes(part)
                            )
                        );

                        setHighlighterData(isValidMixedSelector ? mappedData : null);
                    } else {
                        setHighlighterData(null);
                    }
                } else {
                    setHighlighterData(mappedData);
                }
            } else {
                // getText mode
                setHighlighterData(mappedData);
            }
        },
        [
            isDOMMode,
            currentSnapshot,
            getList,
            socket,
            listSelector,
            paginationMode,
            paginationType,
            limitMode,
        ]
    );

    const highlighterHandler = useCallback((data: { rect: DOMRect, selector: string, elementInfo: ElementInfo | null, childSelectors?: string[] }) => {
        const now = performance.now();
        if (now - highlighterUpdateRef.current < 16) {
            return;
        }
        highlighterUpdateRef.current = now;
        
        // Map the incoming DOMRect from browser coordinates to canvas coordinates
        const mappedRect = new DOMRect(
            data.rect.x,
            data.rect.y,
            data.rect.width,
            data.rect.height
        );
        
        const mappedData = {
            ...data,
            rect: mappedRect
        };
        
        if (getList === true) {
            if (listSelector) {
                socket?.emit('listSelector', { selector: listSelector });
                const hasValidChildSelectors = Array.isArray(mappedData.childSelectors) && mappedData.childSelectors.length > 0;

                if (limitMode) {
                    setHighlighterData(null);
                } else if (paginationMode) {
                    // Only set highlighterData if type is not empty, 'none', 'scrollDown', or 'scrollUp'
                    if (paginationType !== '' && !['none', 'scrollDown', 'scrollUp'].includes(paginationType)) {
                        setHighlighterData(mappedData);
                    } else {
                        setHighlighterData(null);
                    }
                } else if (mappedData.childSelectors && mappedData.childSelectors.includes(mappedData.selector)) {
                    // Highlight only valid child elements within the listSelector
                    setHighlighterData(mappedData);
                } else if (mappedData.elementInfo?.isIframeContent && mappedData.childSelectors) {
                    // Handle iframe elements
                    const isIframeChild = mappedData.childSelectors.some(childSelector =>
                        mappedData.selector.includes(':>>') && 
                        childSelector.split(':>>').some(part =>
                            mappedData.selector.includes(part.trim())
                        )
                    );
                    setHighlighterData(isIframeChild ? mappedData : null);
                } else if (mappedData.selector.includes(':>>') && hasValidChildSelectors) {
                    // Handle mixed DOM cases with iframes
                    const selectorParts = mappedData.selector.split(':>>').map(part => part.trim());
                    const isValidMixedSelector = selectorParts.some(part =>
                        mappedData.childSelectors!.some(childSelector =>
                            childSelector.includes(part)
                        )
                    );
                    setHighlighterData(isValidMixedSelector ? mappedData : null);
                } else if (mappedData.elementInfo?.isShadowRoot && mappedData.childSelectors) {
                    // Handle Shadow DOM elements
                    const isShadowChild = mappedData.childSelectors.some(childSelector =>
                        mappedData.selector.includes('>>') &&
                        childSelector.split('>>').some(part =>
                            mappedData.selector.includes(part.trim())
                        )
                    );
                    setHighlighterData(isShadowChild ? mappedData : null);
                } else if (mappedData.selector.includes('>>') && hasValidChildSelectors) {
                    // Handle mixed DOM cases
                    const selectorParts = mappedData.selector.split('>>').map(part => part.trim());
                    const isValidMixedSelector = selectorParts.some(part =>
                        mappedData.childSelectors!.some(childSelector =>
                            childSelector.includes(part)
                        )
                    );
                    setHighlighterData(isValidMixedSelector ? mappedData : null);
                } else {
                    // If not a valid child in normal mode, clear the highlighter
                    setHighlighterData(null);
                }
            } else {
                // Set highlighterData for the initial listSelector selection
                setHighlighterData(mappedData);
            }
        } else {
            // For non-list steps
            setHighlighterData(mappedData);
        }
    }, [getList, socket, listSelector, paginationMode, paginationType, limitMode]);

    useEffect(() => {
        document.addEventListener('mousemove', onMouseMove, false);
        if (socket) {
          socket.off("highlighter", highlighterHandler);
          
          socket.on("highlighter", highlighterHandler);
        }
        return () => {
          document.removeEventListener('mousemove', onMouseMove);
          if (socket) {
            socket.off("highlighter", highlighterHandler);
          }
        };
    }, [socket, highlighterHandler, onMouseMove, getList, listSelector]);

    useEffect(() => {
        if (socket && listSelector) {
          console.log('Syncing list selector with server:', listSelector);
          socket.emit('setGetList', { getList: true });
          socket.emit('listSelector', { selector: listSelector });
        }
    }, [socket, listSelector]);

    useEffect(() => {
        if (captureStage === 'initial' && listSelector) {
            socket?.emit('setGetList', { getList: true });
            socket?.emit('listSelector', { selector: listSelector });
        }
    }, [captureStage, listSelector, socket]);

    const handleDOMElementSelection = useCallback(
        (highlighterData: {
            rect: DOMRect;
            selector: string;
            elementInfo: ElementInfo | null;
            childSelectors?: string[];
        }) => {
            setShowAttributeModal(false);
            setSelectedElement(null);
            setAttributeOptions([]);

        const options = getAttributeOptions(
            highlighterData.elementInfo?.tagName || "",
            highlighterData.elementInfo
        );

        if (getText === true) {
            if (options.length === 1) {
                const attribute = options[0].value;
                const data =
                    attribute === "href"
                    ? highlighterData.elementInfo?.url || ""
                    : attribute === "src"
                    ? highlighterData.elementInfo?.imageUrl || ""
                    : highlighterData.elementInfo?.innerText || "";

                addTextStep(
                    "",
                    data,
                    {
                        selector: highlighterData.selector,
                        tag: highlighterData.elementInfo?.tagName,
                        shadow: highlighterData.elementInfo?.isShadowRoot,
                        attribute,
                    },
                    currentTextActionId || `text-${crypto.randomUUID()}`
                );
            } else {
                setAttributeOptions(options);
                setSelectedElement({
                    selector: highlighterData.selector,
                    info: highlighterData.elementInfo,
                });
                setShowAttributeModal(true);
            }
        }

        if (paginationMode && getList) {
            if (
                paginationType !== "" &&
                paginationType !== "scrollDown" &&
                paginationType !== "scrollUp" &&
                paginationType !== "none"
            ) {
                setPaginationSelector(highlighterData.selector);
                notify(
                    `info`,
                    t(
                    "browser_window.attribute_modal.notifications.pagination_select_success"
                    )
                );
                addListStep(
                    listSelector!,
                    fields,
                    currentListId || 0,
                    currentListActionId || `list-${crypto.randomUUID()}`,
                    { type: paginationType, selector: highlighterData.selector }
                );
                socket?.emit("setPaginationMode", { pagination: false });
            }
            return;
        }

        if (getList === true && !listSelector) {
            let cleanedSelector = highlighterData.selector;
            if (cleanedSelector.includes("nth-child")) {
                cleanedSelector = cleanedSelector.replace(/:nth-child\(\d+\)/g, "");
            }

            setListSelector(cleanedSelector);
            notify(
                `info`,
                t("browser_window.attribute_modal.notifications.list_select_success")
            );
            setCurrentListId(Date.now());
            setFields({});

            socket?.emit("setGetList", { getList: true });
            socket?.emit("listSelector", { selector: cleanedSelector });
        } else if (getList === true && listSelector && currentListId) {
            if (options.length === 1) {
                const attribute = options[0].value;
                let currentSelector = highlighterData.selector;

                if (currentSelector.includes(">")) {
                    const [firstPart, ...restParts] = currentSelector
                        .split(">")
                        .map((p) => p.trim());
                    const listSelectorRightPart = listSelector
                        .split(">")
                        .pop()
                        ?.trim()
                        .replace(/:nth-child\(\d+\)/g, "");

                    if (
                    firstPart.includes("nth-child") &&
                    firstPart.replace(/:nth-child\(\d+\)/g, "") ===
                        listSelectorRightPart
                    ) {
                    currentSelector = `${firstPart.replace(
                        /:nth-child\(\d+\)/g,
                        ""
                    )} > ${restParts.join(" > ")}`;
                    }
                }

                const data =
                    attribute === "href"
                    ? highlighterData.elementInfo?.url || ""
                    : attribute === "src"
                    ? highlighterData.elementInfo?.imageUrl || ""
                    : highlighterData.elementInfo?.innerText || "";

                const newField: TextStep = {
                    id: Date.now(),
                    type: "text",
                    label: `Label ${Object.keys(fields).length + 1}`,
                    data: data,
                    selectorObj: {
                        selector: currentSelector,
                        tag: highlighterData.elementInfo?.tagName,
                        shadow: highlighterData.elementInfo?.isShadowRoot,
                        attribute,
                    },
                };

                const updatedFields = {
                    ...fields,
                    [newField.id]: newField,
                };

                setFields(updatedFields);

                if (listSelector) {
                    addListStep(
                        listSelector,
                        updatedFields,
                        currentListId,
                        currentListActionId || `list-${crypto.randomUUID()}`,
                        { type: "", selector: paginationSelector }
                    );
                }
            } else {
            setAttributeOptions(options);
            setSelectedElement({
                selector: highlighterData.selector,
                info: highlighterData.elementInfo,
            });
            setShowAttributeModal(true);
            }
        }
        },
        [
            getText,
            getList,
            listSelector,
            paginationMode,
            paginationType,
            fields,
            currentListId,
            currentTextActionId,
            currentListActionId,
            addTextStep,
            addListStep,
            notify,
            socket,
            t,
            paginationSelector,
        ]
    );


    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (highlighterData && canvasRef?.current) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            const clickX = e.clientX - canvasRect.left;
            const clickY = e.clientY - canvasRect.top;

            const highlightRect = highlighterData.rect;

            const mappedRect = coordinateMapper.mapBrowserRectToCanvas(highlightRect);
            if (
                clickX >= mappedRect.left &&
                clickX <= mappedRect.right &&
                clickY >= mappedRect.top &&
                clickY <= mappedRect.bottom
            ) {

                const options = getAttributeOptions(highlighterData.elementInfo?.tagName || '', highlighterData.elementInfo);

                if (getText === true) {
                    if (options.length === 1) {
                        // Directly use the available attribute if only one option is present
                        const attribute = options[0].value;
                        const data = attribute === 'href' ? highlighterData.elementInfo?.url || '' :
                            attribute === 'src' ? highlighterData.elementInfo?.imageUrl || '' :
                                highlighterData.elementInfo?.innerText || '';

                        addTextStep('', data, {
                            selector: highlighterData.selector,
                            tag: highlighterData.elementInfo?.tagName,
                            shadow: highlighterData.elementInfo?.isShadowRoot,
                            attribute,
                        }, currentTextActionId || `text-${crypto.randomUUID()}`);
                    } else {
                        // Show the modal if there are multiple options
                        setAttributeOptions(options);
                        setSelectedElement({
                            selector: highlighterData.selector,
                            info: highlighterData.elementInfo,
                        });
                        setShowAttributeModal(true);
                    }
                }

                if (paginationMode && getList) {
                    // Only allow selection in pagination mode if type is not empty, 'scrollDown', or 'scrollUp'
                    if (paginationType !== '' && paginationType !== 'scrollDown' && paginationType !== 'scrollUp' && paginationType !== 'none') {
                        setPaginationSelector(highlighterData.selector);
                        notify(`info`, t('browser_window.attribute_modal.notifications.pagination_select_success'));
                        addListStep(listSelector!, fields, currentListId || 0, currentListActionId || `list-${crypto.randomUUID()}`, { type: paginationType, selector: highlighterData.selector });
                        socket?.emit('setPaginationMode', { pagination: false });
                    }
                    return;
                }

                if (getList === true && !listSelector) {
                    let cleanedSelector = highlighterData.selector;
                    if (cleanedSelector.includes('nth-child')) {
                        cleanedSelector = cleanedSelector.replace(/:nth-child\(\d+\)/g, '');
                    }

                    setListSelector(cleanedSelector);
                    notify(`info`, t('browser_window.attribute_modal.notifications.list_select_success'));
                    setCurrentListId(Date.now());
                    setFields({});
                } else if (getList === true && listSelector && currentListId) {
                    const attribute = options[0].value;
                    const data = attribute === 'href' ? highlighterData.elementInfo?.url || '' :
                        attribute === 'src' ? highlighterData.elementInfo?.imageUrl || '' :
                            highlighterData.elementInfo?.innerText || '';
                    // Add fields to the list
                    if (options.length === 1) {
                        const attribute = options[0].value;
                        let currentSelector = highlighterData.selector;

                        if (currentSelector.includes('>')) {
                            const [firstPart, ...restParts] = currentSelector.split('>').map(p => p.trim());
                            const listSelectorRightPart = listSelector.split('>').pop()?.trim().replace(/:nth-child\(\d+\)/g, '');

                            if (firstPart.includes('nth-child') && 
                                firstPart.replace(/:nth-child\(\d+\)/g, '') === listSelectorRightPart) {
                                currentSelector = `${firstPart.replace(/:nth-child\(\d+\)/g, '')} > ${restParts.join(' > ')}`;
                            }
                        }

                        const newField: TextStep = {
                            id: Date.now(),
                            type: 'text',
                            label: `Label ${Object.keys(fields).length + 1}`,
                            data: data,
                            selectorObj: {
                                selector: currentSelector,
                                tag: highlighterData.elementInfo?.tagName,
                                shadow: highlighterData.elementInfo?.isShadowRoot,
                                attribute
                            }
                        };

                        const updatedFields = {
                            ...fields,
                            [newField.id]: newField
                          };
                          
                        setFields(updatedFields);

                        if (listSelector) {
                            addListStep(
                                listSelector, 
                                updatedFields, 
                                currentListId, 
                                currentListActionId || `list-${crypto.randomUUID()}`,
                                { type: '', selector: paginationSelector }
                            );
                        }

                    } else {
                        setAttributeOptions(options);
                        setSelectedElement({
                            selector: highlighterData.selector,
                            info: highlighterData.elementInfo
                        });
                        setShowAttributeModal(true);
                    }
                }
            }
        }
    };

    const handleAttributeSelection = (attribute: string) => {
        if (selectedElement) {
            let data = '';
            switch (attribute) {
                case 'href':
                    data = selectedElement.info?.url || '';
                    break;
                case 'src':
                    data = selectedElement.info?.imageUrl || '';
                    break;
                default:
                    data = selectedElement.info?.innerText || '';
            }
            {
                if (getText === true) {
                    addTextStep('', data, {
                        selector: selectedElement.selector,
                        tag: selectedElement.info?.tagName,
                        shadow: selectedElement.info?.isShadowRoot,
                        attribute: attribute
                    }, currentTextActionId || `text-${crypto.randomUUID()}`);
                }
                if (getList === true && listSelector && currentListId) {
                    const newField: TextStep = {
                        id: Date.now(),
                        type: 'text',
                        label: `Label ${Object.keys(fields).length + 1}`,
                        data: data,
                        selectorObj: {
                            selector: selectedElement.selector,
                            tag: selectedElement.info?.tagName,
                            shadow: selectedElement.info?.isShadowRoot,
                            attribute: attribute
                        }
                    };

                    const updatedFields = {
                        ...fields,
                        [newField.id]: newField
                      };
                      
                    setFields(updatedFields);

                    if (listSelector) {
                        addListStep(
                            listSelector, 
                            updatedFields, 
                            currentListId, 
                            currentListActionId || `list-${crypto.randomUUID()}`,
                            { type: '', selector: paginationSelector }
                        );
                    }
                }
            }
        }
        
        setShowAttributeModal(false);
        setSelectedElement(null);
        setAttributeOptions([]);

        setTimeout(() => {
        setShowAttributeModal(false);
        }, 0);
    };

    const resetPaginationSelector = useCallback(() => {
        setPaginationSelector('');
    }, []);

    useEffect(() => {
        if (!paginationMode) {
            resetPaginationSelector();
        }
    }, [paginationMode, resetPaginationSelector]);

    return (
        <div onClick={handleClick} style={{ width: browserWidth }} id="browser-window">
            {
                getText === true || getList === true ? (
                    <GenericModal
                        isOpen={showAttributeModal}
                        onClose={() => {
                            setShowAttributeModal(false);
                            setSelectedElement(null);
                            setAttributeOptions([]);
                        }}
                        canBeClosed={true}
                        modalStyle={modalStyle}
                    >
                        <div>
                            <h2>Select Attribute</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '30px' }}>
                                {attributeOptions.map((option) => (
                                    <Button
                                        variant="outlined"
                                        size="medium"
                                        key={option.value}
                                        onClick={() => handleAttributeSelection(option.value)}
                                        style={{
                                            justifyContent: 'flex-start',
                                            maxWidth: '80%',
                                            overflow: 'hidden',
                                            padding: '5px 10px',
                                        }}
                                        sx={{
                                            color: '#ff00c3 !important',
                                            borderColor: '#ff00c3 !important',
                                            backgroundColor: 'whitesmoke !important',
                                        }}
                                    >
                                        <span style={{
                                            display: 'block',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: '100%'
                                        }}>
                                            {option.label}
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </GenericModal>
                ) : null
            }

            {datePickerInfo && (
                <DatePicker
                    coordinates={datePickerInfo.coordinates}
                    selector={datePickerInfo.selector}
                    onClose={() => setDatePickerInfo(null)}
                />
            )}
            {dropdownInfo && (
                <Dropdown
                    coordinates={dropdownInfo.coordinates}
                    selector={dropdownInfo.selector}
                    options={dropdownInfo.options}
                    onClose={() => setDropdownInfo(null)}
                />
            )}
            {timePickerInfo && (
                <TimePicker
                    coordinates={timePickerInfo.coordinates}
                    selector={timePickerInfo.selector}
                    onClose={() => setTimePickerInfo(null)}
                />
            )}
            {dateTimeLocalInfo && (
                <DateTimeLocalPicker
                    coordinates={dateTimeLocalInfo.coordinates}
                    selector={dateTimeLocalInfo.selector}
                    onClose={() => setDateTimeLocalInfo(null)}
                />
            )}

            <div style={{ height: dimensions.height, overflow: "hidden" }}>
                {(getText === true || getList === true) &&
                !showAttributeModal &&
                highlighterData?.rect != null && (
                    <>
                    {!isDOMMode && canvasRef?.current && (
                        <Highlighter
                            unmodifiedRect={highlighterData?.rect}
                            displayedSelector={highlighterData?.selector}
                            width={dimensions.width}
                            height={dimensions.height}
                            canvasRect={canvasRef.current.getBoundingClientRect()}
                        />
                    )}

                    {isDOMMode && highlighterData && (
                        <>
                            <div
                                style={{
                                    position: "absolute",
                                    left: Math.max(0, highlighterData.rect.x),
                                    top: Math.max(0, highlighterData.rect.y),
                                    width: Math.min(
                                        highlighterData.rect.width,
                                        dimensions.width
                                    ),
                                    height: Math.min(
                                        highlighterData.rect.height,
                                        dimensions.height
                                    ),
                                    background: "rgba(255, 0, 195, 0.15)",
                                    border: "2px solid #ff00c3",
                                    borderRadius: "3px",
                                    pointerEvents: "none",
                                    zIndex: 1000,
                                    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.8)",
                                    transition: "all 0.1s ease-out",
                                }}
                            />
                        </>
                    )}
                    </>
                )}

                {isDOMMode ? (
                    currentSnapshot ? (
                        <DOMBrowserRenderer
                            width={dimensions.width}
                            height={dimensions.height}
                            snapshot={currentSnapshot}
                            getList={getList}
                            getText={getText}
                            listSelector={listSelector}
                            paginationMode={paginationMode}
                            paginationType={paginationType}
                            limitMode={limitMode}
                            onHighlight={(data: any) => {
                                domHighlighterHandler(data);
                            }}
                            onElementSelect={handleDOMElementSelection}
                            onShowDatePicker={handleShowDatePicker}
                            onShowDropdown={handleShowDropdown}
                            onShowTimePicker={handleShowTimePicker}
                            onShowDateTimePicker={handleShowDateTimePicker}
                        />
                    ) : (
                        <div
                        style={{
                            width: dimensions.width,
                            height: dimensions.height,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#f5f5f5",
                            borderRadius: "5px",
                            flexDirection: "column",
                            gap: "20px",
                        }}
                        >
                        <div
                            style={{
                            width: "60px",
                            height: "60px",
                            borderTop: "4px solid transparent",
                            borderRadius: "50%",
                            animation: "spin 1s linear infinite",
                            }}
                        />
                        <div
                            style={{
                            fontSize: "18px",
                            color: "#ff00c3",
                            fontWeight: "bold",
                            }}
                        >
                            Loading website...
                        </div>
                        <style>{`
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                        `}</style>
                        </div>
                    )
                ) : (
                    /* Screenshot mode canvas */
                    <Canvas
                        onCreateRef={setCanvasReference}
                        width={dimensions.width}
                        height={dimensions.height}
                    />
                )}
            </div>
        </div>
    );
};

const drawImage = (image: string, canvas: HTMLCanvasElement): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
        requestAnimationFrame(() => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        });
        if (image.startsWith('blob:')) {
            URL.revokeObjectURL(image);
        }
    };
    img.onerror = () => {
        console.warn('Failed to load image');
    };
    img.src = image;
};

const modalStyle = {
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '30%',
    backgroundColor: 'background.paper',
    p: 4,
    height: 'fit-content',
    display: 'block',
    padding: '20px',
};
