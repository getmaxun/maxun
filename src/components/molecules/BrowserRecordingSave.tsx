import React, { useState } from 'react';
import { Grid, Button, Box, Typography } from '@mui/material';
import { SaveRecording } from "./SaveRecording";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useActionContext } from '../../context/browserActions';
import { useBrowserSteps } from '../../context/browserSteps';
import { stopRecording } from "../../api/recording";
import { useNavigate } from 'react-router-dom';
import { GenericModal } from "../atoms/GenericModal";
import { useTranslation } from 'react-i18next';

const BrowserRecordingSave = () => {
  const { t } = useTranslation();
  const [openDiscardModal, setOpenDiscardModal] = useState<boolean>(false);
  const [openResetModal, setOpenResetModal] = useState<boolean>(false);
  const { recordingName, browserId, setBrowserId, notify, setCurrentWorkflowActionsState, resetInterpretationLog } = useGlobalInfoStore();
  const navigate = useNavigate();

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
  } = useActionContext();

  const { browserSteps, deleteBrowserStep } = useBrowserSteps();

  const goToMainMenu = async () => {
    if (browserId) {
      await stopRecording(browserId);
      notify('warning', t('browser_recording.notifications.terminated'));
      setBrowserId(null);
    }
    navigate('/');
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

    resetInterpretationLog();

    // Clear all browser steps
    browserSteps.forEach(step => {
      deleteBrowserStep(step.id);
    });

    // Close the reset confirmation modal
    setOpenResetModal(false);

    // Notify user
    notify('info', t('browser_recording.notifications.environment_reset'));
  };

  return (
    <Grid container>
      <Grid item xs={12} md={3} lg={3}>
        <div style={{
          marginTop: '12px',
          color: 'white',
          position: 'absolute',
          background: '#ff00c3',
          border: 'none',
          borderRadius: '5px',
          padding: '7.5px',
          width: 'calc(100% - 20px)',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <Button 
            onClick={() => setOpenDiscardModal(true)} 
            variant="outlined" 
            style={{ marginLeft: "25px" }} 
            size="small" 
            color="error"
          >
            {t('right_panel.buttons.discard')}
          </Button>

          {/* Reset Button */}
          <Button
            onClick={() => setOpenResetModal(true)}
            variant="outlined"
            size="small"
            style={{ 
              backgroundColor: 'white',
              marginLeft: '10px',
              marginRight: '10px'
            }}
          >
            {t('right_panel.buttons.reset')}
          </Button>

          <SaveRecording fileName={recordingName} />

          {/* Discard Confirmation Modal */}
          <GenericModal isOpen={openDiscardModal} onClose={() => setOpenDiscardModal(false)} modalStyle={modalStyle}>
            <Box p={2}>
              <Typography variant="h6">{t('browser_recording.modal.confirm_discard')}</Typography>
              <Box display="flex" justifyContent="space-between" mt={2}>
                <Button onClick={goToMainMenu} variant="contained" color="error">
                  {t('right_panel.buttons.discard')}
                </Button>
                <Button onClick={() => setOpenDiscardModal(false)} variant="outlined">
                  {t('right_panel.buttons.cancel')}
                </Button>
              </Box>
            </Box>
          </GenericModal>

          {/* Reset Confirmation Modal */}
          <GenericModal isOpen={openResetModal} onClose={() => setOpenResetModal(false)} modalStyle={modalStyle}>
            <Box p={2}>
              <Typography variant="h6">{t('browser_recording.modal.confirm_reset')}</Typography>
              <Typography variant="body2" sx={{ mt: 1, mb: 2 }}>
                {t('browser_recording.modal.reset_warning')}
              </Typography>
              <Box display="flex" justifyContent="space-between" mt={2}>
                <Button 
                  onClick={performReset} 
                  variant="contained" 
                  color="primary"
                >
                  {t('right_panel.buttons.confirm_reset')}
                </Button>
                <Button 
                  onClick={() => setOpenResetModal(false)} 
                  variant="outlined"
                >
                  {t('right_panel.buttons.cancel')}
                </Button>
              </Box>
            </Box>
          </GenericModal>
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