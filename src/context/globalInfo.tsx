import React, { createContext, useContext, useState } from "react";
import { AlertSnackbarProps } from "../components/atoms/AlertSnackbar";


interface GlobalInfo {
  browserId: string | null;
  setBrowserId: (newId: string | null) => void;
  lastAction: string;
  setLastAction: (action: string) => void;
  notification: AlertSnackbarProps;
  notify: (severity: 'error' | 'warning' | 'info' | 'success', message: string) => void;
  closeNotify: () => void;
  recordings: string[];
  setRecordings: (recordings: string[]) => void;
  rerenderRuns: boolean;
  setRerenderRuns: (rerenderRuns: boolean) => void;
  recordingLength: number;
  setRecordingLength: (recordingLength: number) => void;
  recordingId: string | null;
  setRecordingId: (newId: string | null) => void;
  recordingName: string;
  setRecordingName: (recordingName: string) => void;
  recordingUrl: string;
  setRecordingUrl: (recordingUrl: string) => void;
  isLogin: boolean;
  setIsLogin: (isLogin: boolean) => void;
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
  recordings: string[] = [];
  rerenderRuns = false;
  recordingName = '';
  recordingUrl = 'https://';
  isLogin = false;
  currentWorkflowActionsState = {
    hasScrapeListAction: false,
    hasScreenshotAction: false,
    hasScrapeSchemaAction: false,
  };
};

const globalInfoStore = new GlobalInfoStore();
const globalInfoContext = createContext<GlobalInfo>(globalInfoStore as GlobalInfo);

export const useGlobalInfoStore = () => useContext(globalInfoContext);

export const GlobalInfoProvider = ({ children }: { children: JSX.Element }) => {
  const [browserId, setBrowserId] = useState<string | null>(globalInfoStore.browserId);
  const [lastAction, setLastAction] = useState<string>(globalInfoStore.lastAction);
  const [notification, setNotification] = useState<AlertSnackbarProps>(globalInfoStore.notification);
  const [recordings, setRecordings] = useState<string[]>(globalInfoStore.recordings);
  const [rerenderRuns, setRerenderRuns] = useState<boolean>(globalInfoStore.rerenderRuns);
  const [recordingLength, setRecordingLength] = useState<number>(globalInfoStore.recordingLength);
  const [recordingId, setRecordingId] = useState<string | null>(globalInfoStore.recordingId);
  const [recordingName, setRecordingName] = useState<string>(globalInfoStore.recordingName);
  const [recordingUrl, setRecordingUrl] = useState<string>(globalInfoStore.recordingUrl);
  const [isLogin, setIsLogin] = useState<boolean>(globalInfoStore.isLogin);
  const [currentWorkflowActionsState, setCurrentWorkflowActionsState] = useState(globalInfoStore.currentWorkflowActionsState);

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

  return (
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
        recordingLength,
        setRecordingLength,
        recordingId,
        setRecordingId,
        recordingName,
        setRecordingName,
        recordingUrl,
        setRecordingUrl,
        isLogin,
        setIsLogin,
        currentWorkflowActionsState,
        setCurrentWorkflowActionsState,
      }}
    >
      {children}
    </globalInfoContext.Provider>
  );
};
