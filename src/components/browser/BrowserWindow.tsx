import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Button } from '@mui/material';
import Canvas from "../recorder/canvas";
import { Highlighter } from "../recorder/Highlighter";
import { GenericModal } from '../ui/GenericModal';
import { useActionContext } from '../../context/browserActions';
import { useBrowserSteps, TextStep, ListStep, BrowserStep } from '../../context/browserSteps';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../context/auth';
import { coordinateMapper } from '../../helpers/coordinateMapper';
import { useBrowserDimensionsStore } from '../../context/browserDimensions';
import ListChildHighlighter from '../recorder/ListChildHighlighter';

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

    const [listSelector, setListSelector] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, TextStep>>({});
    const [paginationSelector, setPaginationSelector] = useState<string>('');
    const [listChildElements, setListChildElements] = useState<Array<{
        selector: string, 
        info: any, 
        selected: boolean,
        fieldId?: string
    }>>([]);
    const [listStepId, setListStepId] = useState<number | null>(null);
    const [shouldDisableRegularHighlighting, setShouldDisableRegularHighlighting] = useState(false);
    const [displayedFieldSelectors, setDisplayedFieldSelectors] = useState<Set<string>>(new Set());

    const { socket } = useSocketStore();
    const { notify } = useGlobalInfoStore();
    const { getText, getList, paginationMode, paginationType, captureStage, setChildSelectorsLoaded, childSelectorsLoaded } = useActionContext();
    const { addTextStep, addListStep, browserSteps, removeListTextField } = useBrowserSteps();
  
    const { state } = useContext(AuthContext);
    const { user } = state;

    const dimensions = {
        width: browserWidth,
        height: browserHeight
    };

    const hasSelectableItems = useMemo(() => {
        return listChildElements.some(el => !el.selected);
    }, [listChildElements]);

    const getLatestListStep = (steps: BrowserStep[]) => {
        const listSteps = steps.filter(step => step.type === 'list');
        if (listSteps.length === 0) return null;
        
        return listSteps.sort((a, b) => b.id - a.id)[0];
    };

    useEffect(() => {
        if (listStepId && getList && listSelector) {
            const currentStep = getLatestListStep(browserSteps);
            
            if (currentStep && currentStep.fields) {
                const activeSelectors = new Set<string>();
                Object.values(currentStep.fields).forEach(field => {
                    if (field.selectorObj?.selector) {
                        activeSelectors.add(field.selectorObj.selector);
                    }
                });
                
                setDisplayedFieldSelectors(activeSelectors);
                
                setListChildElements(prev => {
                    if (prev.length === 0) return prev;
                    
                    const newDeselectedItems = new Set<string>();
                    
                    const updatedElements = prev.map(el => {
                        const isSelected = activeSelectors.has(el.selector);
                        if (!isSelected) {
                            newDeselectedItems.add(el.selector);
                        }
                        return {
                            ...el,
                            selected: isSelected
                        };
                    });
                    
                    return updatedElements;
                });
            }
        }
    }, [browserSteps, listStepId, getList, listSelector]);

    useEffect(() => {
        if (socket) {
            socket.off('listChildElements');
            
            socket.on('listChildElements', (data) => {
                if (!childSelectorsLoaded) {
                    setHighlighterData(null);
                    
                    setShouldDisableRegularHighlighting(true);
                    setChildSelectorsLoaded(true);
                    
                    const currentStepId = currentListId || Date.now();
                    setListStepId(currentStepId);
                    setCurrentListId(currentStepId);
                    
                    if (data.childElements && data.childElements.length > 0) {
                        const fieldsObj: Record<string, TextStep> = {};
                        const activeSelectors = new Set<string>();
                        const addedDataValues = new Set<string>();
                        
                        const childElementsWithState = data.childElements
                            .filter((element: any) => {
                                const hasInnerText = element.info.innerText && element.info.innerText.trim() !== '';
                                const hasUrl = element.info.url && element.info.url.trim() !== '';
                                const hasImageUrl = element.info.imageUrl && element.info.imageUrl.trim() !== '';
                                const hasValue = element.info.value && element.info.value.trim() !== '';
                                
                                return hasInnerText || hasUrl || hasImageUrl || hasValue;
                            })
                            .flatMap((element: any, index: number) => {
                                const elementType = element.info.tagName;
                                const results = [];
                                
                                if (elementType === 'A' && element.info.innerText && element.info.url) {
                                    const textFieldData = element.info.innerText.trim();
                                    const urlFieldData = element.info.url.trim();
                                    
                                    if (textFieldData && !addedDataValues.has(textFieldData)) {
                                        const textFieldId = `${currentStepId}-${index}-text`;
                                        addedDataValues.add(textFieldData);
                                        activeSelectors.add(element.selector);
                                        
                                        fieldsObj[textFieldId] = {
                                            id: Date.now() + index,
                                            type: 'text',
                                            label: `Label ${Object.keys(fieldsObj).length + 1}`,
                                            data: textFieldData,
                                            selectorObj: {
                                                selector: element.selector,
                                                tag: elementType,
                                                shadow: element.info.isShadowRoot,
                                                attribute: 'innerText'
                                            }
                                        };
                                        
                                        results.push({
                                            ...element,
                                            selected: true,
                                            fieldId: textFieldId
                                        });
                                    }
                                    
                                    if (urlFieldData && !addedDataValues.has(urlFieldData)) {
                                        const urlFieldId = `${currentStepId}-${index}-url`;
                                        addedDataValues.add(urlFieldData);
                                        activeSelectors.add(element.selector);
                                        
                                        fieldsObj[urlFieldId] = {
                                            id: Date.now() + index + 1000, // Ensure unique ID
                                            type: 'text',
                                            label: `Label ${Object.keys(fieldsObj).length + 1}`,
                                            data: urlFieldData,
                                            selectorObj: {
                                                selector: element.selector,
                                                tag: elementType,
                                                shadow: element.info.isShadowRoot,
                                                attribute: 'href'
                                            }
                                        };
                                        
                                        // Only add a second entry if we need to highlight both aspects
                                        if (results.length === 0) {
                                            results.push({
                                                ...element,
                                                selected: true,
                                                fieldId: urlFieldId
                                            });
                                        }
                                    }
                                } else {
                                    // Handle other element types
                                    let attribute = 'innerText';
                                    let dataType = 'text';
                                    
                                    if (elementType === 'IMG') {
                                        attribute = 'src';
                                        dataType = 'image';
                                    } else if (elementType === 'INPUT') {
                                        attribute = 'value';
                                    }
                                    
                                    let fieldData = '';
                                    switch (attribute) {
                                        case 'src':
                                            fieldData = element.info.imageUrl || '';
                                            break;
                                        case 'href':
                                            fieldData = element.info.url || '';
                                            break;
                                        case 'value':
                                            fieldData = element.info.value || '';
                                            break;
                                        case 'innerText':
                                        default:
                                            fieldData = element.info.innerText || '';
                                            break;
                                    }
                                    
                                    fieldData = fieldData.trim();
                                    
                                    // Only add if it has data and isn't a duplicate
                                    if (fieldData && !addedDataValues.has(fieldData)) {
                                        const fieldId = `${currentStepId}-${index}`;
                                        addedDataValues.add(fieldData);
                                        activeSelectors.add(element.selector);
                                        
                                        fieldsObj[fieldId] = {
                                            id: Date.now() + index,
                                            type: 'text',
                                            label: `Label ${Object.keys(fieldsObj).length + 1}`,
                                            data: fieldData,
                                            selectorObj: {
                                                selector: element.selector,
                                                tag: elementType,
                                                shadow: element.info.isShadowRoot,
                                                attribute
                                            }
                                        };
                                        
                                        results.push({
                                            ...element,
                                            selected: true,
                                            fieldId
                                        });
                                    }
                                }
                                
                                return results;
                            });
                        
                        setListChildElements(childElementsWithState);
                        setDisplayedFieldSelectors(activeSelectors);
                        
                        if (Object.keys(fieldsObj).length > 0 && listSelector) {
                            setFields(fieldsObj);
                            
                            addListStep(
                                listSelector, 
                                fieldsObj, 
                                currentStepId, 
                                { type: '', selector: paginationSelector || '' }
                            );
                            
                            notify('success', `Added ${Object.keys(fieldsObj).length} fields to list`);
                        }
                    }
                } else {
                    console.log('Ignoring duplicate listChildElements event - child selectors already loaded');
                }
            });
            
            return () => {
                socket.off('listChildElements');
            };
        }
    }, [socket, listSelector, addListStep, notify, currentListId, setCurrentListId, paginationSelector, childSelectorsLoaded]);

    useEffect(() => {
        coordinateMapper.updateDimensions(dimensions.width, dimensions.height, viewportInfo.width, viewportInfo.height);
    }, [viewportInfo, dimensions.width, dimensions.height]);

    useEffect(() => {
        if (listSelector) {
            window.sessionStorage.setItem('recordingListSelector', listSelector);
        }
    }, [listSelector]);

    useEffect(() => {
        const storedListSelector = window.sessionStorage.getItem('recordingListSelector');
        
        // Only restore state if it exists in sessionStorage
        if (storedListSelector && !listSelector) {
            setListSelector(storedListSelector);
        }
    }, []); 

    const handleChildElementToggle = (element: any) => {
        if (element.selected === false) { 
            const elementToReselect = { ...element };
            
            const currentStep = getLatestListStep(browserSteps);
            
            if (!currentStep) {
                console.error("Could not find list step to update");
                return;
            }
            
            const currentFields = { ...currentStep.fields };
            const elementType = elementToReselect.info.tagName;
            
            // Special handling for anchor tags
            if (elementType === 'A' && elementToReselect.info.innerText && elementToReselect.info.url) {
                const textFieldId = `${listStepId}-${Date.now()}-text`;
                const urlFieldId = `${listStepId}-${Date.now()}-url`;
                
                const textField: TextStep = {
                    id: Date.now(),
                    type: 'text',
                    label: `Label ${Object.keys(currentFields).length + 1}`,
                    data: elementToReselect.info.innerText.trim(),
                    selectorObj: {
                        selector: elementToReselect.selector,
                        tag: elementType,
                        shadow: elementToReselect.info.isShadowRoot,
                        attribute: 'innerText'
                    }
                };
                
                const urlField: TextStep = {
                    id: Date.now() + 1000, // Ensure unique ID
                    type: 'text',
                    label: `Label ${Object.keys(currentFields).length + 1}`,
                    data: elementToReselect.info.url.trim(),
                    selectorObj: {
                        selector: elementToReselect.selector,
                        tag: elementType,
                        shadow: elementToReselect.info.isShadowRoot,
                        attribute: 'href'
                    }
                };
                
                const updatedFields = {
                    ...currentFields,
                    [textFieldId]: textField,
                    [urlFieldId]: urlField
                };
                
                if (listSelector) {
                    addListStep(
                        listSelector, 
                        updatedFields, 
                        listStepId || Date.now(), 
                        { type: '', selector: paginationSelector || '' }
                    );
                    
                    notify('success', `Re-added anchor with text and URL to list`);
                }
                
                setListChildElements(prev => 
                    prev.map(el => {
                        if (el.selector === elementToReselect.selector) {
                            return { ...el, selected: true, fieldId: textFieldId };
                        }
                        return el;
                    })
                );
                
                setDisplayedFieldSelectors(prev => {
                    const newSet = new Set(prev);
                    newSet.add(elementToReselect.selector);
                    return newSet;
                });
                
                if (highlighterData && highlighterData.selector === elementToReselect.selector) {
                    setHighlighterData(null);
                }
                
                return;
            }
            
            // Normal handling for other element types (unchanged)
            const fieldId = elementToReselect.fieldId || `${listStepId}-${Date.now()}`;
            let attribute = 'innerText';
            
            if (elementType === 'IMG') {
                attribute = 'src';
            } else if (elementType === 'INPUT') {
                attribute = 'value';
            }
            
            let fieldData = '';
            switch (attribute) {
                case 'src':
                    fieldData = elementToReselect.info.imageUrl || '';
                    break;
                case 'href':
                    fieldData = elementToReselect.info.url || '';
                    break;
                case 'value':
                    fieldData = elementToReselect.info.value || '';
                    break;
                case 'innerText':
                default:
                    fieldData = elementToReselect.info.innerText || '';
                    break;
            }
            
            fieldData = fieldData.trim();
            
            // Only proceed if we have actual data
            if (fieldData) {
                const newField: TextStep = {
                    id: Date.now(),
                    type: 'text',
                    label: `Label ${Object.keys(currentFields).length + 1}`,
                    data: fieldData,
                    selectorObj: {
                        selector: elementToReselect.selector,
                        tag: elementToReselect.info.tagName,
                        shadow: elementToReselect.info.isShadowRoot,
                        attribute
                    }
                };
                
                const updatedFields: any = {
                    ...currentFields,
                    [fieldId]: newField
                };

                if (listSelector) {
                    if (!(fieldId in updatedFields)) {
                        console.error("Failed to add field to updatedFields! Adding it explicitly.");
                        updatedFields[fieldId] = newField;
                    }

                    addListStep(
                        listSelector, 
                        updatedFields, 
                        listStepId || Date.now(), 
                        { type: '', selector: paginationSelector || '' }
                    );

                    notify('success', `Re-added field to list`);
                } else {
                    console.error("Cannot add to browserSteps: listSelector or listStepId is missing");
                }
                
                setListChildElements(prev => 
                    prev.map(el => {
                        if (el.selector === elementToReselect.selector) {
                            return { ...el, selected: true, fieldId };
                        }
                        return el;
                    })
                );
                
                setDisplayedFieldSelectors(prev => {
                    const newSet = new Set(prev);
                    newSet.add(elementToReselect.selector);
                    return newSet;
                });
                
                if (highlighterData && highlighterData.selector === elementToReselect.selector) {
                    setHighlighterData(null);
                }
            } else {
                console.warn("Attempted to add element with empty data, skipping");
            }
        } else {
            // Unchanged handling for deselection
            setListChildElements(prev => 
                prev.map(el => {
                    if (el.selector === element.selector) {
                        return { ...el, selected: false };
                    }
                    return el;
                })
            );
            
            setDisplayedFieldSelectors(prev => {
                const newSet = new Set(prev);
                newSet.delete(element.selector);
                return newSet;
            });
            
            if (element.fieldId && listStepId) {
                removeListTextField(listStepId, element.fieldId);
                notify('info', `Removed field from list`);
            }
        }
    };

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
        setShouldDisableRegularHighlighting(false);
        setDisplayedFieldSelectors(new Set());
        setListChildElements([]);
        setChildSelectorsLoaded(false);
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
        }
        if (canvasRef?.current) {
            drawImage(screenShot, canvasRef.current);
        } else {
            console.log('Canvas is not initialized');
        }
        return () => {
            socket?.off("screencast", screencastHandler);
        }
    }, [screenShot, canvasRef, socket, screencastHandler]);

    const shouldEnableHighlightingForElement = useCallback((selector: string) => {
        if (getList && listSelector && childSelectorsLoaded) {
            const element = listChildElements.find(el => el.selector === selector);
            return element && element.selected === false;
        }
        
        return true;
    }, [getList, listSelector, childSelectorsLoaded, listChildElements]);

    const highlighterHandler = useCallback((data: { 
        rect: DOMRect, 
        selector: string, 
        elementInfo: ElementInfo | null, 
        childSelectors?: string[],
        shadowInfo?: any
    }) => {
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
        
        if (getList === true && listSelector) {
            if (paginationMode) {
                if (paginationType !== '' && !['none', 'scrollDown', 'scrollUp'].includes(paginationType)) {
                    setHighlighterData(mappedData);
                } else {
                    setHighlighterData(null);
                }
                return; 
            }
            
            if (childSelectorsLoaded) {
                if (shouldEnableHighlightingForElement(mappedData.selector)) {
                    setHighlighterData(mappedData);
                } else {
                    setHighlighterData(null);
                }
                return;
            }
            
            const hasValidChildSelectors = Array.isArray(mappedData.childSelectors) && mappedData.childSelectors.length > 0;
            
            if (hasValidChildSelectors) {
                setHighlighterData(mappedData);
            } else {
                setHighlighterData(null);
            }
            return; 
        }
        
        if (getList === true && !listSelector) {
            setHighlighterData(mappedData);
            return; 
        }
        
        if (getText === true) {
            setHighlighterData(mappedData);
            return;
        }
        
        setHighlighterData(null);
    }, [getList, getText, listSelector, paginationMode, paginationType, childSelectorsLoaded, shouldEnableHighlightingForElement]);

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
    }, [socket, highlighterHandler, onMouseMove]);

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

    const handleAttributeSelection = (attribute: string) => {
        if (!selectedElement) {
            setShowAttributeModal(false);
            return;
        }
            
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
        
        if (getText) {
            addTextStep('', data, {
                selector: selectedElement.selector,
                tag: selectedElement.info?.tagName,
                shadow: selectedElement.info?.isShadowRoot,
                attribute: attribute
            });
            notify('success', `Added text: ${data.substring(0, 30)}${data.length > 30 ? '...' : ''}`);
        } else if (getList && listSelector && currentListId) {
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

            addListStep(
                listSelector, 
                updatedFields, 
                currentListId, 
                { type: '', selector: paginationSelector }
            );
            
            notify('success', `Added field to list`);
        }
        
        setShowAttributeModal(false);
    };

    const resetPaginationSelector = useCallback(() => {
        setPaginationSelector('');
    }, []);

    useEffect(() => {
        if (!paginationMode) {
            resetPaginationSelector();
        }
    }, [paginationMode, resetPaginationSelector]);

    const shouldEnableAnyHighlighting = useMemo(() => {
        if (getList && listSelector && childSelectorsLoaded) {
            return hasSelectableItems;
        }
        return true; 
    }, [getList, listSelector, childSelectorsLoaded, hasSelectableItems]);

    const renderChildHighlighter = () => {
        if (getList && listSelector && listChildElements.length > 0 && canvasRef?.current) {
            return (
                <ListChildHighlighter
                    childElements={listChildElements}
                    canvasRect={canvasRef.current.getBoundingClientRect()}
                    onChildElementClick={handleChildElementToggle}
                    displayedFieldSelectors={displayedFieldSelectors}
                />
            );
        }
        return null;
    };

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!highlighterData || !canvasRef?.current) return;
        
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - canvasRect.left;
        const clickY = e.clientY - canvasRect.top;

        const mappedRect = coordinateMapper.mapBrowserRectToCanvas(highlighterData.rect);
        
        // Check if click is within the highlighted area
        if (
            clickX < mappedRect.left ||
            clickX > mappedRect.right ||
            clickY < mappedRect.top ||
            clickY > mappedRect.bottom
        ) {
            return;
        }

        if (getList && listSelector && childSelectorsLoaded) {
            const element = listChildElements.find(el => el.selector === highlighterData.selector);
            
            if (element && element.selected === false) {
                handleChildElementToggle(element);
                return;
            }
            
            if (paginationMode) {
                if (paginationType !== '' && 
                    !['none', 'scrollDown', 'scrollUp'].includes(paginationType)) {
                    setPaginationSelector(highlighterData.selector);
                    notify(`info`, t('browser_window.attribute_modal.notifications.pagination_select_success'));
                    addListStep(
                        listSelector, 
                        fields, 
                        currentListId || 0, 
                        { type: paginationType, selector: highlighterData.selector }
                    );
                    socket?.emit('setPaginationMode', { pagination: false });
                }
                return;
            }
            
            return;
        }

        if (getText) {
            const options = getAttributeOptions(highlighterData.elementInfo?.tagName || '', highlighterData.elementInfo);
            
            if (options.length === 1) {
                const attribute = options[0].value;
                const data = attribute === 'href' ? highlighterData.elementInfo?.url || '' :
                    attribute === 'src' ? highlighterData.elementInfo?.imageUrl || '' :
                    highlighterData.elementInfo?.innerText || '';

                addTextStep('', data, {
                    selector: highlighterData.selector,
                    tag: highlighterData.elementInfo?.tagName,
                    shadow: highlighterData.elementInfo?.isShadowRoot,
                    attribute
                });
                
                notify('success', `Added text: ${data.substring(0, 30)}${data.length > 30 ? '...' : ''}`);
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

        if (getList && !listSelector) {
            let cleanedSelector = highlighterData.selector;
            if (cleanedSelector.includes('nth-child')) {
                cleanedSelector = cleanedSelector.replace(/:nth-child\(\d+\)/g, '');
            }

            setListSelector(cleanedSelector);
            notify(`info`, t('browser_window.attribute_modal.notifications.list_select_success'));
            setCurrentListId(Date.now());
            setFields({});
            
            if (socket) {
                socket.emit('setGetList', { getList: true });
                socket.emit('listSelector', { selector: cleanedSelector });
            }
            
            return;
        } 
        
        if (getList && listSelector && currentListId && !childSelectorsLoaded) {
            const options = getAttributeOptions(highlighterData.elementInfo?.tagName || '', highlighterData.elementInfo);
            
            if (options.length === 1) {
                const attribute = options[0].value;
                const data = attribute === 'href' ? highlighterData.elementInfo?.url || '' :
                    attribute === 'src' ? highlighterData.elementInfo?.imageUrl || '' :
                    highlighterData.elementInfo?.innerText || '';
                        
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
                        { type: '', selector: paginationSelector }
                    );
                    
                    notify('success', `Added new field to list`);
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
    };

    return (
        <div onClick={handleClick} style={{ width: browserWidth }} id="browser-window">
            {/* Attribute selection modal */}
            {(getText || getList) && showAttributeModal && (
                <GenericModal
                    isOpen={showAttributeModal}
                    onClose={() => {}}
                    canBeClosed={false}
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
            )}
            
            <div style={{ height: dimensions.height, overflow: 'hidden' }}>
                {highlighterData && canvasRef?.current && !showAttributeModal && (
                    (getText === true) || 
                    (getList === true && !listSelector) || 
                    (getList === true && listSelector && !shouldDisableRegularHighlighting && 
                     highlighterData.childSelectors?.includes(highlighterData.selector))
                ) && (
                    <Highlighter
                        unmodifiedRect={highlighterData.rect}
                        displayedSelector={highlighterData.selector}
                        width={dimensions.width}
                        height={dimensions.height}
                        canvasRect={canvasRef.current.getBoundingClientRect()}
                    />
                )}

                {highlighterData && canvasRef?.current && !showAttributeModal &&
                 paginationMode && paginationType !== '' && 
                 !['none', 'scrollDown', 'scrollUp'].includes(paginationType) && (
                    <Highlighter
                        unmodifiedRect={highlighterData.rect}
                        displayedSelector={highlighterData.selector}
                        width={dimensions.width}
                        height={dimensions.height}
                        canvasRect={canvasRef.current.getBoundingClientRect()}
                    />
                )}

                {highlighterData && canvasRef?.current && !showAttributeModal &&
                 getList && listSelector && childSelectorsLoaded && 
                 shouldEnableAnyHighlighting &&
                 listChildElements.find(el => 
                    el.selector === highlighterData.selector && 
                    el.selected === false
                 ) && (
                    <Highlighter
                        unmodifiedRect={highlighterData.rect}
                        displayedSelector={highlighterData.selector}
                        width={dimensions.width}
                        height={dimensions.height}
                        canvasRect={canvasRef.current.getBoundingClientRect()}
                        isDeselected={true}
                    />
                )}

                {renderChildHighlighter()}
                
                {/* Canvas for displaying the browser screenshot */}
                <Canvas
                    onCreateRef={setCanvasReference}
                    width={dimensions.width}
                    height={dimensions.height}
                />
            </div>
        </div>
    );
};

const drawImage = (image: string, canvas: HTMLCanvasElement): void => {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = image;
    img.onload = () => {
        URL.revokeObjectURL(img.src);
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
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
