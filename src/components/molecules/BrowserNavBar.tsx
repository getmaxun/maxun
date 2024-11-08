import type {
  FC,
} from 'react';
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

const StyledNavBar = styled.div<{ browserWidth: number }>`
    display: flex;
    padding: 12px 0px;
    background-color: theme.palette.background.paper;
    width: ${({ browserWidth }) => browserWidth}px;
    border-radius: 0px 5px 0px 0px;
`;

interface NavBarProps {
  browserWidth: number;
  handleUrlChanged: (url: string) => void;
};

const BrowserNavBar: FC<NavBarProps> = ({
  browserWidth,
  handleUrlChanged,
}) => {

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
  }, [socket, handleCurrentUrlChange])

  const addAddress = (address: string) => {
    if (socket) {
      handleUrlChanged(address);
      setRecordingUrl(address);
      handleGoTo(address);
    }
  };

  return (
    <StyledNavBar browserWidth={900}>
      <NavBarButton
        type="button"
        onClick={() => {
          socket?.emit('input:back');
        }}
        disabled={false}
      >
        <ArrowBackIcon />
      </NavBarButton>

      <NavBarButton
        type="button"
        onClick={() => {
          socket?.emit('input:forward');
        }}
        disabled={false}
      >
        <ArrowForwardIcon />
      </NavBarButton>

      <NavBarButton
        type="button"
        onClick={() => {
          if (socket) {
            handleRefresh()
          }
        }}
        disabled={false}
      >
        <ReplayIcon />
      </NavBarButton>

      <UrlForm
        currentAddress={recordingUrl}
        handleRefresh={handleRefresh}
        setCurrentAddress={addAddress}
      />
    </StyledNavBar>
  );
}

export default BrowserNavBar;
