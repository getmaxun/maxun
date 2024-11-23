import React, { useState } from 'react';
import { RecordingsTable } from "../molecules/RecordingsTable";
import { Grid } from "@mui/material";
import { RunSettings, RunSettingsModal } from "../molecules/RunSettings";
import { ScheduleSettings, ScheduleSettingsModal } from "../molecules/ScheduleSettings";
import { IntegrationSettings, IntegrationSettingsModal } from "../molecules/IntegrationSettings";
import { RobotSettings, RobotSettingsModal } from "../molecules/RobotSettings";
import { RobotEditModal } from '../molecules/RobotEdit';
import { RobotDuplicationModal } from '../molecules/RobotDuplicate';

interface RecordingsProps {
  handleEditRecording: (id: string, fileName: string) => void;
  handleRunRecording: (settings: RunSettings) => void;
  handleScheduleRecording: (settings: ScheduleSettings) => void;
  setRecordingInfo: (id: string, name: string) => void;
}

export const Recordings = ({ handleEditRecording, handleRunRecording, setRecordingInfo, handleScheduleRecording}: RecordingsProps) => {
  const [runSettingsAreOpen, setRunSettingsAreOpen] = useState(false);
  const [scheduleSettingsAreOpen, setScheduleSettingsAreOpen] = useState(false);
  const [integrateSettingsAreOpen, setIntegrateSettingsAreOpen] = useState(false);
  const [robotSettingsAreOpen, setRobotSettingsAreOpen] = useState(false);
  const [robotEditAreOpen, setRobotEditAreOpen] = useState(false);
  const [robotDuplicateAreOpen, setRobotDuplicateAreOpen] = useState(false);
  const [params, setParams] = useState<string[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string>('');
  const handleIntegrateRecording = (id: string, settings: IntegrationSettings) => {};
  const handleSettingsRecording = (id: string, settings: RobotSettings) => {};
  const handleEditRobot = (id: string, settings: RobotSettings) => {};
  const handleDuplicateRobot = (id: string, settings: RobotSettings) => {};

  const handleSettingsAndIntegrate = (id: string, name: string, params: string[]) => {
    if (params.length === 0) {
      setIntegrateSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    } else {
      setParams(params);
      setIntegrateSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    }
  }

  const handleSettingsAndRun = (id: string, name: string, params: string[]) => {
    if (params.length === 0) {
      setRunSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    } else {
      setParams(params);
      setRunSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    }
  }

  const handleSettingsAndSchedule = (id: string, name: string, params: string[]) => {
    if (params.length === 0) {
      setScheduleSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    } else {
      setParams(params);
      setScheduleSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    }
  }

  const handleRobotSettings = (id: string, name: string, params: string[]) => {
    if (params.length === 0) {
      setRobotSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    } else {
      setParams(params);
      setRobotSettingsAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    }
  }

  const handleEditRobotOption = (id: string, name: string, params: string[]) => {
    if (params.length === 0) {
      setRobotEditAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    } else {
      setParams(params);
      setRobotEditAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    }
  }

  const handleDuplicateRobotOption = (id: string, name: string, params: string[]) => {
    if (params.length === 0) {
      setRobotDuplicateAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    } else {
      setParams(params);
      setRobotDuplicateAreOpen(true);
      setRecordingInfo(id, name);
      setSelectedRecordingId(id);
    }
  }

  const handleClose = () => {
    setParams([]);
    setRunSettingsAreOpen(false);
    setRecordingInfo('', '');
    setSelectedRecordingId('');
  }

  const handleIntegrateClose = () => {
    setParams([]);
    setIntegrateSettingsAreOpen(false);
    setRecordingInfo('', '');
    setSelectedRecordingId('');
  }

  const handleScheduleClose = () => {
    setParams([]);
    setScheduleSettingsAreOpen(false);
    setRecordingInfo('', '');
    setSelectedRecordingId('');
  }

  const handleRobotSettingsClose = () => {
    setParams([]);
    setRobotSettingsAreOpen(false);
    setRecordingInfo('', '');
    setSelectedRecordingId('');
  }

  const handleRobotEditClose = () => {
    setParams([]);
    setRobotEditAreOpen(false);
    setRecordingInfo('', '');
    setSelectedRecordingId('');
  }

  const handleRobotDuplicateClose = () => {
    setParams([]);
    setRobotDuplicateAreOpen(false);
    setRecordingInfo('', '');
    setSelectedRecordingId('');
  }

  return (
    <React.Fragment>
      <RunSettingsModal isOpen={runSettingsAreOpen}
        handleClose={handleClose}
        handleStart={(settings) => handleRunRecording(settings)}
        isTask={params.length !== 0}
        params={params}
      />
      <ScheduleSettingsModal isOpen={scheduleSettingsAreOpen}
        handleClose={handleScheduleClose}
        handleStart={(settings) => handleScheduleRecording(settings)}
      />
      <IntegrationSettingsModal isOpen={integrateSettingsAreOpen}
        handleClose={handleIntegrateClose}
        handleStart={(settings) => handleIntegrateRecording(selectedRecordingId, settings)}
      />
      <RobotSettingsModal isOpen={robotSettingsAreOpen}
        handleClose={handleRobotSettingsClose}
        handleStart={(settings) => handleSettingsRecording(selectedRecordingId, settings)}
      />
      <RobotEditModal isOpen={robotEditAreOpen} 
        handleClose={handleRobotEditClose}
        handleStart={(settings) => handleEditRobot(selectedRecordingId,settings)} 
      />
      <RobotDuplicationModal isOpen={robotDuplicateAreOpen}
        handleClose={handleRobotDuplicateClose}
        handleStart={(settings) => handleDuplicateRobot(selectedRecordingId, settings)}
      />
      <Grid container direction="column" sx={{ padding: '30px' }}>
        <Grid item xs>
          <RecordingsTable
            handleEditRecording={handleEditRecording}
            handleRunRecording={handleSettingsAndRun}
            handleScheduleRecording={handleSettingsAndSchedule}
            handleIntegrateRecording={handleSettingsAndIntegrate}
            handleSettingsRecording={handleRobotSettings}
            handleEditRobot={handleEditRobotOption}
            handleDuplicateRobot={handleDuplicateRobotOption}
          />
        </Grid>
      </Grid>
    </React.Fragment>
  );
}