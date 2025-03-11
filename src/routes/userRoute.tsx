import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useContext } from 'react';
import { AuthContext } from '../context/auth';
import { useGlobalInfoStore } from '../context/globalInfo';

const UserRoute = () => {
    const { state } = useContext(AuthContext);
    const location = useLocation();
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);

    const { setRecordingUrl } = useGlobalInfoStore();
    
    useEffect(() => {
        if (location.pathname === '/recording') {
            const hasRecordingSession = 
                window.sessionStorage.getItem('browserId') ||
                window.sessionStorage.getItem('recordingSessionId');

            const recordingUrl = window.sessionStorage.getItem('recordingUrl');
            if (recordingUrl) {
                setRecordingUrl(recordingUrl);
            }
            
            if (hasRecordingSession) {
                console.log('UserRoute: Valid recording session detected, bypassing auth check');
                setIsCheckingAuth(false);
                return;
            }
        }
        
        const timer = setTimeout(() => {
            setIsCheckingAuth(false);
        }, 100); 
        
        return () => clearTimeout(timer);
    }, [location.pathname]);
    
    if (isCheckingAuth) {
        return null; 
    }
    
    if (location.pathname === '/recording') {
        const hasRecordingSession = 
            window.sessionStorage.getItem('browserId') ||
            window.sessionStorage.getItem('recordingSessionId');
        
        if (hasRecordingSession) {
            return <Outlet />;
        }
    }
    
    return state.user ? <Outlet /> : <Navigate to="/login" />;
};

export default UserRoute;