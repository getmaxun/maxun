import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useSocketStore } from './socket';

export type PaginationType = 'scrollDown' | 'scrollUp' | 'clickNext' | 'clickLoadMore' | 'none' | '';
export type LimitType = '10' | '100' | 'custom' | '';
export type CaptureStage = 'initial' | 'pagination' | 'limit' | 'complete' | '';

interface ActionContextProps {
    getText: boolean;
    getList: boolean;
    getListAuto: boolean;
    getScreenshot: boolean;
    paginationMode: boolean;
    limitMode: boolean;
    paginationType: PaginationType;
    limitType: LimitType;
    customLimit: string;
    captureStage: CaptureStage; // New captureStage property
    setCaptureStage: (stage: CaptureStage) => void; // Setter for captureStage
    startPaginationMode: () => void;
    startGetText: () => void;
    stopGetText: () => void;
    startGetList: () => void;
    stopGetList: () => void;
    startGetListAuto: () => void;
    stopGetListAuto: () => void;
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
    const [getText, setGetText] = useState<boolean>(false);
    const [getList, setGetList] = useState<boolean>(false);
    const [getListAuto, setGetListAuto] = useState<boolean>(false);
    const [getScreenshot, setGetScreenshot] = useState<boolean>(false);
    const [paginationMode, setPaginationMode] = useState<boolean>(false);
    const [limitMode, setLimitMode] = useState<boolean>(false);
    const [paginationType, setPaginationType] = useState<PaginationType>('');
    const [limitType, setLimitType] = useState<LimitType>('');
    const [customLimit, setCustomLimit] = useState<string>('');
    const [captureStage, setCaptureStage] = useState<CaptureStage>('initial');

    console.log(`get list auto value: ${getListAuto}`)

    const { socket } = useSocketStore();

    const updatePaginationType = (type: PaginationType) => setPaginationType(type);
    const updateLimitType = (type: LimitType) => setLimitType(type);
    const updateCustomLimit = (limit: string) => setCustomLimit(limit);

    const startPaginationMode = () => {
        setPaginationMode(true);
        setCaptureStage('pagination');
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
        socket?.emit('setGetList', { getList: false });
        setPaginationType('');
        setLimitType('');
        setCustomLimit('');
        setCaptureStage('complete');
    };

    const startGetListAuto = () => {
        setGetListAuto(true);
        // socket?.emit('setGetListAuto', { getListAuto: true });
        socket?.emit('setGetList', { getList: true });
        setCaptureStage('initial');
    };
    
    const stopGetListAuto = () => {
        setGetListAuto(false);
        // socket?.emit('setGetListAuto', { getListAuto: false });
        socket?.emit('setGetList', { getList: true });
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
            getListAuto,
            getScreenshot,
            paginationMode,
            limitMode,
            paginationType,
            limitType,
            customLimit,
            captureStage,
            setCaptureStage,
            startGetText,
            stopGetText,
            startGetList,
            stopGetList,
            startGetListAuto,
            stopGetListAuto,
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
