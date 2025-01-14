import React, { useEffect, useState } from 'react';
import { NavBar } from "../components/dashboard/NavBar";
import { SocketProvider } from "../context/socket";
import { BrowserDimensionsProvider } from "../context/browserDimensions";
import { AuthProvider } from '../context/auth';
import { RecordingPage } from "./RecordingPage";
import { MainPage } from "./MainPage";
import { useGlobalInfoStore } from "../context/globalInfo";
import { getActiveBrowserId } from "../api/recording";
import { AlertSnackbar } from "../components/ui/AlertSnackbar";
import Login from './Login';
import Register from './Register';
import UserRoute from '../routes/userRoute';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { NotFoundPage } from '../components/dashboard/NotFound';
import { Runs } from '../components/run/Runs';

export const PageWrapper = () => {
  const [open, setOpen] = useState(false);

  const navigate = useNavigate();

  const { browserId, setBrowserId, notification, recordingName, setRecordingName, recordingId, setRecordingId } = useGlobalInfoStore();

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

  useEffect(() => {
    const isRecordingInProgress = async () => {
      const id = await getActiveBrowserId();
      if (id) {
        setBrowserId(id);
        navigate('/recording');
      }
    }
    isRecordingInProgress();
  }, []);

  return (
    <div>
      <AuthProvider>
        <SocketProvider>
          <React.Fragment>
            {!browserId && <NavBar recordingName={recordingName} isRecording={!!browserId} />}
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
