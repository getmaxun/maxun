import React, { useState } from 'react'
import {
  Grid, Button, Typography, IconButton, Menu, MenuItem,
  ListItemText, Dialog, DialogTitle, DialogActions, DialogContent
} from '@mui/material';
import { SaveRecording } from "../recorder/SaveRecording";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useActionContext } from '../../context/browserActions';
import { useBrowserSteps } from '../../context/browserSteps';
import { stopRecording } from "../../api/recording";
import { useTranslation } from 'react-i18next';
import { emptyWorkflow } from '../../shared/constants';
import { useSocketStore } from '../../context/socket';
import { MoreHoriz } from '@mui/icons-material';

const BrowserRecordingSave = () => {
  const { t } = useTranslation();
  const [openDiscardModal, setOpenDiscardModal] = useState(false);
  const [openResetModal, setOpenResetModal] = useState(false);
  const [anchorEl, setAnchorEl] = React.useState(null);
  const { recordingName, browserId, initialUrl, setRecordingUrl, setBrowserId, notify, setCurrentWorkflowActionsState, resetInterpretationLog } = useGlobalInfoStore();

  const { socket } = useSocketStore();

  const {
    stopGetText,
    stopGetList,
    stopGetScreenshot,
    stopPaginationMode,
    stopLimitMode,
    setCaptureStage,
    updatePaginationType,
    updateLimitType,
    updateCustomLimit,
    setShowLimitOptions,
    setShowPaginationOptions,
    setWorkflow,
  } = useActionContext();

  const { browserSteps, deleteBrowserStep } = useBrowserSteps();

  const goToMainMenu = async () => {
    if (browserId) {
      const notificationData = {
        type: 'warning',
        message: t('browser_recording.notifications.terminated'),
        timestamp: Date.now()
      };
      window.sessionStorage.setItem('pendingNotification', JSON.stringify(notificationData));

      if (window.opener) {
        window.opener.postMessage({
          type: 'recording-notification',
          notification: notificationData
        }, '*');

        window.opener.postMessage({
          type: 'session-data-clear',
          timestamp: Date.now()
        }, '*');
      }

      setBrowserId(null);

      window.close();

      stopRecording(browserId).catch((error) => {
        console.warn('Background cleanup failed:', error);
      });
    }
  };

  const performReset = () => {
    stopGetText();
    stopGetList();
    stopGetScreenshot();
    stopPaginationMode();
    stopLimitMode();

    setShowLimitOptions(false);
    setShowPaginationOptions(false);
    setCaptureStage('initial');

    updatePaginationType('');
    updateLimitType('');
    updateCustomLimit('');

    setCurrentWorkflowActionsState({
      hasScrapeListAction: false,
      hasScreenshotAction: false,
      hasScrapeSchemaAction: false
    });

    setWorkflow(emptyWorkflow);

    resetInterpretationLog();

    // Clear all browser steps
    browserSteps.forEach(step => {
      deleteBrowserStep(step.id);
    });

    if (socket) {
      socket?.emit('new-recording');
      socket.emit('input:url', initialUrl);
      // Update the URL in the navbar to match
      let sessionInitialUrl = window.sessionStorage.getItem('initialUrl');
      if (sessionInitialUrl) {
        setRecordingUrl(sessionInitialUrl);
        window.sessionStorage.setItem('recordingUrl', sessionInitialUrl);
      } else {
        setRecordingUrl(initialUrl);
      }
    }

    // Close the reset confirmation modal
    setOpenResetModal(false);

    // Notify user
    notify('info', t('browser_recording.notifications.environment_reset'));
  };

  const handleClick = (event: any) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Grid container>
      <Grid item xs={12} md={3} lg={3}>
        <div style={{
          color: 'white',
          position: 'absolute',
          background: '#ff00c3',
          border: 'none',
          borderRadius: '8px',
          padding: '7.5px',
          width: 'calc(100% - 20px)',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'space-between',
          height: "48px",
          marginLeft: '10px'
        }}>
          <Button
            onClick={() => setOpenDiscardModal(true)}
            variant="outlined"
            color="error"
            sx={{
              marginLeft: '25px',
              color: 'red !important',
              borderColor: 'red !important',
              backgroundColor: 'whitesmoke !important',
            }}
            size="small"
          >
            {t('right_panel.buttons.discard')}
          </Button>

          <IconButton
            aria-label="options"
            size="small"
            onClick={handleClick}
            style={{
              color: 'whitesmoke',
            }}
          >
            <MoreHoriz />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleClose}
          >
            <MenuItem onClick={() => { setOpenResetModal(true); handleClose(); }}>
              <ListItemText>{t('right_panel.buttons.reset')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { window.open('https://docs.maxun.dev', '_blank'); }}>
              <ListItemText>Documentation</ListItemText>
            </MenuItem>
          </Menu>

          <SaveRecording fileName={recordingName} />

          <Dialog open={openDiscardModal} onClose={() => setOpenDiscardModal(false)}>
            <DialogTitle>
              {t('browser_recording.modal.confirm_discard')}
            </DialogTitle>
            <DialogActions>
              <Button
                onClick={() => setOpenDiscardModal(false)}
                color="inherit"
              >
                No
              </Button>
              <Button
                onClick={goToMainMenu}
                variant="contained"
                color="error"
              >
                Yes, Discard
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog open={openResetModal} onClose={() => setOpenResetModal(false)}>
            <DialogTitle>
              {t('browser_recording.modal.confirm_reset')}
            </DialogTitle>

            <DialogContent>
              {t('browser_recording.modal.reset_warning')}
            </DialogContent>

            <DialogActions>
              <Button
                onClick={() => setOpenResetModal(false)}
                color='inherit'
              >
                {t('right_panel.buttons.cancel')}
              </Button>
              <Button
                onClick={performReset}
                variant="contained"
                color="primary"
              >
                Yes, Restart
              </Button>
            </DialogActions>
          </Dialog>
        </div>
      </Grid>
    </Grid>
  );
};

export default BrowserRecordingSave;

const modalStyle = {
  top: '25%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};
