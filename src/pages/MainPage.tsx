import React, { useCallback, useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MainMenu } from "../components/dashboard/MainMenu";
import { Stack } from "@mui/material";
import { Recordings } from "../components/robot/Recordings";
import { Runs } from "../components/run/Runs";
import ProxyForm from '../components/proxy/ProxyForm';
import ApiKey from '../components/api/ApiKey';
import { useGlobalInfoStore } from "../context/globalInfo";
import { createAndRunRecording, createRunForStoredRecording, CreateRunResponseWithQueue, interpretStoredRecording, notifyAboutAbort, scheduleStoredRecording } from "../api/storage";
import { io, Socket } from "socket.io-client";
import { stopRecording } from "../api/recording";
import { RunSettings } from "../components/run/RunSettings";
import { ScheduleSettings } from "../components/robot/ScheduleSettings";
import { apiUrl } from "../apiConfig";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/auth';

interface MainPageProps {
  handleEditRecording: (id: string, fileName: string) => void;
  initialContent: string;
}

export interface CreateRunResponse {
  browserId: string;
  runId: string;
  robotMetaId: string;
}

export interface ScheduleRunResponse {
  message: string;
  runId: string;
}

export const MainPage = ({ handleEditRecording, initialContent }: MainPageProps) => {
  const { t } = useTranslation();
  const [content, setContent] = React.useState(initialContent);
  const [sockets, setSockets] = React.useState<Socket[]>([]);
  const [runningRecordingId, setRunningRecordingId] = React.useState('');
  const [runningRecordingName, setRunningRecordingName] = React.useState('');
  const [currentInterpretationLog, setCurrentInterpretationLog] = React.useState('');
  const [ids, setIds] = React.useState<CreateRunResponse>({
    browserId: '',
    runId: '',
    robotMetaId: ''
  });
  const [queuedRuns, setQueuedRuns] = React.useState<Set<string>>(new Set());

  let aborted = false;

  const { notify, setRerenderRuns, setRecordingId } = useGlobalInfoStore();
  const navigate  = useNavigate();

  const { state } = useContext(AuthContext);
  const { user } = state;

  const abortRunHandler = (runId: string) => {
    aborted = true;
    notifyAboutAbort(runId).then(async (response) => {
      if (response) {
        notify('success', t('main_page.notifications.abort_success', { name: runningRecordingName }));
        await stopRecording(ids.browserId);
      } else {
        notify('error', t('main_page.notifications.abort_failed', { name: runningRecordingName }));
      }
    })
  }

  const setRecordingInfo = (id: string, name: string) => {
    setRunningRecordingId(id);
    setRecordingId(id);
    setRunningRecordingName(name);
  }

  const readyForRunHandler = useCallback((browserId: string, runId: string) => {
    interpretStoredRecording(runId).then(async (interpretation: boolean) => {
      if (!aborted) {
        if (interpretation) {
          // notify('success', t('main_page.notifications.interpretation_success', { name: runningRecordingName }));
        } else {
          notify('success', t('main_page.notifications.interpretation_failed', { name: runningRecordingName }));
          // destroy the created browser
          await stopRecording(browserId);
        }
      }
      setRunningRecordingName('');
      setCurrentInterpretationLog('');
      setRerenderRuns(true);
    })
  }, [runningRecordingName, aborted, currentInterpretationLog, notify, setRerenderRuns]);

  const debugMessageHandler = useCallback((msg: string) => {
    setCurrentInterpretationLog((prevState) =>
      prevState + '\n' + `[${new Date().toLocaleString()}] ` + msg);
  }, [currentInterpretationLog])

  const handleRunRecording = useCallback((settings: RunSettings) => {
    createAndRunRecording(runningRecordingId, settings).then((response: CreateRunResponseWithQueue) => {
      const { browserId, runId, robotMetaId, queued } = response;
      
      setIds({ browserId, runId, robotMetaId });
      navigate(`/runs/${robotMetaId}/run/${runId}`);
            
      if (queued) {
        console.log('Creating queue socket for queued run:', runId); 
        
        setQueuedRuns(prev => new Set([...prev, runId]));
        
        const queueSocket = io(`${apiUrl}/queued-run`, {
          transports: ["websocket"],
          rejectUnauthorized: false,
          query: { userId: user?.id }
        });
        
        queueSocket.on('connect', () => {
          console.log('Queue socket connected for user:', user?.id);
        });
        
        queueSocket.on('connect_error', (error) => {
          console.log('Queue socket connection error:', error);
        });
        
        queueSocket.on('run-completed', (completionData) => {
          if (completionData.runId === runId) {  
            setRunningRecordingName('');
            setCurrentInterpretationLog('');          
            setRerenderRuns(true);
            
            setQueuedRuns(prev => {
              const newSet = new Set(prev);
              newSet.delete(runId);
              return newSet;
            });
            
            const robotName = completionData.robotName || runningRecordingName;
            
            if (completionData.status === 'success') {
              notify('success', t('main_page.notifications.interpretation_success', { name: robotName }));
            } else {
              notify('error', t('main_page.notifications.interpretation_failed', { name: robotName }));
            }
            
            queueSocket.disconnect();
          }
        });
        
        setSockets(sockets => [...sockets, queueSocket]);
        
        notify('info', `Run queued: ${runningRecordingName}`);
      } else {
        const socket = io(`${apiUrl}/${browserId}`, {
          transports: ["websocket"],
          rejectUnauthorized: false
        });
        
        setSockets(sockets => [...sockets, socket]);
        
        socket.on('debugMessage', debugMessageHandler);
        socket.on('run-completed', (data) => {
          setRunningRecordingName('');
          setCurrentInterpretationLog('');
          setRerenderRuns(true);
          
          const robotName = data.robotName;
          
          if (data.status === 'success') {
            notify('success', t('main_page.notifications.interpretation_success', { name: robotName }));
          } else {
            notify('error', t('main_page.notifications.interpretation_failed', { name: robotName }));
          }
        });
        
        socket.on('connect_error', (error) => {
          console.log('error', `Failed to connect to browser ${browserId}: ${error}`);
          notify('error', t('main_page.notifications.connection_failed', { name: runningRecordingName }));
        });

        socket.on('disconnect', (reason) => {
          console.log('warn', `Disconnected from browser ${browserId}: ${reason}`);
        });
        
        if (runId) {
          notify('info', t('main_page.notifications.run_started', { name: runningRecordingName }));
        } else {
          notify('error', t('main_page.notifications.run_start_failed', { name: runningRecordingName }));
        }
      }
      
      setContent('runs');
    }).catch((error: any) => {
      console.error('Error in createAndRunRecording:', error); // ✅ Debug log
    });

    return (socket: Socket) => {
      socket.off('debugMessage', debugMessageHandler);
      socket.off('run-completed');
      socket.off('connect_error');
      socket.off('disconnect');
    }
  }, [runningRecordingName, sockets, ids, debugMessageHandler, user?.id, t, notify, setRerenderRuns, setQueuedRuns, navigate, setContent, setIds]);

  const handleScheduleRecording = (settings: ScheduleSettings) => {
    scheduleStoredRecording(runningRecordingId, settings)
      .then(({ message, runId }: ScheduleRunResponse) => {
        if (message === 'success') {
          notify('success', t('main_page.notifications.schedule_success', { name: runningRecordingName }));
        } else {
          notify('error', t('main_page.notifications.schedule_failed', { name: runningRecordingName }));
        }
      });
  }

  const DisplayContent = () => {
    switch (content) {
      case 'robots':
        return <Recordings
          handleEditRecording={handleEditRecording}
          handleRunRecording={handleRunRecording}
          setRecordingInfo={setRecordingInfo}
          handleScheduleRecording={handleScheduleRecording}
        />;
      case 'runs':
        return <Runs
          currentInterpretationLog={currentInterpretationLog}
          abortRunHandler={() => abortRunHandler(ids.runId)}
          runId={ids.runId}
          runningRecordingName={runningRecordingName}
        />;
      case 'proxy':
        return <ProxyForm />;
      case 'apikey':
        return <ApiKey />;
      default:
        return null;
    }
  }

  return (
    <Stack direction='row' spacing={0} sx={{ minHeight: '900px' }}>
      <Stack sx={{ width: 250, flexShrink: 0 }}>
      <MainMenu value={content} handleChangeContent={setContent} />
      </Stack>
      {DisplayContent()}
    </Stack>
  );
};
