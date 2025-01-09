import React, { useState } from 'react'
import { Grid, Button, Box, Typography } from '@mui/material';
import { SaveRecording } from "./SaveRecording";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { stopRecording } from "../../api/recording";
import { useNavigate } from 'react-router-dom';
import { GenericModal } from "../ui/GenericModal";
import { useTranslation } from 'react-i18next';

const BrowserRecordingSave = () => {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState<boolean>(false);
  const { recordingName, browserId, setBrowserId, notify } = useGlobalInfoStore();
  const navigate = useNavigate();

  const goToMainMenu = async () => {
    if (browserId) {
      await stopRecording(browserId);
      notify('warning', t('browser_recording.notifications.terminated'));
      setBrowserId(null);
    }
    navigate('/');
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
          borderRadius: '0px 0px 8px 8px',
          padding: '7.5px',
          width: 'calc(100% - 20px)',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'space-between',
          height: "48px"
        }}>
          <Button
            onClick={() => setOpenModal(true)}
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
          <GenericModal isOpen={openModal} onClose={() => setOpenModal(false)} modalStyle={modalStyle}>
            <Box p={2}>
              <Typography variant="h6">{t('browser_recording.modal.confirm_discard')}</Typography>
              <Box display="flex" justifyContent="space-between" mt={2}>
                <Button onClick={goToMainMenu} variant="contained" color="error">
                  {t('right_panel.buttons.discard')}
                </Button>
                <Button
                  onClick={() => setOpenModal(false)}
                  variant="outlined"
                  sx={{
                    color: '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: 'whitesmoke !important',
                  }} >
                  {t('right_panel.buttons.cancel')}
                </Button>
              </Box>
            </Box>
          </GenericModal>
          <SaveRecording fileName={recordingName} />
        </div>
      </Grid>
    </Grid>
  );
}

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