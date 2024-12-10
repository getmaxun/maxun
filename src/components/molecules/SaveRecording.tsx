import React, { useCallback, useEffect, useState, useContext } from 'react';
import { Button, Box, LinearProgress, Tooltip } from "@mui/material";
import { GenericModal } from "../atoms/GenericModal";
import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { AuthContext } from '../../context/auth';
import { useSocketStore } from "../../context/socket";
import { TextField, Typography } from "@mui/material";
import { WarningText } from "../atoms/texts";
import NotificationImportantIcon from "@mui/icons-material/NotificationImportant";
import { useNavigate } from 'react-router-dom';

interface SaveRecordingProps {
  fileName: string;
}

export const SaveRecording = ({ fileName }: SaveRecordingProps) => {

  const [openModal, setOpenModal] = useState<boolean>(false);
  const [needConfirm, setNeedConfirm] = useState<boolean>(false);
  const [recordingName, setRecordingName] = useState<string>(fileName);
  const [waitingForSave, setWaitingForSave] = useState<boolean>(false);

  const { browserId, setBrowserId, notify, recordings } = useGlobalInfoStore();
  const { socket } = useSocketStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const navigate = useNavigate();

  const handleChangeOfTitle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    if (needConfirm) {
      setNeedConfirm(false);
    }
    setRecordingName(value);
  }

  const handleSaveRecording = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (recordings.includes(recordingName)) {
      if (needConfirm) { return; }
      setNeedConfirm(true);
    } else {
      await saveRecording();
    }
  };

  const exitRecording = useCallback(async () => {
    notify('success', 'Robot saved successfully');
    if (browserId) {
      await stopRecording(browserId);
    }
    setBrowserId(null);
    navigate('/');
  }, [setBrowserId, browserId, notify]);

  // notifies backed to save the recording in progress,
  // releases resources and changes the view for main page by clearing the global browserId
  const saveRecording = async () => {
    if (user) {
      const payload = { fileName: recordingName, userId: user.id };
      socket?.emit('save', payload);
      setWaitingForSave(true);
      console.log(`Saving the recording as ${recordingName} for userId ${user.id}`);
    } else {
      console.error('User not logged in. Cannot save recording.');
    }
  };

  useEffect(() => {
    socket?.on('fileSaved', exitRecording);
    return () => {
      socket?.off('fileSaved', exitRecording);
    }
  }, [socket, exitRecording]);

  return (
    <div>
      <Button onClick={() => setOpenModal(true)} variant="outlined" sx={{ marginRight: '20px' }} size="small" color="success">
        Finish
      </Button>

      <GenericModal isOpen={openModal} onClose={() => setOpenModal(false)} modalStyle={modalStyle}>
        <form onSubmit={handleSaveRecording} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <Typography variant="h6">Save Robot</Typography>
          <TextField
            required
            sx={{ width: '300px', margin: '15px 0px' }}
            onChange={handleChangeOfTitle}
            id="title"
            label="Robot Name"
            variant="outlined"
            defaultValue={recordingName ? recordingName : null}
          />
          {needConfirm
            ?
            (<React.Fragment>
              <Button color="error" variant="contained" onClick={saveRecording} sx={{ marginTop: '10px' }}>Confirm</Button>
              <WarningText>
                <NotificationImportantIcon color="warning" />
                Robot with this name already exists, please confirm the Robot's overwrite.
              </WarningText>
            </React.Fragment>)
            : <Button type="submit" variant="contained" sx={{ marginTop: '10px' }}>Save</Button>
          }
          {waitingForSave &&
            <Tooltip title='Optimizing and saving the workflow' placement={"bottom"}>
              <Box sx={{ width: '100%', marginTop: '10px' }}>
                <LinearProgress />
              </Box>
            </Tooltip>
          }
        </form>
      </GenericModal>
    </div>
  );
}

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
