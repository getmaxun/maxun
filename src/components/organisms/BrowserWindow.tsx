import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useSocketStore } from '../../context/socket';
import { Button } from '@mui/material';
import Canvas from "../atoms/canvas";
import { Highlighter } from "../atoms/Highlighter";
import { GenericModal } from '../atoms/GenericModal';
import { useActionContext } from '../../context/browserActions';
import { useBrowserSteps, TextStep } from '../../context/browserSteps';
import { useGlobalInfoStore } from '../../context/globalInfo';


interface ElementInfo {
    tagName: string;
    hasOnlyText?: boolean;
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

interface ChildData {
    data: string;
    selector: string;
    importance?: number; // Add other properties if needed
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
    const [canvasRef, setCanvasReference] = useState<React.RefObject<HTMLCanvasElement> | undefined>(undefined);
    const [screenShot, setScreenShot] = useState<string>("");
    const [highlighterData, setHighlighterData] = useState<{ rect: DOMRect, selector: string, elementInfo: ElementInfo | null, childSelectors?: string[], childData?: ChildData[] } | null>(null);
    const [showAttributeModal, setShowAttributeModal] = useState(false);
    const [showAutoExtractModal, setShowAutoExtractModal] = useState(false);
    const [attributeOptions, setAttributeOptions] = useState<AttributeOption[]>([]);
    const [selectedElement, setSelectedElement] = useState<{ selector: string, info: ElementInfo | null } | null>(null);
    const [currentListId, setCurrentListId] = useState<number | null>(null);
    const [isChildDataAvailable, setIsChildDataAvailable] = useState(false);

    const [listSelector, setListSelector] = useState<string | null>(null);
    const [fields, setFields] = useState<Record<string, TextStep>>({});
    const [paginationSelector, setPaginationSelector] = useState<string>('');

    const listSelectorRef = useRef<string | null>(null);

    const { socket } = useSocketStore();
    const { notify } = useGlobalInfoStore();
    const { getText, getList, getListAuto, paginationMode, paginationType, limitMode } = useActionContext();
    const { addTextStep, addListStep } = useBrowserSteps();

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
        listSelectorRef.current = null;
        setFields({});
        setCurrentListId(null);
    }, []);

    useEffect(() => {
        if (!getList || !getListAuto) {
            resetListState();
        }
    }, [getList, getListAuto, resetListState]);

    const screencastHandler = useCallback((data: string) => {
        setScreenShot(data);
    }, [screenShot]);

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

    const highlighterHandler = useCallback((data: { rect: DOMRect, selector: string, elementInfo: ElementInfo | null, childSelectors?: string[], childData?: ChildData[] }) => {
        if (getList === true || getListAuto === true) {
            if (listSelectorRef.current) {
                socket?.emit('listSelector', { selector: listSelectorRef.current });
    
                if (limitMode) {
                    setHighlighterData(null);
                } else if (paginationMode) {
                    // Only set highlighterData if type is valid for pagination
                    if (paginationType !== '' && !['none', 'scrollDown', 'scrollUp'].includes(paginationType)) {
                        setHighlighterData(data);
                    } else {
                        setHighlighterData(null);
                    }
                } else if (getList && data.childSelectors && data.childSelectors.includes(data.selector)) {
                    // For `getList`, highlight only valid child elements within the listSelector
                    setHighlighterData(data);
                } else if (getListAuto && data.childData) {
                    // For `getListAuto`, set highlighterData if childData is present
                    //onst { childSelectors, ...rest } = data;
                    setHighlighterData({ rect: data.rect, selector: data.selector, elementInfo: data.elementInfo, childData: data.childData });
                    setIsChildDataAvailable(true);
                } else {
                    // Clear the highlighter if not valid
                    setHighlighterData(null);
                }
            } else {
                // Set highlighterData for the initial listSelector selection
                setHighlighterData(data);
            }
        } else {
            // For non-list steps
            setHighlighterData(data);
        }
    }, [highlighterData, getList, getListAuto, socket, listSelector, paginationMode, paginationType]);
    
    // console.log('highlighterData', highlighterData);
    console.log('is child data available', isChildDataAvailable);

    useEffect(() => {
        document.addEventListener('mousemove', onMouseMove, false);
        if (socket) {
            socket.on("highlighter", highlighterHandler);
        }
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            socket?.off("highlighter", highlighterHandler);
        };
    }, [socket, onMouseMove]);

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (highlighterData && canvasRef?.current) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            const clickX = e.clientX - canvasRect.left;
            const clickY = e.clientY - canvasRect.top;

            const highlightRect = highlighterData.rect;
            if (
                clickX >= highlightRect.left &&
                clickX <= highlightRect.right &&
                clickY >= highlightRect.top &&
                clickY <= highlightRect.bottom
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
                            attribute
                        });
                    } else {
                        // Show the modal if there are multiple options
                        setAttributeOptions(options);
                        setSelectedElement({
                            selector: highlighterData.selector,
                            info: highlighterData.elementInfo
                        });
                        setShowAttributeModal(true);
                    }
                }

                if (paginationMode && (getList || getListAuto)) {
                    // Only allow selection in pagination mode if type is not empty, 'scrollDown', or 'scrollUp'
                    if (paginationType !== '' && paginationType !== 'scrollDown' && paginationType !== 'scrollUp' && paginationType !== 'none') {
                        setPaginationSelector(highlighterData.selector);
                        notify(`info`, `Pagination element selected successfully.`);
                        addListStep(listSelectorRef.current!, fields, currentListId || 0, { type: paginationType, selector: highlighterData.selector });
                    }
                    return;
                }

                if ((getList === true || getListAuto === true) && !listSelectorRef.current) {
                    // Set listSelectorRef and state
                    const newSelector = highlighterData.selector;
                    listSelectorRef.current = newSelector;
                    setListSelector(newSelector);
                    notify(`info`, `List selected successfully. Proceed to extract data.`);
                    
                    setCurrentListId(Date.now());
                    setFields({});

                    if (getListAuto) {
                        notify(`info`, `List container selected! Now click on any item inside the list to auto-extract all similar items.`); 
                        if (highlighterData.childData) {
                            handleAutoFieldPopulation(highlighterData.childData, newSelector);
                        } else {
                            notify(`error`, `No child data found for auto-extraction.`);
                        }
                    }
                
                    // Automatically handle field population for getListAuto mode
                    // if (getListAuto === true && highlighterData.childData) {
                    //     handleAutoFieldPopulation(highlighterData.childData, newSelector);
                    // }
                } else if ((getList === true || getListAuto === true) && listSelectorRef.current && currentListId) {
                    if (getListAuto === true && highlighterData.childData) {
                        handleAutoFieldPopulation(highlighterData.childData, listSelectorRef.current);
                    } else {
                        handleManualFieldPopulation(options, highlighterData, listSelectorRef.current);
                    }
                }
                
                
            }
        }
    };

    const handleAutoFieldPopulation = (childData: Array<any>, listSelector: string) => {
        setShowAutoExtractModal(true);
        setTimeout(() => {
            setShowAutoExtractModal(false);
        }, 3000);
    
        const newFields: Record<number, TextStep> = {};
        childData.forEach((child, index) => {
            const newField: TextStep = {
                id: Date.now() + index,
                type: 'text',
                label: `Label ${index + 1}`,
                data: child.data,
                selectorObj: {
                    selector: child.selector,
                    tag: '', // Can be updated if necessary
                    attribute: '', // Can be updated if necessary
                },
            };
    
            newFields[newField.id] = newField;
        });
    
        setFields(prevFields => ({
            ...prevFields,
            ...newFields,
        }));
    
            addListStep(listSelector, newFields, currentListId || Date.now(), { type: '', selector: paginationSelector });
    };

    const handleManualFieldPopulation = (
        options: AttributeOption[],
        highlighterData: any,
        listSelector: string
    ) => {
        const attribute = options[0].value;
        const data =
            attribute === 'href'
                ? highlighterData.elementInfo?.url || ''
                : attribute === 'src'
                ? highlighterData.elementInfo?.imageUrl || ''
                : highlighterData.elementInfo?.innerText || '';
    
        if (options.length === 1) {
            const newField: TextStep = {
                id: Date.now(),
                type: 'text',
                label: `Label ${Object.keys(fields).length + 1}`,
                data: data,
                selectorObj: {
                    selector: highlighterData.selector,
                    tag: highlighterData.elementInfo?.tagName,
                    attribute,
                },
            };
    
            setFields(prevFields => ({
                ...prevFields,
                [newField.id]: newField,
            }));
    
            addListStep(listSelector, { ...fields, [newField.id]: newField }, currentListId || Date.now(), { type: '', selector: paginationSelector });
        } else {
            setAttributeOptions(options);
            setSelectedElement({
                selector: highlighterData.selector,
                info: highlighterData.elementInfo,
            });
            setShowAttributeModal(true);
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
                        attribute: attribute
                    });
                }
                if ((getList === true) && listSelector && currentListId) {
                    const newField: TextStep = {
                        id: Date.now(),
                        type: 'text',
                        label: `Label ${Object.keys(fields).length + 1}`,
                        data: data,
                        selectorObj: {
                            selector: selectedElement.selector,
                            tag: selectedElement.info?.tagName,
                            attribute: attribute
                        }
                    };

                    setFields(prevFields => {
                        const updatedFields = {
                            ...prevFields,
                            [newField.id]: newField
                        };
                        return updatedFields;
                    });

                    if (listSelector) {
                        addListStep(listSelector, { ...fields, [newField.id]: newField }, currentListId, { type: '', selector: paginationSelector });
                    }
                }
            }
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

    // useEffect(() => {
    //     // Automatically populate fields when listSelector and childData are available
    //     if (listSelector && getListAuto && highlighterData?.childData && currentListId) {
    //         notify(`info`, `Auto extracting data...`);
    
    //         const newFields: Record<number, TextStep> = {};
    //         highlighterData.childData.forEach(child => {
    //             const newField: TextStep = {
    //                 id: Date.now(),
    //                 type: 'text',
    //                 label: `Label ${Object.keys(fields).length + 1}`,
    //                 data: child.data,
    //                 selectorObj: {
    //                     selector: child.selector,
    //                     tag: '',
    //                     attribute: ''
    //                 }
    //             };
    
    //             newFields[newField.id] = newField;
    //         });
    
    //         setFields(prevFields => ({ ...prevFields, ...newFields }));
    
    //         if (listSelector) {
    //             addListStep(listSelector, { ...fields, ...newFields }, currentListId, { type: '', selector: paginationSelector });
    //         }
    //     }
    // }, [listSelector, getListAuto, highlighterData?.childData, currentListId, fields]);
    

  
    return (
        <div onClick={handleClick} style={{ width: '900px' }} id="browser-window">
            {getListAuto === true ? ( 
                <GenericModal
                    isOpen={showAutoExtractModal}
                    onClose={() => { }}
                    canBeClosed={false}
                    modalStyle={modalStyle}
                >
                    <div>
                        <h2>Auto Extracting</h2>
                        <p>Most useful data, please wait for a few seconds...</p>
                        <p>Found {highlighterData?.childData?.length} items...</p>
                    </div>
                </GenericModal>
            ): null} 
            {
                getText === true || getList === true ? (
                    <GenericModal
                        isOpen={showAttributeModal}
                        onClose={() => { }}
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
            <div style={{ height: '400px', overflow: 'hidden' }}>
                {((getText === true || getList === true || getListAuto === true) && !showAttributeModal && highlighterData?.rect != null && highlighterData?.rect.top != null) && canvasRef?.current ?
                    <Highlighter
                        unmodifiedRect={highlighterData?.rect}
                        displayedSelector={highlighterData?.selector}
                        width={900}
                        height={400}
                        canvasRect={canvasRef.current.getBoundingClientRect()}
                    />
                    : null}
                <Canvas
                    onCreateRef={setCanvasReference}
                    width={900}
                    height={400}
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
        ctx?.drawImage(img, 0, 0, 900, 400);
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
