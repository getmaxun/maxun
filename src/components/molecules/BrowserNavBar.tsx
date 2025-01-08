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
    padding: 12px 0px;
    background-color: ${({ isDarkMode }) => (isDarkMode ? '#2C2F33' : '#f6f6f6')};
    width: ${({ browserWidth }) => browserWidth}px;
    border-radius: 0px 5px 0px 0px;
`;

const IconButton = styled(NavBarButton)<{ mode: string }>`
  background-color: ${({ mode }) => (mode === 'dark' ? '#2C2F33' : '#f6f6f6')};
  transition: background-color 0.3s ease, transform 0.1s ease;
  color: ${({ mode }) => (mode === 'dark' ? '#FFFFFF' : '#333')};
  cursor: pointer;
  &:hover {
    background-color: ${({ mode }) => (mode === 'dark' ? '#586069' : '#D0D0D0')};
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
