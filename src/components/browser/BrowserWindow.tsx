import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Button } from '@mui/material';
import { GenericModal } from '../ui/GenericModal';
import { useActionContext } from '../../context/browserActions';
import { useBrowserSteps, TextStep, ListStep } from '../../context/browserSteps';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../context/auth';
import { coordinateMapper } from '../../helpers/coordinateMapper';
import { useBrowserDimensionsStore } from '../../context/browserDimensions';
import { clientSelectorGenerator, ElementFingerprint } from "../../helpers/clientSelectorGenerator";
import { capturedElementHighlighter } from "../../helpers/capturedElementHighlighter";
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
    const [highlighterData, setHighlighterData] = useState<{
        rect: DOMRect;
        selector: string;
        elementInfo: ElementInfo | null;
        isShadow?: boolean;
        childSelectors?: string[];
        groupElements?: Array<{ element: HTMLElement; rect: DOMRect }>;
        similarElements?: {
            elements: HTMLElement[];
            rects: DOMRect[];
        };
    } | null>(null);
    const [showAttributeModal, setShowAttributeModal] = useState(false);
    const [attributeOptions, setAttributeOptions] = useState<AttributeOption[]>([]);
    const [selectedElement, setSelectedElement] = useState<{ selector: string, info: ElementInfo | null } | null>(null);
    const [currentListId, setCurrentListId] = useState<number | null>(null);
    const [viewportInfo, setViewportInfo] = useState<ViewportInfo>({ width: browserWidth, height: browserHeight });
    const [isLoading, setIsLoading] = useState(false);
    const [cachedChildSelectors, setCachedChildSelectors] = useState<string[]>([]);
    const [processingGroupCoordinates, setProcessingGroupCoordinates] = useState<Array<{ element: HTMLElement; rect: DOMRect }>>([]);
    const [listSelector, setListSelector] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, TextStep>>({});
    const [paginationSelector, setPaginationSelector] = useState<string>('');

    const highlighterUpdateRef = useRef<number>(0);
    const [isCachingChildSelectors, setIsCachingChildSelectors] = useState(false);
    const [cachedListSelector, setCachedListSelector] = useState<string | null>(
        null
    );
    const [pendingNotification, setPendingNotification] = useState<{
        type: "error" | "warning" | "info" | "success";
        message: string;
        count?: number;
    } | null>(null);

    const [initialAutoFieldIds, setInitialAutoFieldIds] = useState<Set<number>>(new Set());
    const [manuallyAddedFieldIds, setManuallyAddedFieldIds] = useState<Set<number>>(new Set());

    const { socket } = useSocketStore();
    const { notify, currentTextActionId, currentListActionId, updateDOMMode, isDOMMode, currentSnapshot } = useGlobalInfoStore();
    const { getText, getList, paginationMode, paginationType, limitMode, captureStage } = useActionContext();
    const { addTextStep, addListStep, browserSteps } = useBrowserSteps();

    const [currentGroupInfo, setCurrentGroupInfo] = useState<{
        isGroupElement: boolean;
        groupSize: number;
        groupElements: HTMLElement[];
    } | null>(null);
  
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
                updateDOMMode(true, data.snapshotData);
                socket?.emit("dom-mode-enabled");
                setIsLoading(false);
            } else {
                setIsLoading(false);
            }
        }
        },
        [user?.id, socket, updateDOMMode]
    );

    const domModeHandler = useCallback(
        (data: any) => {
            if (!data.userId || data.userId === user?.id) {
                updateDOMMode(true);
                socket?.emit("dom-mode-enabled");
                setIsLoading(false);
            }
        },
        [user?.id, socket, updateDOMMode]
    );

    const domModeErrorHandler = useCallback(
        (data: any) => {
            if (!data.userId || data.userId === user?.id) {
                updateDOMMode(false);
                setIsLoading(false);
            }
        },
        [user?.id, updateDOMMode]
    );

    useEffect(() => {
        if (isDOMMode) {
        clientSelectorGenerator.setGetList(getList);
        clientSelectorGenerator.setListSelector(listSelector || "");
        clientSelectorGenerator.setPaginationMode(paginationMode);
        }
    }, [isDOMMode, getList, listSelector, paginationMode]);

    const createFieldsFromChildSelectors = useCallback(
      (childSelectors: string[], listSelector: string) => {
        if (!childSelectors.length || !currentSnapshot) return {};

        const iframeElement = document.querySelector(
          "#dom-browser-iframe"
        ) as HTMLIFrameElement;

        if (!iframeElement?.contentDocument) return {};

        const candidateFields: Array<{
          id: number;
          field: TextStep;
          element: HTMLElement;
          isLeaf: boolean;
          depth: number;
          position: { x: number; y: number };
        }> = [];

        const uniqueChildSelectors = [...new Set(childSelectors)];

        // Filter child selectors that occur in at least 2 out of first 10 list elements
        const validateChildSelectors = (selectors: string[]): string[] => {
          try {
            // Get first 10 list elements
            const listElements = evaluateXPathAllWithShadowSupport(
              iframeElement.contentDocument!,
              listSelector,
              listSelector.includes(">>") || listSelector.startsWith("//")
            ).slice(0, 10);

            if (listElements.length < 2) {
              return selectors;
            }

            const validSelectors: string[] = [];

            for (const selector of selectors) {
              // First, try to access the element directly
              try {
                const testElement = iframeElement.contentDocument!.evaluate(
                  selector,
                  iframeElement.contentDocument!,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null
                ).singleNodeValue;

                // If we can't access the element, it's likely in shadow DOM - include it
                if (!testElement) {
                  console.log(`Including potentially shadow DOM selector: ${selector}`);
                  validSelectors.push(selector);
                  continue;
                }
              } catch (accessError) {
                // If there's an error accessing, assume shadow DOM and include it
                console.log(`Including selector due to access error: ${selector}`);
                validSelectors.push(selector);
                continue;
              }

              let occurrenceCount = 0;

              // Get all elements that match this child selector
              const childElements = evaluateXPathAllWithShadowSupport(
                iframeElement.contentDocument!,
                selector,
                selector.includes(">>") || selector.startsWith("//")
              );

              // Check how many of these child elements are contained within our list elements
              for (const childElement of childElements) {
                for (const listElement of listElements) {
                  if (listElement.contains(childElement)) {
                    occurrenceCount++;
                    break;
                  }
                }
              }

              // Only include selectors that occur in at least 2 list elements
              if (occurrenceCount >= 2) {
                validSelectors.push(selector);
              }
            }

            return validSelectors;
          } catch (error) {
            console.warn("Failed to validate child selectors:", error);
            return selectors;
          }
        };

        // Enhanced XPath evaluation for multiple elements
        const evaluateXPathAllWithShadowSupport = (
          document: Document,
          xpath: string,
          isShadow: boolean = false
        ): Element[] => {
          try {
            // First try regular XPath evaluation
            const result = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );

            const elements: Element[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node && node.nodeType === Node.ELEMENT_NODE) {
                elements.push(node as Element);
              }
            }

            if (!isShadow || elements.length > 0) {
              return elements;
            }

            // If shadow DOM is indicated and regular XPath fails, use shadow DOM traversal
            // This is a simplified version - for multiple elements, we'll primarily rely on regular XPath
            return elements;
          } catch (err) {
            console.error("XPath evaluation failed:", xpath, err);
            return [];
          }
        };

        const validatedChildSelectors = validateChildSelectors(uniqueChildSelectors);

        const isElementVisible = (element: HTMLElement): boolean => {
          try {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          } catch (error) {
            return false;
          }
        };

        const isValidData = (data: string): boolean => {
          if (!data || data.trim().length === 0) return false;

          const trimmed = data.trim();

          // Filter out single letters
          if (trimmed.length === 1) {
            return false;
          }

          // Filter out pure symbols/punctuation
          if (trimmed.length < 3 && /^[^\w\s]+$/.test(trimmed)) {
            return false;
          }

          // Filter out whitespace and punctuation only
          if (/^[\s\p{P}\p{S}]*$/u.test(trimmed)) return false;

          return trimmed.length > 0;
        };

        // Enhanced shadow DOM-aware element evaluation
        const evaluateXPathWithShadowSupport = (
          document: Document,
          xpath: string,
          isShadow: boolean = false
        ): Element | null => {
          try {
            // First try regular XPath evaluation
            const result = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            ).singleNodeValue as Element | null;

            if (!isShadow || result) {
              return result;
            }

            // If shadow DOM is indicated and regular XPath fails, use shadow DOM traversal
            let cleanPath = xpath;
            let isIndexed = false;

            const indexedMatch = xpath.match(/^\((.*?)\)\[(\d+)\](.*)$/);
            if (indexedMatch) {
              cleanPath = indexedMatch[1] + indexedMatch[3];
              isIndexed = true;
            }

            const pathParts = cleanPath
              .replace(/^\/\//, "")
              .split("/")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);

            let currentContexts: (Document | Element | ShadowRoot)[] = [document];

            for (let i = 0; i < pathParts.length; i++) {
              const part = pathParts[i];
              const nextContexts: (Element | ShadowRoot)[] = [];

              for (const ctx of currentContexts) {
                const positionalMatch = part.match(/^([^[]+)\[(\d+)\]$/);
                let partWithoutPosition = part;
                let requestedPosition: number | null = null;

                if (positionalMatch) {
                  partWithoutPosition = positionalMatch[1];
                  requestedPosition = parseInt(positionalMatch[2]);
                }

                const matched = queryInsideContext(ctx, partWithoutPosition);

                let elementsToAdd = matched;
                if (requestedPosition !== null) {
                  const index = requestedPosition - 1;
                  if (index >= 0 && index < matched.length) {
                    elementsToAdd = [matched[index]];
                  } else {
                    elementsToAdd = [];
                  }
                }

                elementsToAdd.forEach((el) => {
                  nextContexts.push(el);
                  if (el.shadowRoot) {
                    nextContexts.push(el.shadowRoot);
                  }
                });
              }

              if (nextContexts.length === 0) {
                return null;
              }

              currentContexts = nextContexts;
            }

            if (currentContexts.length > 0) {
              if (isIndexed && indexedMatch) {
                const requestedIndex = parseInt(indexedMatch[2]) - 1;
                if (requestedIndex >= 0 && requestedIndex < currentContexts.length) {
                  return currentContexts[requestedIndex] as Element;
                } else {
                  return null;
                }
              }

              return currentContexts[0] as Element;
            }

            return null;
          } catch (err) {
            console.error("XPath evaluation failed:", xpath, err);
            return null;
          }
        };

        const queryInsideContext = (
          context: Document | Element | ShadowRoot,
          part: string
        ): Element[] => {
          try {
            const { tagName, conditions } = parseXPathPart(part);

            const candidateElements = Array.from(context.querySelectorAll(tagName));
            if (candidateElements.length === 0) {
              return [];
            }

            const matchingElements = candidateElements.filter((el) => {
              return elementMatchesConditions(el, conditions);
            });

            return matchingElements;
          } catch (err) {
            console.error("Error in queryInsideContext:", err);
            return [];
          }
        };

        const parseXPathPart = (
          part: string
        ): { tagName: string; conditions: string[] } => {
          const tagMatch = part.match(/^([a-zA-Z0-9-]+)/);
          const tagName = tagMatch ? tagMatch[1] : "*";

          const conditionMatches = part.match(/\[([^\]]+)\]/g);
          const conditions = conditionMatches
            ? conditionMatches.map((c) => c.slice(1, -1))
            : [];

          return { tagName, conditions };
        };

        const elementMatchesConditions = (
          element: Element,
          conditions: string[]
        ): boolean => {
          for (const condition of conditions) {
            if (!elementMatchesCondition(element, condition)) {
              return false;
            }
          }
          return true;
        };

        const elementMatchesCondition = (
          element: Element,
          condition: string
        ): boolean => {
          condition = condition.trim();

          if (/^\d+$/.test(condition)) {
            return true;
          }

          // Handle @attribute="value"
          const attrMatch = condition.match(/^@([^=]+)=["']([^"']+)["']$/);
          if (attrMatch) {
            const [, attr, value] = attrMatch;
            const elementValue = element.getAttribute(attr);
            return elementValue === value;
          }

          // Handle contains(@class, 'value')
          const classContainsMatch = condition.match(
            /^contains\(@class,\s*["']([^"']+)["']\)$/
          );
          if (classContainsMatch) {
            const className = classContainsMatch[1];
            return element.classList.contains(className);
          }

          // Handle contains(@attribute, 'value')
          const attrContainsMatch = condition.match(
            /^contains\(@([^,]+),\s*["']([^"']+)["']\)$/
          );
          if (attrContainsMatch) {
            const [, attr, value] = attrContainsMatch;
            const elementValue = element.getAttribute(attr) || "";
            return elementValue.includes(value);
          }

          // Handle text()="value"
          const textMatch = condition.match(/^text\(\)=["']([^"']+)["']$/);
          if (textMatch) {
            const expectedText = textMatch[1];
            const elementText = element.textContent?.trim() || "";
            return elementText === expectedText;
          }

          // Handle contains(text(), 'value')
          const textContainsMatch = condition.match(
            /^contains\(text\(\),\s*["']([^"']+)["']\)$/
          );
          if (textContainsMatch) {
            const expectedText = textContainsMatch[1];
            const elementText = element.textContent?.trim() || "";
            return elementText.includes(expectedText);
          }

          // Handle count(*)=0 (element has no children)
          if (condition === "count(*)=0") {
            return element.children.length === 0;
          }

          // Handle other count conditions
          const countMatch = condition.match(/^count\(\*\)=(\d+)$/);
          if (countMatch) {
            const expectedCount = parseInt(countMatch[1]);
            return element.children.length === expectedCount;
          }

          return true;
        };

        // Enhanced value extraction with shadow DOM support
        const extractValueWithShadowSupport = (
          element: Element,
          attribute: string
        ): string | null => {
          if (!element) return null;

          const baseURL =
            element.ownerDocument?.location?.href || window.location.origin;

          // Check shadow DOM content first
          if (element.shadowRoot) {
            const shadowContent = element.shadowRoot.textContent;
            if (shadowContent?.trim()) {
              return shadowContent.trim();
            }
          }

          if (attribute === "innerText") {
            let textContent =
              (element as HTMLElement).innerText?.trim() ||
              (element as HTMLElement).textContent?.trim();

            if (!textContent) {
              const dataAttributes = [
                "data-600",
                "data-text",
                "data-label",
                "data-value",
                "data-content",
              ];
              for (const attr of dataAttributes) {
                const dataValue = element.getAttribute(attr);
                if (dataValue && dataValue.trim()) {
                  textContent = dataValue.trim();
                  break;
                }
              }
            }

            return textContent || null;
          } else if (attribute === "innerHTML") {
            return element.innerHTML?.trim() || null;
          } else if (attribute === "href") {
            let anchorElement = element;

            if (element.tagName !== "A") {
              anchorElement =
                element.closest("a") ||
                element.parentElement?.closest("a") ||
                element;
            }

            const hrefValue = anchorElement.getAttribute("href");
            if (!hrefValue || hrefValue.trim() === "") {
              return null;
            }

            try {
              return new URL(hrefValue, baseURL).href;
            } catch (e) {
              console.warn("Error creating URL from", hrefValue, e);
              return hrefValue;
            }
          } else if (attribute === "src") {
            const attrValue = element.getAttribute(attribute);
            const dataAttr = attrValue || element.getAttribute("data-" + attribute);

            if (!dataAttr || dataAttr.trim() === "") {
              const style = window.getComputedStyle(element as HTMLElement);
              const bgImage = style.backgroundImage;
              if (bgImage && bgImage !== "none") {
                const matches = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/);
                return matches ? new URL(matches[1], baseURL).href : null;
              }
              return null;
            }

            try {
              return new URL(dataAttr, baseURL).href;
            } catch (e) {
              console.warn("Error creating URL from", dataAttr, e);
              return dataAttr;
            }
          }
          return element.getAttribute(attribute);
        };

        // Simple deepest child finder - limit depth to prevent hanging
        const findDeepestChild = (element: HTMLElement): HTMLElement => {
          let deepest = element;
          let maxDepth = 0;

          const traverse = (el: HTMLElement, depth: number) => {
            if (depth > 3) return;

            const text = el.textContent?.trim() || "";
            if (isValidData(text) && depth > maxDepth) {
              maxDepth = depth;
              deepest = el;
            }

            const children = Array.from(el.children).slice(0, 3);
            children.forEach((child) => {
              if (child instanceof HTMLElement) {
                traverse(child, depth + 1);
              }
            });
          };

          traverse(element, 0);
          return deepest;
        };

        validatedChildSelectors.forEach((childSelector, index) => {
          try {
            // Detect if this selector should use shadow DOM traversal
            const isShadowSelector = childSelector.includes('>>') || 
                                   childSelector.startsWith('//') && 
                                   (listSelector.includes('>>') || currentSnapshot?.snapshot);

            const element = evaluateXPathWithShadowSupport(
              iframeElement.contentDocument!,
              childSelector,
              isShadowSelector
            ) as HTMLElement;

            if (element && isElementVisible(element)) {
              const rect = element.getBoundingClientRect();
              const position = { x: rect.left, y: rect.top };

              const tagName = element.tagName.toLowerCase();
              const isShadow = element.getRootNode() instanceof ShadowRoot;

              if (tagName === "a") {
                const anchor = element as HTMLAnchorElement;
                const href = extractValueWithShadowSupport(anchor, "href");
                const text = extractValueWithShadowSupport(anchor, "innerText");

                if (
                  href &&
                  href.trim() !== "" &&
                  href !== window.location.href &&
                  !href.startsWith("javascript:") &&
                  !href.startsWith("#")
                ) {
                  const fieldIdHref = Date.now() + index * 1000;

                  candidateFields.push({
                    id: fieldIdHref,
                    element: element,
                    isLeaf: true,
                    depth: 0,
                    position: position,
                    field: {
                      id: fieldIdHref,
                      type: "text",
                      label: `Label ${index * 2 + 1}`,
                      data: href,
                      selectorObj: {
                        selector: childSelector,
                        tag: element.tagName,
                        isShadow: isShadow,
                        attribute: "href",
                      },
                    },
                  });
                }

                const fieldIdText = Date.now() + index * 1000 + 1;

                if (text && isValidData(text)) {
                  candidateFields.push({
                    id: fieldIdText,
                    element: element,
                    isLeaf: true,
                    depth: 0,
                    position: position,
                    field: {
                      id: fieldIdText,
                      type: "text",
                      label: `Label ${index * 2 + 2}`,
                      data: text,
                      selectorObj: {
                        selector: childSelector,
                        tag: element.tagName,
                        isShadow: isShadow,
                        attribute: "innerText",
                      },
                    },
                  });
                }
              } else if (tagName === "img") {
                const img = element as HTMLImageElement;
                const src = extractValueWithShadowSupport(img, "src");
                const alt = extractValueWithShadowSupport(img, "alt");

                if (src && !src.startsWith("data:") && src.length > 10) {
                  const fieldId = Date.now() + index * 1000;

                  candidateFields.push({
                    id: fieldId,
                    element: element,
                    isLeaf: true,
                    depth: 0,
                    position: position,
                    field: {
                      id: fieldId,
                      type: "text",
                      label: `Label ${index + 1}`,
                      data: src,
                      selectorObj: {
                        selector: childSelector,
                        tag: element.tagName,
                        isShadow: isShadow,
                        attribute: "src",
                      },
                    },
                  });
                }

                if (alt && isValidData(alt)) {
                  const fieldId = Date.now() + index * 1000 + 1;

                  candidateFields.push({
                    id: fieldId,
                    element: element,
                    isLeaf: true,
                    depth: 0,
                    position: position,
                    field: {
                      id: fieldId,
                      type: "text",
                      label: `Label ${index + 2}`,
                      data: alt,
                      selectorObj: {
                        selector: childSelector,
                        tag: element.tagName,
                        isShadow: isShadow,
                        attribute: "alt",
                      },
                    },
                  });
                }
              } else {
                const deepestElement = findDeepestChild(element);
                const data = extractValueWithShadowSupport(deepestElement, "innerText");

                if (data && isValidData(data)) {
                  const isLeaf = isLeafElement(deepestElement);
                  const depth = getElementDepthFromList(
                    deepestElement,
                    listSelector,
                    iframeElement.contentDocument!
                  );

                  const fieldId = Date.now() + index;

                  candidateFields.push({
                    id: fieldId,
                    element: deepestElement,
                    isLeaf: isLeaf,
                    depth: depth,
                    position: position,
                    field: {
                      id: fieldId,
                      type: "text",
                      label: `Label ${index + 1}`,
                      data: data,
                      selectorObj: {
                        selector: childSelector,
                        tag: deepestElement.tagName,
                        isShadow: deepestElement.getRootNode() instanceof ShadowRoot,
                        attribute: "innerText",
                      },
                    },
                  });
                }
              }
            }
          } catch (error) {
            console.warn(
              `Failed to process child selector ${childSelector}:`,
              error
            );
          }
        });

        candidateFields.sort((a, b) => {
          const yDiff = a.position.y - b.position.y;
          
          if (Math.abs(yDiff) <= 5) {
            return a.position.x - b.position.x;
          }
          
          return yDiff;
        });

        const filteredCandidates = removeParentChildDuplicates(candidateFields);

        const finalFields = removeDuplicateContent(filteredCandidates);
        return finalFields;
      },
      [currentSnapshot]
    );

    const isLeafElement = (element: HTMLElement): boolean => {
      const children = Array.from(element.children) as HTMLElement[];

      if (children.length === 0) return true;

      const hasContentfulChildren = children.some((child) => {
        const text = child.textContent?.trim() || "";
        return text.length > 0 && text !== element.textContent?.trim();
      });

      return !hasContentfulChildren;
    };

    const getElementDepthFromList = (
      element: HTMLElement,
      listSelector: string,
      document: Document
    ): number => {
      try {
        const listResult = document.evaluate(
          listSelector,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );

        const listElement = listResult.singleNodeValue as HTMLElement;
        if (!listElement) return 0;

        let depth = 0;
        let current = element;

        while (current && current !== listElement && current.parentElement) {
          depth++;
          current = current.parentElement;
          if (depth > 20) break;
        }

        return current === listElement ? depth : 0;
      } catch (error) {
        return 0;
      }
    };

    const removeParentChildDuplicates = (
      candidates: Array<{
        id: number;
        field: TextStep;
        element: HTMLElement;
        isLeaf: boolean;
        depth: number;
        position: { x: number; y: number };
      }>
    ): Array<{
      id: number;
      field: TextStep;
      element: HTMLElement;
      isLeaf: boolean;
      depth: number;
      position: { x: number; y: number };
    }> => {
      const filtered: Array<{
        id: number;
        field: TextStep;
        element: HTMLElement;
        isLeaf: boolean;
        depth: number;
        position: { x: number; y: number };
      }> = [];

      for (const candidate of candidates) {
        let shouldInclude = true;

        for (const existing of filtered) {
          if (candidate.element.contains(existing.element)) {
            shouldInclude = false;
            break;
          } else if (existing.element.contains(candidate.element)) {
            const existingIndex = filtered.indexOf(existing);
            filtered.splice(existingIndex, 1);
            break;
          }
        }

        if (candidate.element.tagName.toLowerCase() === "a") {
          shouldInclude = true;
        }

        if (shouldInclude) {
          filtered.push(candidate);
        }
      }

      return filtered;
    };

    const removeDuplicateContent = (
      candidates: Array<{
        id: number;
        field: TextStep;
        element: HTMLElement;
        isLeaf: boolean;
        depth: number;
        position: { x: number; y: number };
      }>
    ): Record<string, TextStep> => {
      const finalFields: Record<string, TextStep> = {};
      const seenContent = new Set<string>();
      let labelCounter = 1;

      for (const candidate of candidates) {
        const content = candidate.field.data.trim().toLowerCase();

        if (!seenContent.has(content)) {
          seenContent.add(content);
          finalFields[candidate.id] = {
            ...candidate.field,
            label: `Label ${labelCounter++}`,
          };
        }
      }

      return finalFields;
    };

    useEffect(() => {
      if (isDOMMode && listSelector) {
        socket?.emit("setGetList", { getList: true });
        socket?.emit("listSelector", { selector: listSelector });

        clientSelectorGenerator.setListSelector(listSelector);

        if (currentSnapshot && cachedListSelector !== listSelector) {
          setCachedChildSelectors([]);
          setIsCachingChildSelectors(true);
          setCachedListSelector(listSelector);

          const iframeElement = document.querySelector(
            "#dom-browser-iframe"
          ) as HTMLIFrameElement;

          if (iframeElement?.contentDocument) {
            setTimeout(() => {
              try {
                const childSelectors =
                  clientSelectorGenerator.getChildSelectors(
                    iframeElement.contentDocument as Document,
                    listSelector
                  );

                clientSelectorGenerator.precomputeChildSelectorMappings(
                  childSelectors,
                  iframeElement.contentDocument as Document
                );

                setCachedChildSelectors(childSelectors);

                const autoFields = createFieldsFromChildSelectors(
                  childSelectors,
                  listSelector
                );

                if (Object.keys(autoFields).length > 0) {
                  setFields(autoFields);
                  setInitialAutoFieldIds(new Set(Object.keys(autoFields).map(id => parseInt(id))));

                  addListStep(
                    listSelector,
                    autoFields,
                    currentListId || Date.now(),
                    currentListActionId || `list-${crypto.randomUUID()}`,
                    { type: "", selector: paginationSelector },
                    undefined,
                    false
                  );

                  if (pendingNotification) {
                    notify(pendingNotification.type, pendingNotification.message);
                    setPendingNotification(null);
                  }
                } else {
                  console.warn(`Failed to extract any fields from list selector: ${listSelector}`);

                  setListSelector(null);
                  setFields({});
                  setCachedListSelector(null);
                  setCachedChildSelectors([]);
                  setCurrentListId(null);
                  setInitialAutoFieldIds(new Set());
                  setPendingNotification(null);

                  notify(
                    "error",
                    "The list you have selected is not valid. Please reselect it."
                  );
                }
              } catch (error) {
                console.error("Error during child selector caching:", error);
              } finally {
                setIsCachingChildSelectors(false);
              }
            }, 100);
          } else {
            setIsCachingChildSelectors(false);
          }
        }
      }
    }, [
      isDOMMode,
      listSelector,
      socket,
      getList,
      currentSnapshot,
      cachedListSelector,
      pendingNotification,
      notify,
      createFieldsFromChildSelectors,
      currentListId,
      currentListActionId,
      paginationSelector,
      addListStep
    ]);

    useEffect(() => {
        if (!listSelector) {
            setCachedListSelector(null);
        }
    }, [listSelector]);

    useEffect(() => {
      if (!getList || !listSelector || initialAutoFieldIds.size === 0 || !currentListActionId) return;

      const currentListStep = browserSteps.find(
        step => step.type === 'list' && step.actionId === currentListActionId
      );

      if (!currentListStep || currentListStep.type !== 'list' || !currentListStep.fields) return;

      const currentFieldIds = new Set(Object.keys(currentListStep.fields).map(id => parseInt(id)));
      const newManualIds = new Set<number>();

      currentFieldIds.forEach(fieldId => {
        if (!initialAutoFieldIds.has(fieldId)) {
          newManualIds.add(fieldId);
        }
      });

      if (newManualIds.size !== manuallyAddedFieldIds.size ||
        ![...newManualIds].every(id => manuallyAddedFieldIds.has(id))) {
        setManuallyAddedFieldIds(newManualIds);
      }
    }, [browserSteps, getList, listSelector, initialAutoFieldIds, currentListActionId, manuallyAddedFieldIds]);

    useEffect(() => {
      if (!isDOMMode) {
        capturedElementHighlighter.clearHighlights();
        return;
      }

      const capturedSelectors: Array<{ selector: string }> = [];

      if (getText && currentTextActionId) {
        const textSteps = browserSteps.filter(
          (step): step is TextStep => step.type === 'text' && step.actionId === currentTextActionId
        );

        textSteps.forEach(step => {
          if (step.selectorObj?.selector) {
            capturedSelectors.push({
              selector: step.selectorObj.selector,
            });
          }
        });
      }

      if (getList && listSelector && currentListActionId && manuallyAddedFieldIds.size > 0) {
        const listSteps = browserSteps.filter(
          step => step.type === 'list' && step.actionId === currentListActionId
        ) as ListStep[];

        listSteps.forEach(listStep => {
          if (listStep.fields) {
            Object.entries(listStep.fields).forEach(([fieldId, field]: [string, any]) => {
              if (manuallyAddedFieldIds.has(parseInt(fieldId)) && field.selectorObj?.selector) {
                capturedSelectors.push({
                  selector: field.selectorObj.selector,
                });
              }
            });
          }
        });
      }

      if (capturedSelectors.length > 0) {
        capturedElementHighlighter.applyHighlights(capturedSelectors);
      } else {
        capturedElementHighlighter.clearHighlights();
      }
    }, [browserSteps, getText, getList, listSelector, currentTextActionId, currentListActionId, isDOMMode, manuallyAddedFieldIds]);

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
        
        if (storedListSelector && !listSelector) {
          setListSelector(storedListSelector);
        }
    }, []); 

    const onMouseMove = (e: MouseEvent) => {
    };

    const resetListState = useCallback(() => {
        setListSelector(null);
        setFields({});
        setCurrentListId(null);
        setCachedChildSelectors([]);
        setInitialAutoFieldIds(new Set());
        setManuallyAddedFieldIds(new Set());
    }, []);

    useEffect(() => {
        if (!getList) {
            resetListState();
        }
    }, [getList, resetListState]);

    useEffect(() => {
        if (socket) {
            socket.on("domcast", rrwebSnapshotHandler);
            socket.on("dom-mode-enabled", domModeHandler);
            socket.on("dom-mode-error", domModeErrorHandler);
        }

        return () => {
            if (socket) {
                socket.off("domcast", rrwebSnapshotHandler);
                socket.off("dom-mode-enabled", domModeHandler);
                socket.off("dom-mode-error", domModeErrorHandler);
            }
        };
    }, [
        socket,
        rrwebSnapshotHandler,
        domModeHandler,
        domModeErrorHandler,
    ]);

    const domHighlighterHandler = useCallback(
        (data: {
            rect: DOMRect;
            selector: string;
            elementInfo: ElementInfo | null;
            childSelectors?: string[];
            isShadow?: boolean;
            groupInfo?: {
                isGroupElement: boolean;
                groupSize: number;
                groupElements: HTMLElement[];
                groupFingerprint: ElementFingerprint;
            };
            similarElements?: {
                elements: HTMLElement[];
                rects: DOMRect[];
            };
            isDOMMode?: boolean;
        }) => {
            if (paginationMode && paginationSelector) {
            return;
            }
            if (!getText && !getList) {
                setHighlighterData(null);
                return;
            }

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
                console.error("Could not find iframe element for DOM highlighting");
                return;
            }

            const iframeRect = iframeElement.getBoundingClientRect();
            const IFRAME_X_PADDING = 16;
            const IFRAME_Y_PADDING = 136;

            let mappedSimilarElements;
            if (data.similarElements) {
                mappedSimilarElements = {
                elements: data.similarElements.elements,
                rects: data.similarElements.rects.map(
                    (rect) =>
                    new DOMRect(
                        rect.x + iframeRect.left - IFRAME_X_PADDING,
                        rect.y + iframeRect.top - IFRAME_Y_PADDING,
                        rect.width,
                        rect.height
                    )
                ),
                };
            }

            if (data.groupInfo) {
                setCurrentGroupInfo(data.groupInfo);
            } else {
                setCurrentGroupInfo(null);
            }

            const absoluteRect = new DOMRect(
                data.rect.x + iframeRect.left - IFRAME_X_PADDING,
                data.rect.y + iframeRect.top - IFRAME_Y_PADDING,
                data.rect.width,
                data.rect.height
            );

            const mappedData = {
                ...data,
                rect: absoluteRect,
                childSelectors: data.childSelectors || cachedChildSelectors,
                similarElements: mappedSimilarElements,
            };

            if (getList === true) {
                if (!listSelector && data.groupInfo?.isGroupElement) {
                    const updatedGroupElements = data.groupInfo.groupElements.map(
                        (element) => {
                            const elementRect = element.getBoundingClientRect();
                            return {
                                element,
                                rect: new DOMRect(
                                elementRect.x + iframeRect.left - IFRAME_X_PADDING,
                                elementRect.y + iframeRect.top - IFRAME_Y_PADDING,
                                elementRect.width,
                                elementRect.height
                                ),
                            };
                        }
                    );

                    const mappedData = {
                        ...data,
                        rect: absoluteRect,
                        groupElements: updatedGroupElements,
                        childSelectors: data.childSelectors || cachedChildSelectors,
                    };

                    setHighlighterData(mappedData);
                } else if (listSelector) {
                    const hasChildSelectors =
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
                    } else if (hasChildSelectors) {
                        setHighlighterData(mappedData);
                    } else {
                        setHighlighterData(null);
                    }
                } else {
                    setHighlighterData(mappedData);
                }
            } else {
                setHighlighterData(mappedData);
            }
        },
        [
            isDOMMode,
            currentSnapshot,
            getText,
            getList,
            socket,
            listSelector,
            paginationMode,
            paginationSelector,
            paginationType,
            limitMode,
            cachedChildSelectors,
        ]
    );

    const highlighterHandler = useCallback((data: { rect: DOMRect, selector: string, elementInfo: ElementInfo | null, childSelectors?: string[], isDOMMode?: boolean; }) => {
        if (paginationMode && paginationSelector) {
        return;
        }
        if (isDOMMode || data.isDOMMode) {
            domHighlighterHandler(data);
            return;
        }
        
        const now = performance.now();
        if (now - highlighterUpdateRef.current < 16) {
            return;
        }
        highlighterUpdateRef.current = now;
        
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
                    if (paginationType !== '' && !['none', 'scrollDown', 'scrollUp'].includes(paginationType)) {
                        setHighlighterData(mappedData);
                    } else {
                        setHighlighterData(null);
                    }
                } else if (mappedData.childSelectors && mappedData.childSelectors.includes(mappedData.selector)) {
                    setHighlighterData(mappedData);
                } else if (mappedData.elementInfo?.isIframeContent && mappedData.childSelectors) {
                    const isIframeChild = mappedData.childSelectors.some(childSelector =>
                        mappedData.selector.includes(':>>') && 
                        childSelector.split(':>>').some(part =>
                            mappedData.selector.includes(part.trim())
                        )
                    );
                    setHighlighterData(isIframeChild ? mappedData : null);
                } else if (mappedData.selector.includes(':>>') && hasValidChildSelectors) {
                    const selectorParts = mappedData.selector.split(':>>').map(part => part.trim());
                    const isValidMixedSelector = selectorParts.some(part =>
                        mappedData.childSelectors!.some(childSelector =>
                            childSelector.includes(part)
                        )
                    );
                    setHighlighterData(isValidMixedSelector ? mappedData : null);
                } else if (mappedData.elementInfo?.isShadowRoot && mappedData.childSelectors) {
                    const isShadowChild = mappedData.childSelectors.some(childSelector =>
                        mappedData.selector.includes('>>') &&
                        childSelector.split('>>').some(part =>
                            mappedData.selector.includes(part.trim())
                        )
                    );
                    setHighlighterData(isShadowChild ? mappedData : null);
                } else if (mappedData.selector.includes('>>') && hasValidChildSelectors) {
                    const selectorParts = mappedData.selector.split('>>').map(part => part.trim());
                    const isValidMixedSelector = selectorParts.some(part =>
                        mappedData.childSelectors!.some(childSelector =>
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
            setHighlighterData(mappedData);
        }
    }, [getList, socket, listSelector, paginationMode, paginationType, limitMode]);

    useEffect(() => {
        document.addEventListener("mousemove", onMouseMove, false);
        if (socket) {
            socket.off("highlighter", highlighterHandler);
            socket.on("highlighter", highlighterHandler);
        }
        return () => {
            document.removeEventListener("mousemove", onMouseMove);
            if (socket) {
                socket.off("highlighter", highlighterHandler);
            }
        };
    }, [socket, highlighterHandler, getList, listSelector]);

    useEffect(() => {
        if (socket && listSelector) {
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
        isShadow?: boolean;
        elementInfo: ElementInfo | null;
        childSelectors?: string[];
        groupInfo?: {
          isGroupElement: boolean;
          groupSize: number;
          groupElements: HTMLElement[];
        };
      }) => {
        setShowAttributeModal(false);
        setSelectedElement(null);
        setAttributeOptions([]);

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
                { 
                    type: paginationType, 
                    selector: highlighterData.selector,
                    isShadow: highlighterData.isShadow 
                },
                undefined,
                highlighterData.isShadow
            );
            socket?.emit("setPaginationMode", { pagination: false });
            setHighlighterData(null);
          }
          return;
        }

        if (
          getList === true &&
          !listSelector &&
          highlighterData.groupInfo?.isGroupElement
        ) {
          if (highlighterData?.groupInfo.groupElements) {
            setProcessingGroupCoordinates(
              highlighterData.groupInfo.groupElements.map((element) => ({
                element,
                rect: element.getBoundingClientRect(),
              }))
            );
          }

          let cleanedSelector = highlighterData.selector;

          setListSelector(cleanedSelector);
          setPendingNotification({
            type: `info`,
            message: t(
              "browser_window.attribute_modal.notifications.list_select_success",
              {
                count: highlighterData.groupInfo.groupSize,
              }
            ) ||
              `Selected group with ${highlighterData.groupInfo.groupSize} similar elements`,
            count: highlighterData.groupInfo.groupSize,
          });
          setCurrentListId(Date.now());
          setFields({});

          socket?.emit("setGetList", { getList: true });
          socket?.emit("listSelector", { selector: cleanedSelector });

          return;
        }

        if (getList === true && listSelector && currentListId) {
          const options = getAttributeOptions(
            highlighterData.elementInfo?.tagName || "",
            highlighterData.elementInfo
          );

          if (options.length === 1) {
            const attribute = options[0].value;
            let currentSelector = highlighterData.selector;

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
                isShadow: highlighterData.isShadow || highlighterData.elementInfo?.isShadowRoot,
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
                { type: "", selector: paginationSelector },
                undefined,
                highlighterData.isShadow
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
          return;
        }

        if (getText === true) {
          const options = getAttributeOptions(
            highlighterData.elementInfo?.tagName || "",
            highlighterData.elementInfo
          );

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
                isShadow: highlighterData.isShadow || highlighterData.elementInfo?.isShadowRoot,
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
      },
      [
        getText,
        getList,
        listSelector,
        paginationMode,
        paginationType,
        limitMode,
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
      if (highlighterData) {
        const shouldProcessClick = true;

        if (shouldProcessClick) {
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
                  isShadow: highlighterData.isShadow || highlighterData.elementInfo?.isShadowRoot,
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
                { type: paginationType, selector: highlighterData.selector, isShadow: highlighterData.isShadow },
                undefined,
                highlighterData.isShadow
              );
              socket?.emit("setPaginationMode", { pagination: false });
              setHighlighterData(null);
            }
            return;
          }

          if (getList === true && !listSelector) {
            let cleanedSelector = highlighterData.selector;
            if (
              cleanedSelector.includes("[") &&
              cleanedSelector.match(/\[\d+\]/)
            ) {
              cleanedSelector = cleanedSelector.replace(/\[\d+\]/g, "");
            }

            setListSelector(cleanedSelector);
            notify(
              `info`,
              t(
                "browser_window.attribute_modal.notifications.list_select_success"
              )
            );
            setCurrentListId(Date.now());
            setFields({});
          } else if (getList === true && listSelector && currentListId) {
            const attribute = options[0].value;
            const data =
              attribute === "href"
                ? highlighterData.elementInfo?.url || ""
                : attribute === "src"
                ? highlighterData.elementInfo?.imageUrl || ""
                : highlighterData.elementInfo?.innerText || "";

            if (options.length === 1) {
              let currentSelector = highlighterData.selector;

              if (currentSelector.includes("/")) {
                const xpathParts = currentSelector
                  .split("/")
                  .filter((part) => part);
                const cleanedParts = xpathParts.map((part) => {
                  return part.replace(/\[\d+\]/g, "");
                });

                if (cleanedParts.length > 0) {
                  currentSelector = "//" + cleanedParts.join("/");
                }
              }

              const newField: TextStep = {
                id: Date.now(),
                type: "text",
                label: `Label ${Object.keys(fields).length + 1}`,
                data: data,
                selectorObj: {
                  selector: currentSelector,
                  tag: highlighterData.elementInfo?.tagName,
                  isShadow: highlighterData.isShadow || highlighterData.elementInfo?.isShadowRoot,
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
                  { type: "", selector: paginationSelector, isShadow: highlighterData.isShadow },
                  undefined,
                  highlighterData.isShadow
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
                        isShadow: highlighterData?.isShadow || selectedElement.info?.isShadowRoot,
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
                            isShadow: highlighterData?.isShadow || highlighterData?.elementInfo?.isShadowRoot,
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
                            { type: "", selector: paginationSelector, isShadow: highlighterData?.isShadow },
                            undefined,
                            highlighterData?.isShadow
                        );
                    }
                }
            }
        }
        
        setShowAttributeModal(false);
        setSelectedElement(null);
        setAttributeOptions([]);
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
      <div
        onClick={handleClick}
        style={{ width: browserWidth }}
        id="browser-window"
      >
        {/* Attribute selection modal */}
        {(getText === true || getList === true) && (
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
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                  marginTop: "30px",
                }}
              >
                {attributeOptions.map((option) => (
                  <Button
                    variant="outlined"
                    size="medium"
                    key={option.value}
                    onClick={() => {
                      handleAttributeSelection(option.value);
                    }}
                    style={{
                      justifyContent: "flex-start",
                      maxWidth: "80%",
                      overflow: "hidden",
                    }}
                    sx={{
                      color: "#ff00c3 !important",
                      borderColor: "#ff00c3 !important",
                      backgroundColor: "whitesmoke !important",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {option.label}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </GenericModal>
        )}

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

        {/* Main content area */}
        <div
        style={{
          position: "relative",
          width: "100%",
          height: dimensions.height,
          overflow: "hidden",
          borderRadius: "0px 0px 5px 5px",
        }}
      >
          {/* Add CSS for the spinner animation */}
          <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>

          {(getText || getList) &&
            !showAttributeModal &&
            highlighterData?.rect != null && (
              <>
                {highlighterData && (
                  <div
                  id="dom-highlight-overlay"
                  style={{
                    position: "absolute",
                    inset: 0, // top:0; right:0; bottom:0; left:0
                    overflow: "hidden", // clip everything within iframe area
                    pointerEvents: "none",
                    zIndex: 1000,
                  }}
                >
                    {/* Individual element highlight (for non-group or hovered element) */}
                    {((getText && !listSelector) || 
                      (getList && paginationMode && paginationType !== "" && 
                      !["none", "scrollDown", "scrollUp"].includes(paginationType))) && (
                      <div
                        style={{
                          position: "absolute",
                          left: highlighterData.rect.x,
                          top: highlighterData.rect.y,
                          width: highlighterData.rect.width,
                          height: highlighterData.rect.height,
                          background: "rgba(255, 0, 195, 0.15)",
                          border: "2px solid #ff00c3",
                          borderRadius: "3px",
                          pointerEvents: "none",
                          boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.8)",
                          transition: "all 0.1s ease-out",
                        }}
                      />
                    )}

                    {/* Grouped list element highlights */}
                    {getList &&
                      !listSelector &&
                      currentGroupInfo?.isGroupElement &&
                      highlighterData.groupElements?.map((groupElement, index) => (
                          <React.Fragment key={index}>
                            <div
                              style={{
                                position: "absolute",
                                left: groupElement.rect.x,
                                top: groupElement.rect.y,
                                width: groupElement.rect.width,
                                height: groupElement.rect.height,
                                background: "rgba(255, 0, 195, 0.15)",
                                border: "2px dashed #ff00c3",
                                borderRadius: "3px",
                                pointerEvents: "none",
                                zIndex: 1000,
                                boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.8)",
                                transition: "all 0.1s ease-out",
                              }}
                            />

                            <div
                              style={{
                                position: "absolute",
                                left: groupElement.rect.x,
                                top: groupElement.rect.y - 20,
                                background: "#ff00c3",
                                color: "white",
                                padding: "2px 6px",
                                fontSize: "10px",
                                fontWeight: "bold",
                                borderRadius: "2px",
                                pointerEvents: "none",
                                zIndex: 1001,
                                whiteSpace: "nowrap",
                              }}
                            >
                              List item {index + 1}
                            </div>
                          </React.Fragment>
                        )
                      )}

                    {getList &&
                      listSelector &&
                      !paginationMode &&
                      !limitMode &&
                      highlighterData.similarElements?.rects?.map((rect, index) => (
                          <React.Fragment key={`item-${index}`}>
                            <div
                              style={{
                                position: "absolute",
                                left: rect.x,
                                top: rect.y,
                                width: rect.width,
                                height: rect.height,
                                background: "rgba(255, 0, 195, 0.15)",
                                border: "2px dashed #ff00c3",
                                borderRadius: "3px",
                                pointerEvents: "none",
                                zIndex: 1000,
                                boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.8)",
                                transition: "all 0.1s ease-out",
                              }}
                            />

                            {/* Label for similar element */}
                            <div
                              style={{
                                position: "absolute",
                                left: rect.x,
                                top: rect.y - 20,
                                background: "#ff00c3",
                                color: "white",
                                padding: "2px 6px",
                                fontSize: "10px",
                                fontWeight: "bold",
                                borderRadius: "2px",
                                pointerEvents: "none",
                                zIndex: 1001,
                                whiteSpace: "nowrap",
                              }}
                            >
                              Item {index + 1}
                            </div>
                          </React.Fragment>
                    ))}
                </div>
              )}
            </>
          )}
          {/* --- Main DOM Renderer Section --- */}
        <div
          id="iframe-wrapper"
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden", // key: confine everything below
            borderRadius: "0px 0px 5px 5px",
          }}
        >
          {currentSnapshot ? (
            <>
              <DOMBrowserRenderer
                width={dimensions.width}
                height={dimensions.height}
                snapshot={currentSnapshot}
                getList={getList}
                getText={getText}
                listSelector={listSelector}
                cachedChildSelectors={cachedChildSelectors}
                paginationMode={paginationMode}
                paginationType={paginationType}
                limitMode={limitMode}
                isCachingChildSelectors={isCachingChildSelectors}
                onHighlight={domHighlighterHandler}
                onElementSelect={handleDOMElementSelection}
                onShowDatePicker={handleShowDatePicker}
                onShowDropdown={handleShowDropdown}
                onShowTimePicker={handleShowTimePicker}
                onShowDateTimePicker={handleShowDateTimePicker}
              />

              {/* --- Loading overlay --- */}
              {isCachingChildSelectors && (
                <>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(255, 255, 255, 0.8)",
                      zIndex: 9999,
                      pointerEvents: "none",
                      borderRadius: "0px 0px 5px 5px",
                    }}
                  />
                  {processingGroupCoordinates.map((groupElement, index) => (
                    <React.Fragment key={`group-highlight-${index}`}>
                      <div
                        style={{
                          position: "absolute",
                          left: groupElement.rect.x,
                          top: groupElement.rect.y,
                          width: groupElement.rect.width,
                          height: groupElement.rect.height,
                          background: "rgba(255, 0, 195, 0.15)",
                          border: "2px dashed #ff00c3",
                          borderRadius: "3px",
                          pointerEvents: "none",
                          zIndex: 10000,
                          boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.8)",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: groupElement.rect.x,
                          top: groupElement.rect.y - 20,
                          background: "#ff00c3",
                          color: "white",
                          padding: "2px 6px",
                          fontSize: "10px",
                          fontWeight: "bold",
                          borderRadius: "2px",
                          pointerEvents: "none",
                          zIndex: 10001,
                          whiteSpace: "nowrap",
                        }}
                      >
                        List item {index + 1}
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          left: groupElement.rect.x,
                          top: groupElement.rect.y,
                          width: groupElement.rect.width,
                          height: groupElement.rect.height,
                          overflow: "hidden",
                          zIndex: 10002,
                          pointerEvents: "none",
                          borderRadius: "3px",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            width: "100%",
                            height: "8px",
                            background:
                              "linear-gradient(90deg, transparent 0%, rgba(255, 0, 195, 0.6) 50%, transparent 100%)",
                            animation: `scanDown-${index} 2s ease-in-out infinite`,
                          }}
                        />
                      </div>
                      <style>{`
                  @keyframes scanDown-${index} {
                    0% { transform: translateY(-8px); }
                    100% { transform: translateY(${groupElement.rect.height}px); }
                  }
                `}</style>
                    </React.Fragment>
                  ))}

                  {processingGroupCoordinates.length === 0 && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(255, 255, 255, 0.8)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 9999,
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          border: "4px solid #f3f3f3",
                          borderTop: "4px solid #ff00c3",
                          borderRadius: "50%",
                          animation: "spin 1s linear infinite",
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <DOMLoadingIndicator />
          )}
        </div>
      </div>
    </div>
  );
};

const DOMLoadingIndicator: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [hasStartedLoading, setHasStartedLoading] = useState(false);
  const { socket } = useSocketStore();
  const { state } = useContext(AuthContext);
  const { user } = state;
  const { browserWidth, browserHeight } = useBrowserDimensionsStore();

  useEffect(() => {
    if (!socket) return;

    const handleLoadingProgress = (data: {
      progress: number;
      pendingRequests: number;
      userId: string;
    }) => {
      if (!data.userId || data.userId === user?.id) {
        // Once loading has started, never reset progress to 0
        if (!hasStartedLoading && data.progress > 0) {
          setHasStartedLoading(true);
        }
        
        // Only update progress if we haven't started or if new progress is higher
        if (!hasStartedLoading || data.progress >= progress) {
          setProgress(data.progress);
          setPendingRequests(data.pendingRequests);
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
        width: browserWidth,
        height: browserHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
        borderRadius: "5px",
        flexDirection: "column",
        gap: "15px",
      }}
    >
      {/* Loading text with percentage */}
      <div
        style={{
          fontSize: "18px",
          fontWeight: "500",
          color: "#333",
        }}
      >
        Loading {progress}%
      </div>

      {/* Progress bar */}
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
