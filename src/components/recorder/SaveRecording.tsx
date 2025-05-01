import React, { useCallback, useEffect, useState, useContext } from 'react';
import { Button, Box, LinearProgress, Tooltip } from "@mui/material";
import { GenericModal } from "../ui/GenericModal";
import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { AuthContext } from '../../context/auth';
import { useSocketStore } from "../../context/socket";
import { TextField, Typography } from "@mui/material";
import { WarningText } from "../ui/texts";
import NotificationImportantIcon from "@mui/icons-material/NotificationImportant";
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface SaveRecordingProps {
  fileName: string;
}

export const SaveRecording = ({ fileName }: SaveRecordingProps) => {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState<boolean>(false);
  const [needConfirm, setNeedConfirm] = useState<boolean>(false);
  const [saveRecordingName, setSaveRecordingName] = useState<string>(fileName);
  const [saveRecordingDescription, setSaveRecordingDescription] = useState<string>("");
  const [waitingForSave, setWaitingForSave] = useState<boolean>(false);

  const { browserId, setBrowserId, notify, recordings, isLogin, recordingName, retrainRobotId } = useGlobalInfoStore();
  const { socket } = useSocketStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const navigate = useNavigate();

  useEffect(() => {
    if (recordingName) {
      setSaveRecordingName(recordingName);
    }
  }, [recordingName]);

  const handleChangeOfTitle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    if (needConfirm) {
      setNeedConfirm(false);
    }
    setSaveRecordingName(value);
  }

  const handleSaveRecording = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (recordings.includes(saveRecordingName)) {
      if (needConfirm) { return; }
      setNeedConfirm(true);
    } else {
      await saveRecording();
    }
  };

  const handleFinishClick = () => {
    if (recordingName && !recordings.includes(recordingName)) {
      saveRecording();
    } else {
      setOpenModal(true);
    }
  };

  const exitRecording = useCallback(async (data?: { actionType: string }) => {
    let successMessage = t('save_recording.notifications.save_success');
    
    if (data && data.actionType) {
      if (data.actionType === 'retrained') {
        successMessage = t('save_recording.notifications.retrain_success');
      } else if (data.actionType === 'saved') {
        successMessage = t('save_recording.notifications.save_success');
      } else if (data.actionType === 'error') {
        successMessage = t('save_recording.notifications.save_error');
      }
    }
    
    const notificationData = {
      type: 'success',
      message: successMessage,
      timestamp: Date.now()
    };
    
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
    
    if (browserId) {
      await stopRecording(browserId);
    }
    setBrowserId(null);
    
    window.close();
  }, [setBrowserId, browserId, t]);

  // notifies backed to save the recording in progress,
  // releases resources and changes the view for main page by clearing the global browserId
  const saveRecording = async () => {
    if (user) {
      const payload = { 
        fileName: saveRecordingName || recordingName, 
        userId: user.id, 
        isLogin: isLogin,
        robotId: retrainRobotId,
      };
      socket?.emit('save', payload);
      setWaitingForSave(true);
      console.log(`Saving the recording as ${saveRecordingName || recordingName} for userId ${user.id}`);
    } else {
      console.error(t('save_recording.notifications.user_not_logged'));
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
      <Button
        onClick={handleFinishClick}
        variant="outlined"
        color="success"
        sx={{
          marginRight: '20px',
          color: '#00c853 !important',
          borderColor: '#00c853 !important',
          backgroundColor: 'whitesmoke !important',
        }}
        size="small"
      >
        {t('right_panel.buttons.finish')}
      </Button>

      <GenericModal isOpen={openModal} onClose={() => setOpenModal(false)} modalStyle={modalStyle}>
        <form onSubmit={handleSaveRecording} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <Typography variant="h6">{t('save_recording.title')}</Typography>
          <TextField
            required
            sx={{ width: '300px', margin: '15px 0px' }}
            onChange={handleChangeOfTitle}
            id="title"
            label={t('save_recording.robot_name')}
            variant="outlined"
            value={saveRecordingName}
          />
          <TextField
            required
            sx={{ width: '300px', margin: '15px 0px' }}
            onChange={handleChangeOfTitle}
            id="title"
            label={t('Description (optional)')}
            variant="outlined"
            value={saveRecordingDescription}
          />
          {needConfirm
            ?
            (<React.Fragment>
              <Button color="error" variant="contained" onClick={saveRecording} sx={{ marginTop: '10px' }}>
                {t('save_recording.buttons.confirm')}
              </Button>
              <WarningText>
                <NotificationImportantIcon color="warning" />
                {t('save_recording.errors.exists_warning')}
              </WarningText>
            </React.Fragment>)
            : <Button type="submit" variant="contained" sx={{ marginTop: '10px' }}>
              {t('save_recording.buttons.save')}
            </Button>
          }
          {waitingForSave &&
            <Tooltip title={t('save_recording.tooltips.optimizing')} placement={"bottom"}>
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