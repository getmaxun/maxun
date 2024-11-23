import React, { useState } from 'react'
import { Grid, Button, Box, Typography } from '@mui/material';
import { SaveRecording } from "./SaveRecording";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { stopRecording } from "../../api/recording";
import { useNavigate } from 'react-router-dom';
import { GenericModal } from "../atoms/GenericModal";

const BrowserRecordingSave = () => {
  const [openModal, setOpenModal] = useState<boolean>(false);
  const { recordingName, browserId, setBrowserId, notify } = useGlobalInfoStore();
  const navigate = useNavigate();

  const goToMainMenu = async () => {
    if (browserId) {
      await stopRecording(browserId);
      notify('warning', 'Current Recording was terminated');
      setBrowserId(null);
    }
    navigate('/');
  };

  return (
    <Grid container>
      <Grid item xs={12} md={3} lg={3}>
        <div style={{
          
          //  marginLeft: '10px',
          color: 'white',
          position: 'absolute',
          background: '#ff00c3',
          border: 'none',
          borderRadius: '0px 0px 8px 8px',
          padding: '7.5px',
          width: '100%',  // Ensure it takes full width but with padding
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'space-between',
          height:"48px"
        }}>
          <Button onClick={() => setOpenModal(true)} variant="outlined" style={{ marginLeft: "25px" }} size="small" color="error">
            Discard
          </Button>
          <GenericModal isOpen={openModal} onClose={() => setOpenModal(false)} modalStyle={modalStyle}>
            <Box p={2}>
              <Typography variant="h6">Are you sure you want to discard the recording?</Typography>
              <Box display="flex" justifyContent="space-between" mt={2}>
                <Button onClick={goToMainMenu} variant="contained" color="error">
                  Discard
                </Button>
                <Button onClick={() => setOpenModal(false)} variant="outlined">
                  Cancel
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

export default BrowserRecordingSave

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