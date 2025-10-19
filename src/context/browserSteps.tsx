import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useSocketStore } from "./socket";
import { useGlobalInfoStore } from "./globalInfo";

export interface TextStep {
    id: number;
    type: 'text';
    label: string;
    data: string;
    isShadow?: boolean;
    selectorObj: SelectorObject;
    actionId?: string;
    name?: string;
}

export interface ScreenshotStep {
    id: number;
    type: 'screenshot';
    name?: string;
    fullPage: boolean;
    actionId?: string;
    screenshotData?: string;
}

export interface ListStep {
    id: number;
    type: 'list';
    name?: string;
    listSelector: string;
    isShadow?: boolean;
    fields: { [key: string]: TextStep };
    pagination?: {
        type: string;
        selector: string;
        isShadow?: boolean;
    };
    limit?: number;
    actionId?: string;
    data?: any[];
}

export type BrowserStep = TextStep | ScreenshotStep | ListStep;

export interface SelectorObject {
    selector: string;
    isShadow?: boolean;
    tag?: string;
    attribute?: string;
    [key: string]: any;
}

interface BrowserStepsContextType {
    browserSteps: BrowserStep[];
    addTextStep: (
        label: string,
        data: string,
        selectorObj: SelectorObject,
        actionId: string
    ) => void;
    addListStep: (
        listSelector: string,
        fields: { [key: string]: TextStep },
        listId: number,
        actionId: string,
        pagination?: {
            type: string;
            selector: string;
            isShadow?: boolean;
        },
        limit?: number,
        isShadow?: boolean
    ) => void;
    addScreenshotStep: (fullPage: boolean, actionId: string) => void;
    deleteBrowserStep: (id: number) => void;
    updateBrowserTextStepLabel: (id: number, newLabel: string) => void;
    updateListTextFieldLabel: (
        listId: number,
        fieldKey: string,
        newLabel: string
    ) => void;
    updateListStepLimit: (listId: number, limit: number) => void;
    updateListStepData: (listId: number, extractedData: any[]) => void;
    updateListStepName: (listId: number, name: string) => void;
    updateScreenshotStepName: (id: number, name: string) => void;
    removeListTextField: (listId: number, fieldKey: string) => void;
    deleteStepsByActionId: (actionId: string) => void;
    updateScreenshotStepData: (id: number, screenshotData: string) => void;
    emitActionForStep: (step: BrowserStep) => void;
    emitForStepId: (actionId: string, nameOverride?: string) => void;
}

const BrowserStepsContext = createContext<BrowserStepsContextType | undefined>(undefined);

export const BrowserStepsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { socket } = useSocketStore();
    const { currentTextGroupName } = useGlobalInfoStore();
    const [browserSteps, setBrowserSteps] = useState<BrowserStep[]>([]);
    const [discardedFields, setDiscardedFields] = useState<Set<string>>(new Set());

    const browserStepsRef = useRef<BrowserStep[]>(browserSteps);
    useEffect(() => {
        browserStepsRef.current = browserSteps;
    }, [browserSteps]);

    const currentTextGroupNameRef = useRef(currentTextGroupName);

    useEffect(() => {
        currentTextGroupNameRef.current = currentTextGroupName;
    }, [currentTextGroupName]);

    const getListSettingsObject = (listStep: ListStep) => {
        const fields: Record<string, {
            selector: string;
            tag?: string;
            [key: string]: any;
            isShadow?: boolean;
        }> = {};

        Object.entries(listStep.fields).forEach(([id, field]) => {
            if (field.selectorObj?.selector) {
                fields[field.label] = {
                    selector: field.selectorObj.selector,
                    tag: field.selectorObj.tag,
                    attribute: field.selectorObj.attribute,
                    isShadow: field.selectorObj.isShadow
                };
            }
        });

        return {
            listSelector: listStep.listSelector,
            fields: fields,
            pagination: {
                type: listStep.pagination?.type || "",
                selector: listStep.pagination?.selector,
                isShadow: listStep.isShadow
            },
            limit: listStep.limit,
            isShadow: listStep.isShadow
        };
    };

    const emitActionForStep = (step: BrowserStep) => {
        if (!socket) return;
        if (!step.actionId) return;
        if (!socket.connected) return;

        let action = "";
        let settings: any = {};

        // Always read the latest steps from the ref to prevent stale data
        const latestSteps = browserStepsRef.current;

        if (step.type === "list") {
            action = "scrapeList";
            const baseSettings = getListSettingsObject(step);
            settings = {
                ...baseSettings,
                name: step.name || `List Data ${latestSteps.filter(s => s.type === "list").length}`,
            };

        } else if (step.type === "text") {
            action = "scrapeSchema";

            const freshTextSteps = latestSteps.filter(
                (s): s is TextStep => s.type === "text" && s.actionId === step.actionId
            );

            // Build schema settings from text steps
            const fieldSettings: Record<
                string,
                {
                    selector: string;
                    tag?: string;
                    [key: string]: any;
                }
            > = {};

            freshTextSteps.forEach((textStep) => {
                if (textStep.selectorObj?.selector && textStep.label) {
                    fieldSettings[textStep.label] = {
                        selector: textStep.selectorObj.selector,
                        tag: textStep.selectorObj.tag,
                        attribute: textStep.selectorObj.attribute,
                        isShadow: textStep.selectorObj.isShadow,
                    };
                }
            });

            settings = {
                ...fieldSettings,
                name: currentTextGroupNameRef.current || "Text Data",
            };

        } else if (step.type === "screenshot") {
            action = "screenshot";

            const freshScreenshot = latestSteps.find(
                (s) => s.type === "screenshot" && s.actionId === step.actionId
            ) as ScreenshotStep | undefined;

            settings = {
                name:
                    step.name ||
                    freshScreenshot?.name ||
                    `Screenshot ${latestSteps.filter((s) => s.type === "screenshot").length}`,
                type: "png",
                caret: "hide",
                scale: "device",
                timeout: 30000,
                fullPage: freshScreenshot?.fullPage ?? step.fullPage ?? true,
                animations: "allow",
            };
        }

        socket.emit("action", { action, actionId: step.actionId, settings });
    };

    const emitForStepId = (actionId: string, nameOverride?: string) => {
        const step = browserStepsRef.current.find(s => s.actionId === actionId);
        if (!step) return;

        let enrichedStep = { ...step };

        if (step.type === "text") {
            enrichedStep = { ...step, name: currentTextGroupNameRef.current };
        }

        if (step.type === "screenshot") {
            const freshScreenshot = browserStepsRef.current.find(
                s => s.type === "screenshot" && s.actionId === actionId
            ) as ScreenshotStep | undefined;

            if (freshScreenshot) {
                enrichedStep = { ...freshScreenshot };

                if (nameOverride && freshScreenshot.name !== nameOverride) {
                    enrichedStep.name = nameOverride;
                    browserStepsRef.current = browserStepsRef.current.map(s =>
                        s.id === freshScreenshot.id ? { ...s, name: nameOverride } : s
                    );
                    setBrowserSteps(prev =>
                        prev.map(s =>
                            s.id === freshScreenshot.id ? { ...s, name: nameOverride } : s
                        )
                    );
                }
            }
        }

        if (step.type === "list") {
            const freshList = browserStepsRef.current.find(
                s => s.type === "list" && s.actionId === actionId
            ) as ListStep | undefined;

            if (freshList) {
                enrichedStep = { ...freshList };
            }
        }

        emitActionForStep(enrichedStep);
    };

    const addTextStep = (label: string, data: string, selectorObj: SelectorObject, actionId: string) => {
        setBrowserSteps((prevSteps) => {
            const textCount = prevSteps.filter(s => s.type === 'text').length + 1;
            const generatedLabel = label || `Label ${textCount}`;
            return [
                ...prevSteps,
                {
                    id: Date.now(),
                    type: "text",
                    label: generatedLabel,
                    data,
                    selectorObj,
                    actionId,
                },
            ];
        });
    };

    const addListStep = (
        listSelector: string,
        newFields: { [key: string]: TextStep },
        listId: number,
        actionId: string,
        pagination?: {
            type: string;
            selector: string;
            isShadow?: boolean;
        },
        limit?: number,
        isShadow?: boolean
    ) => {
        setBrowserSteps((prevSteps) => {
            const existingListStepIndex = prevSteps.findIndex(
                (step) => step.type === "list" && step.id === listId
            );

            if (existingListStepIndex !== -1) {
                const updatedSteps = [...prevSteps];
                const existingListStep = updatedSteps[
                    existingListStepIndex
                ] as ListStep;

                // Preserve existing labels for fields
                const mergedFields = Object.entries(newFields).reduce(
                    (acc, [key, field]) => {
                        if (!discardedFields.has(`${listId}-${key}`)) {
                            // If field exists, preserve its label
                            if (existingListStep.fields[key]) {
                                acc[key] = {
                                    ...field,
                                    label: existingListStep.fields[key].label,
                                    actionId,
                                };
                            } else {
                                acc[key] = {
                                    ...field,
                                    actionId,
                                };
                            }
                        }
                        return acc;
                    },
                    {} as { [key: string]: TextStep }
                );

                updatedSteps[existingListStepIndex] = {
                    ...existingListStep,
                    listSelector,
                    fields: mergedFields,
                    pagination: pagination || existingListStep.pagination,
                    limit: limit,
                    isShadow: isShadow !== undefined ? isShadow : existingListStep.isShadow,
                    actionId,
                };
                return updatedSteps;
            } else {
                const fieldsWithActionId = Object.entries(newFields).reduce(
                    (acc, [key, field]) => {
                        acc[key] = {
                            ...field,
                            actionId,
                        };
                        return acc;
                    },
                    {} as { [key: string]: TextStep }
                );

                const listCount = prevSteps.filter(s => s.type === 'list').length + 1;
                return [
                    ...prevSteps,
                    {
                        id: listId,
                        type: "list",
                        name: `List Data ${listCount}`,
                        listSelector,
                        fields: fieldsWithActionId,
                        pagination,
                        limit,
                        actionId,
                    },
                ];
            }
        });
    };

    const addScreenshotStep = (fullPage: boolean, actionId: string) => {
        setBrowserSteps(prevSteps => [
            ...prevSteps,
            { id: Date.now(), type: 'screenshot', fullPage, actionId }
        ]);
    };

    const deleteBrowserStep = (id: number) => {
        setBrowserSteps(prevSteps => prevSteps.filter(step => step.id !== id));
    };

    const deleteStepsByActionId = (actionId: string) => {
        setBrowserSteps(prevSteps => prevSteps.filter(step => step.actionId !== actionId));
    };

    const updateBrowserTextStepLabel = (id: number, newLabel: string) => {
        setBrowserSteps(prevSteps =>
            prevSteps.map(step =>
                step.id === id ? { ...step, label: newLabel } : step
            )
        );
    };

    const updateListTextFieldLabel = (
        listId: number,
        fieldKey: string,
        newLabel: string
    ) => {
        setBrowserSteps((prevSteps) =>
            prevSteps.map((step) => {
                if (step.type === "list" && step.id === listId) {
                    const oldLabel = step.fields[fieldKey].label;

                    const updatedFields = {
                        ...step.fields,
                        [fieldKey]: {
                            ...step.fields[fieldKey],
                            label: newLabel,
                        },
                    };

                    const updatedData = step.data?.map((row: any) => {
                        if (row[oldLabel] !== undefined) {
                            const { [oldLabel]: value, ...rest } = row;
                            return {
                                ...rest,
                                [newLabel]: value,
                            };
                        }
                        return row;
                    });

                    return {
                        ...step,
                        fields: updatedFields,
                        data: updatedData,
                    };
                }
                return step;
            })
        );
    };

    const updateListStepData = (listId: number, extractedData: any[]) => {
        setBrowserSteps((prevSteps) => {
          return prevSteps.map(step => {
            if (step.type === 'list' && step.id === listId) {
              return {
                ...step,
                data: extractedData
              };
            }
            return step;
          });
        });
    };

    const updateScreenshotStepData = (id: number, screenshotData: string) => {
        setBrowserSteps(prevSteps => {
            return prevSteps.map(step => {
                if (step.type === 'screenshot' && step.id === id) {
                    return {
                        ...step,
                        screenshotData: screenshotData
                    };
                }
                return step;
            });
        });
    };

    const updateListStepLimit = (listId: number, limit: number) => {
        setBrowserSteps(prevSteps =>
            prevSteps.map(step => {
                if (step.type === 'list' && step.id === listId) {
                    return {
                        ...step,
                        limit: limit
                    };
                }
                return step;
            })
        );
    };

    const updateListStepName = (listId: number, name: string) => {
        setBrowserSteps((prevSteps) =>
            prevSteps.map((step) => {
                if (step.type === "list" && step.id === listId) {
                    return {
                        ...step,
                        name: name,
                    };
                }
                return step;
            })
        );
    };

    const updateScreenshotStepName = (id: number, name: string) => {
        setBrowserSteps(prevSteps => {
            const updated = prevSteps.map(step =>
                step.id === id && step.type === 'screenshot'
                    ? { ...step, name }
                    : step
            );
            browserStepsRef.current = updated;
            return updated;
        });
    };

    const removeListTextField = (listId: number, fieldKey: string) => {
        setBrowserSteps((prevSteps) =>
            prevSteps.map((step) => {
                if (step.type === "list" && step.id === listId) {
                    const { [fieldKey]: _, ...remainingFields } = step.fields;
                    return {
                        ...step,
                        fields: remainingFields,
                    };
                }
                return step;
            })
        );
        setDiscardedFields((prevDiscarded) =>
            new Set(prevDiscarded).add(`${listId}-${fieldKey}`)
        );
    };
    return (
        <BrowserStepsContext.Provider
            value={{
                browserSteps,
                addTextStep,
                addListStep,
                addScreenshotStep,
                deleteBrowserStep,
                updateBrowserTextStepLabel,
                updateListTextFieldLabel,
                updateListStepLimit,
                updateListStepData,
                updateListStepName,
                updateScreenshotStepName,
                removeListTextField,
                deleteStepsByActionId,
                updateScreenshotStepData,
                emitActionForStep,
                emitForStepId
            }}
        >
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
