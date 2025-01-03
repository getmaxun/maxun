import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useSocketStore } from './socket';
import { WorkflowFile } from 'maxun-core';
import { emptyWorkflow } from '../shared/constants';

export type PaginationType = 'scrollDown' | 'scrollUp' | 'clickNext' | 'clickLoadMore' | 'none' | '';
export type LimitType = '10' | '100' | 'custom' | '';
export type CaptureStage = 'initial' | 'pagination' | 'limit' | 'complete' | '';

interface ActionContextProps {
    getText: boolean;
    getList: boolean;
    getScreenshot: boolean;
    paginationMode: boolean;
    limitMode: boolean;
    paginationType: PaginationType;
    limitType: LimitType;
    workflow: WorkflowFile;
    customLimit: string;
    captureStage: CaptureStage;
    showPaginationOptions: boolean;
    showLimitOptions: boolean;
    setWorkflow: (workflow: WorkflowFile) => void;
    setShowPaginationOptions: (show: boolean) => void;
    setShowLimitOptions: (show: boolean) => void;
    setCaptureStage: (stage: CaptureStage) => void;
    startPaginationMode: () => void;
    startGetText: () => void;
    stopGetText: () => void;
    startGetList: () => void;
    stopGetList: () => void;
    startGetScreenshot: () => void;
    stopGetScreenshot: () => void;
    stopPaginationMode: () => void;
    updatePaginationType: (type: PaginationType) => void;
    startLimitMode: () => void;
    stopLimitMode: () => void;
    updateLimitType: (type: LimitType) => void;
    updateCustomLimit: (limit: string) => void;
}

const ActionContext = createContext<ActionContextProps | undefined>(undefined);

export const ActionProvider = ({ children }: { children: ReactNode }) => {
    const [workflow, setWorkflow] = useState<WorkflowFile>(emptyWorkflow);
    const [getText, setGetText] = useState<boolean>(false);
    const [getList, setGetList] = useState<boolean>(false);
    const [getScreenshot, setGetScreenshot] = useState<boolean>(false);
    const [paginationMode, setPaginationMode] = useState<boolean>(false);
    const [limitMode, setLimitMode] = useState<boolean>(false);
    const [paginationType, setPaginationType] = useState<PaginationType>('');
    const [limitType, setLimitType] = useState<LimitType>('');
    const [customLimit, setCustomLimit] = useState<string>('');
    const [captureStage, setCaptureStage] = useState<CaptureStage>('initial');
    const [showPaginationOptions, setShowPaginationOptions] = useState(false);
    const [showLimitOptions, setShowLimitOptions] = useState(false);

    const { socket } = useSocketStore();

    const updatePaginationType = (type: PaginationType) => setPaginationType(type);
    const updateLimitType = (type: LimitType) => setLimitType(type);
    const updateCustomLimit = (limit: string) => setCustomLimit(limit);

    const startPaginationMode = () => {
        setPaginationMode(true);
        setCaptureStage('pagination');
        socket?.emit('setGetList', { getList: false });
    };

    const stopPaginationMode = () => setPaginationMode(false);

    const startLimitMode = () => {
        setLimitMode(true);
        setCaptureStage('limit');
    };

    const stopLimitMode = () => setLimitMode(false);

    const startGetText = () => setGetText(true);
    const stopGetText = () => setGetText(false);

    const startGetList = () => {
        setGetList(true);
        socket?.emit('setGetList', { getList: true });
        setCaptureStage('initial');
    }

    const stopGetList = () => {
        setGetList(false);
        setPaginationType('');
        setLimitType('');
        setCustomLimit('');
        setCaptureStage('complete');
    };

    const startGetScreenshot = () => setGetScreenshot(true);
    const stopGetScreenshot = () => setGetScreenshot(false);

    return (
        <ActionContext.Provider value={{
            getText,
            getList,
            getScreenshot,
            paginationMode,
            limitMode,
            paginationType,
            limitType,
            workflow,
            customLimit,
            captureStage,
            showPaginationOptions,
            showLimitOptions,
            setWorkflow,
            setShowPaginationOptions,   
            setShowLimitOptions,
            setCaptureStage,
            startGetText,
            stopGetText,
            startGetList,
            stopGetList,
            startGetScreenshot,
            stopGetScreenshot,
            startPaginationMode,
            stopPaginationMode,
            startLimitMode,
            stopLimitMode,
            updatePaginationType,
            updateLimitType,
            updateCustomLimit
        }}>
            {children}
        </ActionContext.Provider>
    );
};

export const useActionContext = () => {
    const context = useContext(ActionContext);
    if (context === undefined) {
        throw new Error('useActionContext must be used within an ActionProvider');
    }
    return context;
};
