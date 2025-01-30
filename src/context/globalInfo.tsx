import React, { createContext, useContext, useState } from "react";
import { AlertSnackbarProps } from "../components/ui/AlertSnackbar";
import { WhereWhatPair } from "maxun-core";

interface RobotMeta {
    name: string;
    id: string;
    createdAt: string;
    pairs: number;
    updatedAt: string;
    params: any[];
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
  robot: RobotSettings | null;
  setRobot: (robot: RobotSettings | null | ((prev: RobotSettings | null) => RobotSettings | null)) => void;
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
  robot = null;
  recordings: string[] = [];
  rerenderRuns = false;
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
  const [isLogin, setIsLogin] = useState<boolean>(globalInfoStore.isLogin);
  const [initialUrl, setInitialUrl] = useState<string>(globalInfoStore.initialUrl);
  const [recordingUrl, setRecordingUrl] = useState<string>(globalInfoStore.recordingUrl);
  const [currentWorkflowActionsState, setCurrentWorkflowActionsState] = useState(globalInfoStore.currentWorkflowActionsState);
  const [shouldResetInterpretationLog, setShouldResetInterpretationLog] = useState<boolean>(globalInfoStore.shouldResetInterpretationLog);
  const [robot, setRobot] = useState<RobotSettings | null>(null);

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
        robot,
        setRobot,
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
      }}
    >
      {children}
    </globalInfoContext.Provider>
  );
};
