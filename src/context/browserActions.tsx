import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useSocketStore } from './socket';
import { WorkflowFile } from 'maxun-core';
import { emptyWorkflow } from '../shared/constants';

export type PaginationType = 'scrollDown' | 'scrollUp' | 'clickNext' | 'clickLoadMore' | 'none' | '';
export type LimitType = '10' | '100' | 'custom' | '';
export type CaptureStage = 'initial' | 'pagination' | 'limit' | 'complete' | '';
export type ActionType = 'text' | 'list' | 'screenshot';

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
    actionsInWorkflow: {
        text: boolean;
        list: boolean;
        screenshot: boolean;
    };
    activeAction: 'none' | 'text' | 'list' | 'screenshot';
    setActiveAction: (action: 'none' | 'text' | 'list' | 'screenshot') => void;
    setWorkflow: (workflow: WorkflowFile) => void;
    setShowPaginationOptions: (show: boolean) => void;
    setShowLimitOptions: (show: boolean) => void;
    setCaptureStage: (stage: CaptureStage) => void;
    startAction: (action: 'text' | 'list' | 'screenshot') => void;
    finishAction: (action: 'text' | 'list' | 'screenshot') => void;
    startGetText: () => void;
    stopGetText: () => void;
    startGetList: () => void;
    stopGetList: () => void;
    startGetScreenshot: () => void;
    stopGetScreenshot: () => void;
    startPaginationMode: () => void;
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
    const [actionsInWorkflow, setActionsInWorkflow] = useState({
        text: false,
        list: false,
        screenshot: false
    });
    const [activeAction, setActiveAction] = useState<'none' | 'text' | 'list' | 'screenshot'>('none');

    const { socket } = useSocketStore();

    const startAction = (action: 'text' | 'list' | 'screenshot') => {
        if (activeAction !== 'none') return;
        
        setActiveAction(action);
        
        if (action === 'text') {
            setGetText(true);
        } else if (action === 'list') {
            setGetList(true);
            socket?.emit('setGetList', { getList: true });
            setCaptureStage('initial');
        } else if (action === 'screenshot') {
            setGetScreenshot(true);
        }
    };
    
    const finishAction = (action: 'text' | 'list' | 'screenshot') => {
        if (activeAction !== action) return;
        
        setActionsInWorkflow(prev => ({
            ...prev,
            [action]: true
        }));
        
        setActiveAction('none');
        
        if (action === 'text') {
            setGetText(false);
        } else if (action === 'list') {
            setGetList(false);
            setPaginationType('');
            setLimitType('');
            setCustomLimit('');
            setCaptureStage('complete');
            socket?.emit('setGetList', { getList: false });
        } else if (action === 'screenshot') {
            setGetScreenshot(false);
        }
    };

    const updatePaginationType = (type: PaginationType) => setPaginationType(type);
    const updateLimitType = (type: LimitType) => setLimitType(type);
    const updateCustomLimit = (limit: string) => setCustomLimit(limit);

    const startPaginationMode = () => {
        setPaginationMode(true);
        setCaptureStage('pagination');
        socket?.emit('setGetList', { getList: false });
        socket?.emit('setPaginationMode', { pagination: true });
    };

    const stopPaginationMode = () => {
        setPaginationMode(false),
        socket?.emit('setPaginationMode', { pagination: false });
    };

    const startLimitMode = () => {
        setLimitMode(true);
        setCaptureStage('limit');
    };

    const stopLimitMode = () => setLimitMode(false);

    const startGetText = () => startAction('text');
    
    const stopGetText = () => {
        setGetText(false);
        setActiveAction('none');
    };
    
    const startGetList = () => startAction('list');
    
    const stopGetList = () => {
        setGetList(false);
        setPaginationType('');
        setLimitType('');
        setCustomLimit('');
        setCaptureStage('complete');
        setActiveAction('none');
    };
    
    const startGetScreenshot = () => startAction('screenshot');
    
    const stopGetScreenshot = () => {
        setGetScreenshot(false);
        setActiveAction('none');
    };

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
            actionsInWorkflow,
            activeAction,
            setActiveAction,
            setWorkflow,
            setShowPaginationOptions,   
            setShowLimitOptions,
            setCaptureStage,
            startAction,
            finishAction,
            startGetText,
            stopGetText,
            startGetList,
            stopGetList,
            startGetScreenshot,
            stopGetScreenshot,
            startPaginationMode,
            stopPaginationMode,
            updatePaginationType,
            startLimitMode,
            stopLimitMode,
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