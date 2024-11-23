import type { FC } from 'react';
import styled from 'styled-components';

import ReplayIcon from '@mui/icons-material/Replay';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { NavBarButton } from '../atoms/buttons/buttons';
import { UrlForm } from './UrlForm';
import { useCallback, useEffect, useState } from "react";
import { useSocketStore } from "../../context/socket";
import { getCurrentUrl } from "../../api/recording";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useThemeMode } from '../../context/theme-provider';

const StyledNavBar = styled.div<{ browserWidth: number; isDarkMode: boolean }>`
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: ${({ isDarkMode }) => (isDarkMode ? '#2C2F33' : '#F5F5F5')};
  width: ${({ browserWidth }) => `${browserWidth}px`};
  border-radius: 0px 0px 8px 8px;
  box-shadow: ${({ isDarkMode }) => (isDarkMode ? '0px 2px 10px rgba(0, 0, 0, 0.2)' : '0px 2px 10px rgba(0, 0, 0, 0.1)')};
  transition: background-color 0.3s ease, box-shadow 0.3s ease;
  margin-bottom: 15px;
`;

const IconButton = styled(NavBarButton)<{ mode: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  margin-right: 12px;
  background-color: ${({ mode }) => (mode === 'dark' ? '#40444B' : '#E0E0E0')};
  border-radius: 50%;
  transition: background-color 0.3s ease, transform 0.1s ease;
  color: ${({ mode }) => (mode === 'dark' ? '#FFFFFF' : '#333')};
  cursor: pointer;

  &:hover {
    background-color: ${({ mode }) => (mode === 'dark' ? '#586069' : '#D0D0D0')};
  }

  &:active {
    transform: scale(0.95);
  }
`;

interface NavBarProps {
  browserWidth: number;
  handleUrlChanged: (url: string) => void;
};

const BrowserNavBar: FC<NavBarProps> = ({
  browserWidth,
  handleUrlChanged,
}) => {
  const isDarkMode = useThemeMode().darkMode;

  const { socket } = useSocketStore();
  const { recordingUrl, setRecordingUrl } = useGlobalInfoStore();

  const handleRefresh = useCallback((): void => {
    socket?.emit('input:refresh');
  }, [socket]);

  const handleGoTo = useCallback((address: string): void => {
    socket?.emit('input:url', address);
  }, [socket]);

  const handleCurrentUrlChange = useCallback((url: string) => {
    handleUrlChanged(url);
    setRecordingUrl(url);
  }, [handleUrlChanged, recordingUrl]);

  useEffect(() => {
    getCurrentUrl().then((response) => {
      if (response) {
        handleUrlChanged(response);
      }
    }).catch((error) => {
      console.log("Fetching current url failed");
    })
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('urlChanged', handleCurrentUrlChange);
    }
    return () => {
      if (socket) {
        socket.off('urlChanged', handleCurrentUrlChange);
      }
    }
  }, [socket, handleCurrentUrlChange]);

  const addAddress = (address: string) => {
    if (socket) {
      handleUrlChanged(address);
      setRecordingUrl(address);
      handleGoTo(address);
    }
  };

  return (
    <StyledNavBar browserWidth={browserWidth} isDarkMode={isDarkMode}>
      <IconButton
        type="button"
        onClick={() => {
          socket?.emit('input:back');
        }}
        disabled={false}
        mode={isDarkMode ? 'dark' : 'light'}
      >
        <ArrowBackIcon />
      </IconButton>

      <IconButton
        type="button"
        onClick={() => {
          socket?.emit('input:forward');
        }}
        disabled={false}
        mode={isDarkMode ? 'dark' : 'light'}
      >
        <ArrowForwardIcon />
      </IconButton>

      <IconButton
        type="button"
        onClick={() => {
          if (socket) {
            handleRefresh();
          }
        }}
        disabled={false}
        mode={isDarkMode ? 'dark' : 'light'}
      >
        <ReplayIcon />
      </IconButton>

      <UrlForm
        currentAddress={recordingUrl}
        handleRefresh={handleRefresh}
        setCurrentAddress={addAddress}
      />
    </StyledNavBar>
  );
}

export default BrowserNavBar;
