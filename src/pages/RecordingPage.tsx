import React, { useCallback, useEffect, useState } from 'react';
import { Grid } from '@mui/material';
import { BrowserContent } from "../components/browser/BrowserContent";
import { InterpretationLog } from "../components/run/InterpretationLog";
import { startRecording, getActiveBrowserId } from "../api/recording";
import { RightSidePanel } from "../components/recorder/RightSidePanel";
import { Loader } from "../components/ui/Loader";
import { useSocketStore } from "../context/socket";
import { useBrowserDimensionsStore } from "../context/browserDimensions";
import { ActionProvider } from "../context/browserActions"
import { BrowserStepsProvider } from '../context/browserSteps';
import { useGlobalInfoStore } from "../context/globalInfo";
import { editRecordingFromStorage } from "../api/storage";
import { WhereWhatPair } from "maxun-core";
import styled from "styled-components";
import BrowserRecordingSave from '../components/browser/BrowserRecordingSave';
import { useThemeMode } from '../context/theme-provider';
import { useTranslation } from 'react-i18next';

interface RecordingPageProps {
  recordingName?: string;
}

export interface PairForEdit {
  pair: WhereWhatPair | null,
  index: number,
}

export const RecordingPage = ({ recordingName }: RecordingPageProps) => {
  const { darkMode } = useThemeMode();
  const { t } = useTranslation();
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [hasScrollbar, setHasScrollbar] = React.useState(false);
  const [pairForEdit, setPairForEdit] = useState<PairForEdit>({
    pair: null,
    index: 0,
  });

  const [showOutputData, setShowOutputData] = useState(false);

  const browserContentRef = React.useRef<HTMLDivElement>(null);
  const workflowListRef = React.useRef<HTMLDivElement>(null);

  const { setId, socket } = useSocketStore();
  const { setWidth } = useBrowserDimensionsStore();
  const { browserId, setBrowserId, recordingId, recordingUrl, setRecordingUrl, setRecordingName, setRetrainRobotId, setIsDOMMode } = useGlobalInfoStore();

  const handleShowOutputData = useCallback(() => {
    setShowOutputData(true);
  }, []);

  const handleSelectPairForEdit = (pair: WhereWhatPair, index: number) => {
    setPairForEdit({
      pair,
      index,
    });
  };

  useEffect(() => {
    if (darkMode) {

      document.body.style.background = '#080808ff';

    } else {
      document.body.style.background = 'radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(232, 191, 222, 1) 100%, rgba(255, 255, 255, 1) 100%)';
      document.body.style.filter = 'progid:DXImageTransform.Microsoft.gradient(startColorstr="#ffffff",endColorstr="#ffffff",GradientType=1);'
    }

    return () => {
      document.body.style.background = '';
      document.body.style.filter = '';
    };
  }, [darkMode]);

  useEffect(() => {
    let isCancelled = false;
    const handleRecording = async () => {
      setIsDOMMode(true);

      const storedUrl = window.sessionStorage.getItem('recordingUrl');
      if (storedUrl && !recordingUrl) {
        setRecordingUrl(storedUrl);
        window.sessionStorage.removeItem('recordingUrl');
      }

      const robotName = window.sessionStorage.getItem('robotName');
      if (robotName) {
        setRecordingName(robotName);
        window.sessionStorage.removeItem('robotName');
      }

      const recordingId = window.sessionStorage.getItem('robotToRetrain');
      if (recordingId) {
        setRetrainRobotId(recordingId);
        window.sessionStorage.removeItem('robotToRetrain');
      }
      
      const id = await getActiveBrowserId();
      if (!isCancelled) {
        if (id) {
          setId(id);
          setBrowserId(id);
          setIsLoaded(true);
        } else {
          const newId = await startRecording()
          setId(newId);
          setBrowserId(newId);
        }
      }
    };
  
    handleRecording();
  
    return () => {
      isCancelled = true;
    }
  }, [setId, recordingUrl, setRecordingUrl, setRecordingName, setRetrainRobotId]);

  const handleLoaded = useCallback(() => {
    if (recordingName && browserId && recordingId) {
      editRecordingFromStorage(browserId, recordingId).then(() => setIsLoaded(true));
    } else {
      if (browserId === 'new-recording') {
        socket?.emit('new-recording');
      }
      if (recordingUrl && socket) {
        socket.emit('input:url', recordingUrl);
      }
      setIsLoaded(true);
    }
  }, [socket, browserId, recordingName, recordingId, recordingUrl, isLoaded]);

  useEffect(() => {
    socket?.on('loaded', handleLoaded);
    return () => {
      socket?.off('loaded', handleLoaded)
    }
  }, [socket, handleLoaded]);


  return (
    <ActionProvider>
      <BrowserStepsProvider>
        <div id="browser-recorder">
          <Grid container direction="row" style={{ flexGrow: 1, height: '100%' }}>
            <Grid item xs={12} md={9} lg={9} style={{ height: '100%', overflow: 'hidden', position: 'relative' }}>
              <div style={{ height: '100%', overflow: 'auto' }}>
                <BrowserContent />
                <InterpretationLog isOpen={showOutputData} setIsOpen={setShowOutputData} />
              </div>
            </Grid>
            <Grid item xs={12} md={3} lg={3} style={{ height: '100%', overflow: 'hidden' }}>
              <div className="right-side-panel" style={{ height: '100%' }}>
                <RightSidePanel onFinishCapture={handleShowOutputData} />
                <BrowserRecordingSave />
              </div>
            </Grid>
          </Grid>
        </div>
      </BrowserStepsProvider>
    </ActionProvider>
  );
};


const RecordingPageWrapper = styled.div`
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
`;