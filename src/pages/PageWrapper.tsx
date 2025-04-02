import React, { useEffect, useState } from 'react';
import { NavBar } from "../components/dashboard/NavBar";
import { SocketProvider } from "../context/socket";
import { BrowserDimensionsProvider } from "../context/browserDimensions";
import { AuthProvider } from '../context/auth';
import { RecordingPage } from "./RecordingPage";
import { MainPage } from "./MainPage";
import { useGlobalInfoStore } from "../context/globalInfo";
import { AlertSnackbar } from "../components/ui/AlertSnackbar";
import Login from './Login';
import Register from './Register';
import UserRoute from '../routes/userRoute';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { NotFoundPage } from '../components/dashboard/NotFound';

export const PageWrapper = () => {
  const [open, setOpen] = useState(false);
  const [isRecordingMode, setIsRecordingMode] = useState(false);

  const navigate = useNavigate();

  const { browserId, setBrowserId, notification, recordingName, setRecordingName, recordingId, setRecordingId, setRecordingUrl } = useGlobalInfoStore();

  const handleEditRecording = (recordingId: string, fileName: string) => {
    setRecordingName(fileName);
    setRecordingId(recordingId);
    setBrowserId('new-recording');
    navigate('/recording');
  }

  const isNotification = (): boolean => {
    if (notification.isOpen && !open) {
      setOpen(true);
    }
    return notification.isOpen;
  }

  /**
   * Get the current tab's state from session storage
   */
  const getTabState = (key: string): string | null => {
    try {
      const value = window.sessionStorage.getItem(key);
      return value;
    } catch (error) {
      return null;
    }
  };

  useEffect(() => {
    const tabMode = getTabState('tabMode');
    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');
    const storedSessionId = getTabState('recordingSessionId');
    const storedRecordingUrl = getTabState('recordingUrl');
    
    if (location.pathname === '/recording-setup' && sessionParam && sessionParam === storedSessionId) {
      setBrowserId('new-recording');
      setRecordingName('');
      setRecordingId('');

      if (storedRecordingUrl) {
        setRecordingUrl(storedRecordingUrl);
      }

      navigate('/recording');
    }
    else if (location.pathname === '/recording' || 
           (getTabState('nextTabIsRecording') === 'true' && sessionParam === storedSessionId)) {
      setIsRecordingMode(true);
      
      if (location.pathname !== '/recording') {
        navigate('/recording');
      }
      
      window.sessionStorage.removeItem('nextTabIsRecording');
    } else if (tabMode === 'main') {
      console.log('Tab is in main application mode');
    } else {
      const id = getTabState('browserId');
      if (id === 'new-recording' || location.pathname === '/recording') {
        setIsRecordingMode(true);
      }
    }
  }, [location.pathname, navigate, setBrowserId, setRecordingId, setRecordingName, setRecordingUrl]);
  
  return (
    <div>
      <AuthProvider>
        <SocketProvider>
          <React.Fragment>
            {/* {!browserId && location.pathname !== '/recording' && <NavBar recordingName={recordingName} isRecording={!!browserId} />} */}
            {location.pathname !== '/recording' && <NavBar recordingName={recordingName} isRecording={false} />}
            <Routes>
              <Route element={<UserRoute />}>
                <Route path="/" element={<Navigate to="/robots" replace />} />
                <Route path="/robots/*" element={<MainPage handleEditRecording={handleEditRecording} initialContent="robots" />} />
                <Route path="/runs/*" element={<MainPage handleEditRecording={handleEditRecording} initialContent="runs" />} />
                <Route path="/proxy" element={<MainPage handleEditRecording={handleEditRecording} initialContent="proxy" />} />
                <Route path="/apikey" element={<MainPage handleEditRecording={handleEditRecording} initialContent="apikey" />} />
              </Route>
              <Route element={<UserRoute />}>
                <Route path="/recording" element={
                  <BrowserDimensionsProvider>
                    <RecordingPage recordingName={recordingName} />
                  </BrowserDimensionsProvider>
                } />
              </Route>
              <Route
                path="/login"
                element={<Login />}
              />
              <Route
                path="/register"
                element={<Register />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </React.Fragment>
        </SocketProvider>
      </AuthProvider>
      {isNotification() ?
        <AlertSnackbar severity={notification.severity}
          message={notification.message}
          isOpen={notification.isOpen} />
        : null
      }
    </div>
  );
}
