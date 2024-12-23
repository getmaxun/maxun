import React, { createContext, useContext, useState } from 'react';

export interface TextStep {
    id: number;
    type: 'text';
    label: string;
    data: string;
    selectorObj: SelectorObject;
}

interface ScreenshotStep {
    id: number;
    type: 'screenshot';
    fullPage: boolean;
}

export interface ListStep {
    id: number;
    type: 'list';
    listSelector: string;
    fields: { [key: string]: TextStep };
    pagination?: {
        type: string;
        selector: string;
    };
    limit?: number;
}

type BrowserStep = TextStep | ScreenshotStep | ListStep;

export interface SelectorObject {
    selector: string;
    tag?: string;
    attribute?: string;
    [key: string]: any;
}

interface BrowserStepsContextType {
    browserSteps: BrowserStep[];
    addTextStep: (label: string, data: string, selectorObj: SelectorObject) => void;
    addListStep: (listSelector: string, fields: { [key: string]: TextStep }, listId: number, pagination?: { type: string; selector: string }, limit?: number) => void
    addScreenshotStep: (fullPage: boolean) => void;
    deleteBrowserStep: (id: number) => void;
    updateBrowserTextStepLabel: (id: number, newLabel: string) => void;
    updateListTextFieldLabel: (listId: number, fieldKey: string, newLabel: string) => void;
    removeListTextField: (listId: number, fieldKey: string) => void;
}

const BrowserStepsContext = createContext<BrowserStepsContextType | undefined>(undefined);

export const BrowserStepsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [browserSteps, setBrowserSteps] = useState<BrowserStep[]>([]);
    const [discardedFields, setDiscardedFields] = useState<Set<string>>(new Set());

    const addTextStep = (label: string, data: string, selectorObj: SelectorObject) => {
        setBrowserSteps(prevSteps => [
            ...prevSteps,
            { id: Date.now(), type: 'text', label, data, selectorObj }
        ]);
    };

    const addListStep = (listSelector: string, newFields: { [key: string]: TextStep }, listId: number, pagination?: { type: string; selector: string }, limit?: number) => {
        setBrowserSteps(prevSteps => {
            const existingListStepIndex = prevSteps.findIndex(step => step.type === 'list' && step.id === listId);
            
            if (existingListStepIndex !== -1) {
                const updatedSteps = [...prevSteps];
                const existingListStep = updatedSteps[existingListStepIndex] as ListStep;
    
                // Preserve existing labels for fields
                const mergedFields = Object.entries(newFields).reduce((acc, [key, field]) => {
                    if (!discardedFields.has(`${listId}-${key}`)) {
                        // If field exists, preserve its label
                        if (existingListStep.fields[key]) {
                            acc[key] = {
                                ...field,
                                label: existingListStep.fields[key].label
                            };
                        } else {
                            acc[key] = field;
                        }
                    }
                    return acc;
                }, {} as { [key: string]: TextStep });
    
                updatedSteps[existingListStepIndex] = {
                    ...existingListStep,
                    fields: mergedFields,
                    pagination: pagination || existingListStep.pagination,
                    limit: limit
                };
                return updatedSteps;
            } else {
                return [
                    ...prevSteps,
                    { id: listId, type: 'list', listSelector, fields: newFields, pagination, limit }
                ];
            }
        });
    };

    const addScreenshotStep = (fullPage: boolean) => {
        setBrowserSteps(prevSteps => [
            ...prevSteps,
            { id: Date.now(), type: 'screenshot', fullPage }
        ]);
    };

    const deleteBrowserStep = (id: number) => {
        setBrowserSteps(prevSteps => prevSteps.filter(step => step.id !== id));
    };

    const updateBrowserTextStepLabel = (id: number, newLabel: string) => {
        setBrowserSteps(prevSteps =>
            prevSteps.map(step =>
                step.id === id ? { ...step, label: newLabel } : step
            )
        );
    };

    const updateListTextFieldLabel = (listId: number, fieldKey: string, newLabel: string) => {
        setBrowserSteps(prevSteps =>
            prevSteps.map(step => {
                if (step.type === 'list' && step.id === listId) {
                    // Ensure deep copy of the fields object
                    const updatedFields = {
                        ...step.fields,
                        [fieldKey]: {
                            ...step.fields[fieldKey],
                            label: newLabel
                        }
                    };

                    return {
                        ...step,
                        fields: updatedFields
                    };
                }
                return step;
            })
        );
    };

    const removeListTextField = (listId: number, fieldKey: string) => {
        setBrowserSteps(prevSteps =>
            prevSteps.map(step => {
                if (step.type === 'list' && step.id === listId) {
                    const { [fieldKey]: _, ...remainingFields } = step.fields;
                    return {
                        ...step,
                        fields: remainingFields
                    };
                }
                return step;
            })
        );
        setDiscardedFields(prevDiscarded => new Set(prevDiscarded).add(`${listId}-${fieldKey}`));
    };
    return (
        <BrowserStepsContext.Provider value={{
            browserSteps,
            addTextStep,
            addListStep,
            addScreenshotStep,
            deleteBrowserStep,
            updateBrowserTextStepLabel,
            updateListTextFieldLabel,
            removeListTextField,
        }}>
            {children}
        </BrowserStepsContext.Provider>
    );
};

export const useBrowserSteps = () => {
    const context = useContext(BrowserStepsContext);
    if (!context) {
        throw new Error('useBrowserSteps must be used within a BrowserStepsProvider');
    }
    return context;
};
