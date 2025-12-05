import React, { createContext, useContext, useState } from "react";
import { AlertSnackbarProps } from "../components/ui/AlertSnackbar";
import { WhereWhatPair } from "maxun-core";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { getStoredRuns, getStoredRecordings } from "../api/storage";

const createDataCacheClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    }
  }
});

const dataCacheKeys = {
  runs: ['cached-runs'] as const,
  recordings: ['cached-recordings'] as const,
} as const;

interface RobotMeta {
    name: string;
    id: string;
    createdAt: string;
    pairs: number;
    updatedAt: string;
    params: any[];
    type?: 'extract' | 'scrape';
    url?: string;
    formats?: ('markdown' | 'html' | 'screenshot-visible' | 'screenshot-fullpage')[];
}

interface RobotWorkflow {
    workflow: WhereWhatPair[];
}

interface ScheduleConfig {
    runEvery: number;
    runEveryUnit: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';
    startFrom: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
    atTimeStart?: string;
    atTimeEnd?: string;
    timezone: string;
    lastRunAt?: Date;
    nextRunAt?: Date;
    cronExpression?: string;
}

interface ProcessedSnapshot {
  snapshot: any;
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
  processingStats: any;
}

export interface RobotSettings {
    id: string;
    userId?: number;
    recording_meta: RobotMeta;
    recording: RobotWorkflow;
    google_sheet_email?: string | null;
    google_sheet_name?: string | null;
    google_sheet_id?: string | null;
    google_access_token?: string | null;
    google_refresh_token?: string | null;
    schedule?: ScheduleConfig | null;
}

interface GlobalInfo {
  browserId: string | null;
  setBrowserId: (newId: string | null) => void;
  lastAction: string;
  setLastAction: (action: string) => void;
  notification: AlertSnackbarProps;
  notify: (severity: 'error' | 'warning' | 'info' | 'success', message: string) => void;
  closeNotify: () => void;
  isLogin: boolean;
  setIsLogin: (isLogin: boolean) => void;
  recordings: string[];
  setRecordings: (recordings: string[]) => void;
  rerenderRuns: boolean;
  setRerenderRuns: (rerenderRuns: boolean) => void;
  rerenderRobots: boolean;
  setRerenderRobots: (rerenderRuns: boolean) => void;
  recordingLength: number;
  setRecordingLength: (recordingLength: number) => void;
  recordingId: string | null;
  setRecordingId: (newId: string | null) => void;
  retrainRobotId: string | null;
  setRetrainRobotId: (newId: string | null) => void;
  recordingName: string;
  setRecordingName: (recordingName: string) => void;
  initialUrl: string;
  setInitialUrl: (initialUrl: string) => void;
  recordingUrl: string;
  setRecordingUrl: (recordingUrl: string) => void;
  currentWorkflowActionsState: {
    hasScrapeListAction: boolean;
    hasScreenshotAction: boolean;
    hasScrapeSchemaAction: boolean;
  };
  setCurrentWorkflowActionsState: (actionsState: {
    hasScrapeListAction: boolean;
    hasScreenshotAction: boolean;
    hasScrapeSchemaAction: boolean;
  }) => void;
  shouldResetInterpretationLog: boolean;
  resetInterpretationLog: () => void;
  currentTextActionId: string;
  setCurrentTextActionId: (actionId: string) => void;
  currentListActionId: string;
  setCurrentListActionId: (actionId: string) => void;
  currentScreenshotActionId: string;
  setCurrentScreenshotActionId: (actionId: string) => void;
  currentTextGroupName: string;
  setCurrentTextGroupName: (name: string) => void;
  isDOMMode: boolean;
  setIsDOMMode: (isDOMMode: boolean) => void;
  currentSnapshot: ProcessedSnapshot | null;
  setCurrentSnapshot: (snapshot: ProcessedSnapshot | null) => void;
  updateDOMMode: (isDOMMode: boolean, snapshot?: ProcessedSnapshot | null) => void;
};

class GlobalInfoStore implements Partial<GlobalInfo> {
  browserId = null;
  lastAction = '';
  recordingLength = 0;
  notification: AlertSnackbarProps = {
    severity: 'info',
    message: '',
    isOpen: false,
  };
  recordingId = null;
  retrainRobotId = null;
  recordings: string[] = [];
  rerenderRuns = false;
  rerenderRobots = false;
  recordingName = '';
  initialUrl = 'https://';
  recordingUrl = 'https://';
  isLogin = false;
  currentWorkflowActionsState = {
    hasScrapeListAction: false,
    hasScreenshotAction: false,
    hasScrapeSchemaAction: false,
  };
  shouldResetInterpretationLog = false;
  currentTextActionId = '';
  currentListActionId = '';
  currentScreenshotActionId = '';
  currentTextGroupName = 'Text Data';
  isDOMMode = false;
  currentSnapshot = null;
};

const globalInfoStore = new GlobalInfoStore();
const globalInfoContext = createContext<GlobalInfo>(globalInfoStore as GlobalInfo);

export const useGlobalInfoStore = () => useContext(globalInfoContext);

export const useCachedRuns = () => {
  return useQuery({
    queryKey: dataCacheKeys.runs,
    queryFn: async () => {
      const runs = await getStoredRuns();
      if (!runs) throw new Error('Failed to fetch runs data');
      return runs.map((run: any, index: number) => ({ id: index, ...run }));
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
};

export const useCacheInvalidation = () => {
  const queryClient = useQueryClient();
  
  const invalidateRuns = () => {
    queryClient.invalidateQueries({ queryKey: dataCacheKeys.runs });
  };
  
  const invalidateRecordings = () => {
    queryClient.invalidateQueries({ queryKey: dataCacheKeys.recordings });
  };
  
  const addOptimisticRun = (newRun: any) => {
    queryClient.setQueryData(dataCacheKeys.runs, (oldData: any) => {
      if (!oldData) return [{ id: 0, ...newRun }];
      return [{ id: oldData.length, ...newRun }, ...oldData];
    });
  };
  
  const invalidateAllCache = () => {
    invalidateRuns();
    invalidateRecordings();
  };
  
  return {
    invalidateRuns,
    invalidateRecordings, 
    addOptimisticRun,
    invalidateAllCache
  };
};

export const useCachedRecordings = () => {
  return useQuery({
    queryKey: dataCacheKeys.recordings,
    queryFn: async () => {
      const recordings = await getStoredRecordings();
      if (!recordings) throw new Error('Failed to fetch recordings data');
      return recordings;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
};

export const GlobalInfoProvider = ({ children }: { children: JSX.Element }) => {
  const [browserId, setBrowserId] = useState<string | null>(globalInfoStore.browserId);
  const [lastAction, setLastAction] = useState<string>(globalInfoStore.lastAction);
  const [notification, setNotification] = useState<AlertSnackbarProps>(globalInfoStore.notification);
  const [recordings, setRecordings] = useState<string[]>(globalInfoStore.recordings);
  const [rerenderRuns, setRerenderRuns] = useState<boolean>(globalInfoStore.rerenderRuns);
  const [rerenderRobots, setRerenderRobots] = useState<boolean>(globalInfoStore.rerenderRobots);
  const [recordingLength, setRecordingLength] = useState<number>(globalInfoStore.recordingLength);
  // const [recordingId, setRecordingId] = useState<string | null>(globalInfoStore.recordingId);
   const [recordingId, setRecordingId] = useState<string | null>(() => {
    try {
      const stored = sessionStorage.getItem('recordingId');
      return stored ? JSON.parse(stored) : globalInfoStore.recordingId;
    } catch {
      return globalInfoStore.recordingId;
    }
  });

  // Create a wrapped setter that persists to sessionStorage
  const setPersistedRecordingId = (newRecordingId: string | null) => {
    setRecordingId(newRecordingId);
    try {
      if (newRecordingId) {
        sessionStorage.setItem('recordingId', JSON.stringify(newRecordingId));
      } else {
        sessionStorage.removeItem('recordingId');
      }
    } catch (error) {
      console.warn('Failed to persist recordingId to sessionStorage:', error);
    }
  };
  const [retrainRobotId, setRetrainRobotId] = useState<string | null>(globalInfoStore.retrainRobotId);
  const [recordingName, setRecordingName] = useState<string>(globalInfoStore.recordingName);
  const [isLogin, setIsLogin] = useState<boolean>(globalInfoStore.isLogin);
  const [initialUrl, setInitialUrl] = useState<string>(globalInfoStore.initialUrl);
  const [recordingUrl, setRecordingUrl] = useState<string>(globalInfoStore.recordingUrl);
  const [currentWorkflowActionsState, setCurrentWorkflowActionsState] = useState(globalInfoStore.currentWorkflowActionsState);
  const [shouldResetInterpretationLog, setShouldResetInterpretationLog] = useState<boolean>(globalInfoStore.shouldResetInterpretationLog);
  const [currentTextActionId, setCurrentTextActionId] = useState<string>('');
  const [currentListActionId, setCurrentListActionId] = useState<string>('');
  const [currentScreenshotActionId, setCurrentScreenshotActionId] = useState<string>('');
  const [currentTextGroupName, setCurrentTextGroupName] = useState<string>('Text Data');
  const [isDOMMode, setIsDOMMode] = useState<boolean>(globalInfoStore.isDOMMode);
  const [currentSnapshot, setCurrentSnapshot] = useState<ProcessedSnapshot | null>(globalInfoStore.currentSnapshot);

  const notify = (severity: 'error' | 'warning' | 'info' | 'success', message: string) => {
    setNotification({ severity, message, isOpen: true });
  }

  const closeNotify = () => {
    setNotification(globalInfoStore.notification);
  }

  const setBrowserIdWithValidation = (browserId: string | null) => {
    setBrowserId(browserId);
    if (!browserId) {
      setRecordingLength(0);
    }
  }

  const resetInterpretationLog = () => {
    setShouldResetInterpretationLog(true);
    // Reset the flag after a short delay to allow components to respond
    setTimeout(() => {
      setShouldResetInterpretationLog(false);
    }, 100);
  }

  const updateDOMMode = (mode: boolean, snapshot?: ProcessedSnapshot | null) => {
    setIsDOMMode(mode);
    
    if (snapshot !== undefined) {
      setCurrentSnapshot(snapshot);
    }
    
    if (!mode) {
      setCurrentSnapshot(null);
    }
  }

  const [dataCacheClient] = useState(() => createDataCacheClient());

  return (
    <QueryClientProvider client={dataCacheClient}>
      <globalInfoContext.Provider
        value={{
        browserId,
        setBrowserId: setBrowserIdWithValidation,
        lastAction,
        setLastAction,
        notification,
        notify,
        closeNotify,
        recordings,
        setRecordings,
        rerenderRuns,
        setRerenderRuns,
        rerenderRobots,
        setRerenderRobots,
        recordingLength,
        setRecordingLength,
        recordingId,
        setRecordingId: setPersistedRecordingId,
        retrainRobotId,
        setRetrainRobotId,
        recordingName,
        setRecordingName,
        initialUrl,
        setInitialUrl,
        recordingUrl,
        setRecordingUrl,
        isLogin,
        setIsLogin,
        currentWorkflowActionsState,
        setCurrentWorkflowActionsState,
        shouldResetInterpretationLog,
        resetInterpretationLog,
        currentTextActionId,
        setCurrentTextActionId,
        currentListActionId,
        setCurrentListActionId,
        currentScreenshotActionId,
        setCurrentScreenshotActionId,
        currentTextGroupName,
        setCurrentTextGroupName,
        isDOMMode,
        setIsDOMMode,
        currentSnapshot,
        setCurrentSnapshot,
        updateDOMMode,
        }}
      >
        {children}
      </globalInfoContext.Provider>
    </QueryClientProvider>
  );
};
