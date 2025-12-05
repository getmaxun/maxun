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
                  validSelectors.push(selector);
                  continue;
                }
              } catch (accessError) {
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

            return elements;
          } catch (err) {
            console.error("XPath evaluation failed:", xpath, err);
            return [];
          }
        };

        const isValidData = (text: string | null | undefined): boolean => {
          return !!text && text.trim().length > 0;
        };

        const isElementVisible = (element: HTMLElement): boolean => {
          try {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          } catch (error) {
            return false;
          }
        };

        const createFieldData = (element: HTMLElement, selector: string, forceAttribute?: string) => {
          const tagName = element.tagName.toLowerCase();
          let data = '';
          let attribute = forceAttribute || 'innerText';

          if (forceAttribute) {
            if (forceAttribute === 'href') {
              data = element.getAttribute('href') || '';
            } else if (forceAttribute === 'innerText') {
              data = (element.textContent || '').trim();
            }
          } else if (tagName === 'img') {
            data = element.getAttribute('src') || '';
            attribute = 'src';
          } else if (tagName === 'a') {
            const href = element.getAttribute('href') || '';
            const text = (element.textContent || '').trim();
            if (href && href !== '#' && !href.startsWith('javascript:')) {
              data = href;
              attribute = 'href';
            } else if (text) {
              data = text;
              attribute = 'innerText';
            }
          } else {
            data = (element.textContent || '').trim();
            attribute = 'innerText';
          }

          if (!data) return null;

          return {
            data,
            selectorObj: {
              selector,
              attribute,
              tag: tagName.toUpperCase(),
              isShadow: element.getRootNode() instanceof ShadowRoot
            }
          };
        };

        const validatedChildSelectors = validateChildSelectors(uniqueChildSelectors);

        validatedChildSelectors.forEach((selector, index) => {
          try {
            const listElements = evaluateXPathAllWithShadowSupport(
            iframeElement.contentDocument!,
            listSelector,
            listSelector.includes(">>") || listSelector.startsWith("//")
          );

          if (listElements.length === 0) return;

          const hasNumericPredicate = /\[\d+\](?![^\[]*@)/.test(selector);

          if (hasNumericPredicate && listElements.length >= 3) {
            const allMatches = evaluateXPathAllWithShadowSupport(
              iframeElement.contentDocument!,
              selector,
              selector.includes(">>") || selector.startsWith("//")
            );

            const matchRatio = allMatches.length / listElements.length;

            if (matchRatio < 0.6) {
              return;
            }
          }

          const firstListElement = listElements[0];
              
            const elements = evaluateXPathAllWithShadowSupport(
              iframeElement.contentDocument!,
              selector,
              selector.includes(">>") || selector.startsWith("//")
            ).filter(el => firstListElement.contains(el as Node));

            if (elements.length === 0) return;

            const element = elements[0] as HTMLElement;
            const tagName = element.tagName.toLowerCase();
            const isShadow = element.getRootNode() instanceof ShadowRoot;

            if (isElementVisible(element)) {
              const rect = element.getBoundingClientRect();
              const position = { x: rect.left, y: rect.top };

              if (tagName === 'a') {
                const href = element.getAttribute('href');
                const text = (element.textContent || '').trim();

                if (text && isValidData(text)) {
                  const textField = createFieldData(element, selector, 'innerText');
                  if (textField && textField.data) {
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
                        label: `Label ${index * 2 + 1}`,
                        data: textField.data,
                        selectorObj: textField.selectorObj
                      }
                    });
                  }
                }

                if (href && href !== '#' && !href.startsWith('javascript:')) {
                  const hrefField = createFieldData(element, selector, 'href');
                  if (hrefField && hrefField.data) {
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
                        label: `Label ${index * 2 + 2}`,
                        data: hrefField.data,
                        selectorObj: hrefField.selectorObj
                      }
                    });
                  }
                }
              } else if (tagName === "img") {
                const src = element.getAttribute("src");

                if (src && isValidData(src)) {
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
                        selector: selector,
                        tag: element.tagName,
                        isShadow: isShadow,
                        attribute: "src",
                      },
                    },
                  });
                }
              } else {
                const fieldData = createFieldData(element, selector);

                if (fieldData && fieldData.data && isValidData(fieldData.data)) {
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
                      data: fieldData.data,
                      selectorObj: fieldData.selectorObj
                    }
                  });
                  const anchorParent = element.closest('a');
                  if (anchorParent) {
                    const href = anchorParent.getAttribute('href');
                    if (href && href !== '#' && !href.startsWith('javascript:') && isValidData(href)) {
                      let anchorSelector = selector;
                      if (selector.includes('/a[')) {
                        const anchorMatch = selector.match(/(.*\/a\[[^\]]+\])/);
                        if (anchorMatch) {
                          anchorSelector = anchorMatch[1];
                        }
                      }

                  const fieldId = Date.now() + index * 1000 + 500;
                  candidateFields.push({
                    id: fieldId,
                    element: anchorParent as HTMLElement,
                    isLeaf: true,
                    depth: 0,
                    position: position,
                    field: {
                      id: fieldId,
                      type: "text",
                      label: `Label ${index + 1} Link`,
                      data: href,
                      selectorObj: {
                        selector: anchorSelector,
                        attribute: 'href',
                        tag: 'A',
                        isShadow: anchorParent.getRootNode() instanceof ShadowRoot,
                        fallbackSelector: generateFallbackSelector(anchorParent as HTMLElement)
                      }
                    }
                  });
                }
              }
            }
          }
        } catch (error) {
            console.warn(`Failed to process child selector ${selector}:`, error);
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
        const cleanedCandidates = filteredCandidates.filter((candidate) => {
        const data = candidate.field.data.trim();

        const textChildren = Array.from(candidate.element.children).filter(child =>
          (child.textContent || '').trim().length > 0
        );

        if (textChildren.length === 0) {
          return true;
        }

        const childCandidates = filteredCandidates.filter((other) => {
          if (other === candidate) return false;
          return candidate.element.contains(other.element);
        });

        if (childCandidates.length === 0) {
          return true;
        }

        let coveredLength = 0;
        childCandidates.forEach(child => {
          const childText = child.field.data.trim();
          if (data.includes(childText)) {
            coveredLength += childText.length;
          }
        });

        const coverageRatio = coveredLength / data.length;
        const hasMultipleChildTexts = childCandidates.length >= 2;
        const highCoverage = coverageRatio > 0.7;

        return !(hasMultipleChildTexts && highCoverage);
      });

      const finalFields = removeDuplicateContent(cleanedCandidates);
      return finalFields;
      },
      [currentSnapshot]
    );

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
      if (currentListActionId && browserSteps.length > 0) {
        const activeStep = browserSteps.find(
          s => s.type === 'list' && s.actionId === currentListActionId
        ) as ListStep | undefined;

        if (activeStep) {
          if (currentListId !== activeStep.id) {
            setCurrentListId(activeStep.id);
          }
          if (listSelector !== activeStep.listSelector) {
            setListSelector(activeStep.listSelector);
          }
          if (JSON.stringify(fields) !== JSON.stringify(activeStep.fields)) {
            setFields(activeStep.fields);
          }
          if (activeStep.pagination?.selector && paginationSelector !== activeStep.pagination.selector) {
            setPaginationSelector(activeStep.pagination.selector);
          }
        }
      }
    }, [currentListActionId, browserSteps, currentListId, listSelector, fields, paginationSelector]);
  
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
            let targetListId = currentListId;
            let targetFields = fields;

            if ((!targetListId || targetListId === 0) && currentListActionId) {
              const activeStep = browserSteps.find(
                s => s.type === 'list' && s.actionId === currentListActionId
              ) as ListStep | undefined;

              if (activeStep) {
                targetListId = activeStep.id;
                if (Object.keys(targetFields).length === 0 && Object.keys(activeStep.fields).length > 0) {
                  targetFields = activeStep.fields;
                }
              }
            }

            setPaginationSelector(highlighterData.selector);
            notify(
              `info`,
              t(
                "browser_window.attribute_modal.notifications.pagination_select_success"
              )
            );
            addListStep(
                listSelector!,
                targetFields,
                targetListId || 0,
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
        highlighterData,
        browserSteps
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
              let targetListId = currentListId;
              let targetFields = fields;

              if ((!targetListId || targetListId === 0) && currentListActionId) {
                const activeStep = browserSteps.find(
                  s => s.type === 'list' && s.actionId === currentListActionId
                ) as ListStep | undefined;

                if (activeStep) {
                  targetListId = activeStep.id;
                  if (Object.keys(targetFields).length === 0 && Object.keys(activeStep.fields).length > 0) {
                    targetFields = activeStep.fields;
                  }
                }
              }

              setPaginationSelector(highlighterData.selector);
              notify(
                `info`,
                t(
                  "browser_window.attribute_modal.notifications.pagination_select_success"
                )
              );
              addListStep(
                listSelector!,
                targetFields,
                targetListId || 0,
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

    useEffect(() => {
     if (!paginationMode || !getList) {
       setHighlighterData(null);
     }
    }, [paginationMode, getList]);

    useEffect(() => {
      if (paginationMode && currentListActionId) {
        const currentListStep = browserSteps.find(
          step => step.type === 'list' && step.actionId === currentListActionId
        ) as (ListStep & { type: 'list' }) | undefined;

        const currentSelector = currentListStep?.pagination?.selector;
        const currentType = currentListStep?.pagination?.type;

        if (['clickNext', 'clickLoadMore'].includes(paginationType)) {
          if (!currentSelector || (currentType && currentType !== paginationType)) {
            setPaginationSelector('');
          }
        }

        const stepSelector = currentListStep?.pagination?.selector;

        if (stepSelector && !paginationSelector) {
          setPaginationSelector(stepSelector);
        } else if (!stepSelector && paginationSelector) {
          setPaginationSelector('');
        }
      }
    }, [browserSteps, paginationMode, currentListActionId, paginationSelector]);

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
                      (getList && paginationMode && !paginationSelector && paginationType !== "" && 
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
                      captureStage === 'initial' &&
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
                paginationSelector={paginationSelector}
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
