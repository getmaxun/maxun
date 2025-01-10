import React, { useState } from "react";
import { RecordingsTable } from "./RecordingsTable";
import { Grid } from "@mui/material";
import { RunSettings, RunSettingsModal } from "../run/RunSettings";
import { ScheduleSettings, ScheduleSettingsModal } from "./ScheduleSettings";
import { IntegrationSettings, IntegrationSettingsModal } from "../integration/IntegrationSettings";
import { RobotSettings, RobotSettingsModal } from "./RobotSettings";
import { RobotEditModal } from "./RobotEdit";
import { RobotDuplicationModal } from "./RobotDuplicate";
import { useNavigate, useLocation, useParams } from "react-router-dom";

interface RecordingsProps {
  handleEditRecording: (id: string, fileName: string) => void;
  handleRunRecording: (settings: RunSettings) => void;
  handleScheduleRecording: (settings: ScheduleSettings) => void;
  setRecordingInfo: (id: string, name: string) => void;
}

export const Recordings = ({
  handleEditRecording,
  handleRunRecording,
  setRecordingInfo,
  handleScheduleRecording,
}: RecordingsProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedRecordingId } = useParams();
  const [params, setParams] = useState<string[]>([]);

  const handleNavigate = (path: string, id: string, name: string, params: string[]) => {
    setParams(params);
    setRecordingInfo(id, name);
    navigate(path);
  };

  const handleClose = () => {
    setParams([]);
    setRecordingInfo("", "");
    navigate("/robots"); // Navigate back to the main robots page
  };

  // Determine which modal to open based on the current route
  const getCurrentModal = () => {
    const currentPath = location.pathname;

    if (currentPath.endsWith("/run")) {
      return (
        <RunSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={handleRunRecording}
          isTask={params.length !== 0}
          params={params}
        />
      );
    } else if (currentPath.endsWith("/schedule")) {
      return (
        <ScheduleSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={handleScheduleRecording}
        />
      );
    } else if (currentPath.endsWith("/integrate")) {
      return (
        <IntegrationSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={() => {}}
        />
      );
    } else if (currentPath.endsWith("/settings")) {
      return (
        <RobotSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={() => {}}
        />
      );
    } else if (currentPath.endsWith("/edit")) {
      return (
        <RobotEditModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={() => {}}
        />
      );
    } else if (currentPath.endsWith("/duplicate")) {
      return (
        <RobotDuplicationModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={() => {}}
        />
      );
    }
    return null;
  };

  return (
    <React.Fragment>
      {getCurrentModal()}
      <Grid container direction="column" sx={{ padding: "30px" }}>
        <Grid item xs>
          <RecordingsTable
            handleEditRecording={handleEditRecording}
            handleRunRecording={(id, name, params) =>
              handleNavigate(`/robots/${id}/run`, id, name, params)
            }
            handleScheduleRecording={(id, name, params) =>
              handleNavigate(`/robots/${id}/schedule`, id, name, params)
            }
            handleIntegrateRecording={(id, name, params) =>
              handleNavigate(`/robots/${id}/integrate`, id, name, params)
            }
            handleSettingsRecording={(id, name, params) =>
              handleNavigate(`/robots/${id}/settings`, id, name, params)
            }
            handleEditRobot={(id, name, params) =>
              handleNavigate(`/robots/${id}/edit`, id, name, params)
            }
            handleDuplicateRobot={(id, name, params) =>
              handleNavigate(`/robots/${id}/duplicate`, id, name, params)
            }
          />
        </Grid>
      </Grid>
    </React.Fragment>
  );
};
