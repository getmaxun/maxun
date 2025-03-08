import React, { useEffect, useState } from "react";
import { RecordingsTable } from "./RecordingsTable";
import { Grid } from "@mui/material";
import { RunSettings, RunSettingsModal } from "../run/RunSettings";
import { ScheduleSettings, ScheduleSettingsModal } from "./ScheduleSettings";
import { IntegrationSettingsModal } from "../integration/IntegrationSettings";
import { RobotSettingsModal } from "./RobotSettings";
import { RobotEditModal } from "./RobotEdit";
import { RobotDuplicationModal } from "./RobotDuplicate";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useTranslation } from "react-i18next";

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
  const { notify } = useGlobalInfoStore();
  const { t } = useTranslation();

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

  useEffect(() => {
    // Helper function to get and clear a cookie
    const getAndClearCookie = (name: string) => {
      const value = document.cookie
        .split('; ')
        .find(row => row.startsWith(`${name}=`))
        ?.split('=')[1];
      
      if (value) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
      
      return value;
    };

    const authStatus = getAndClearCookie('robot_auth_status');
    const airtableAuthStatus = getAndClearCookie('airtable_auth_status');
    const robotId = getAndClearCookie('robot_auth_robotId');

    if (airtableAuthStatus === 'success' && robotId) {
      console.log("Airtable Auth Status:", airtableAuthStatus);
      notify(airtableAuthStatus, t("recordingtable.notifications.auth_success"));
      handleNavigate(`/robots/${robotId}/integrate/airtable`, robotId, "", []);
    } 
    else if (authStatus === 'success' && robotId) {
      console.log("Google Auth Status:", authStatus);
      notify(authStatus, t("recordingtable.notifications.auth_success"));
      handleNavigate(`/robots/${robotId}/integrate/google`, robotId, "", []);
    }
  }, []);

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
    } else if (currentPath.endsWith("/integrate/google")) {
      return (
        <IntegrationSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={() => {}}
          preSelectedIntegrationType="googleSheets"
        />
      );
    } else if (currentPath.endsWith("/integrate/airtable")) {
      return (
        <IntegrationSettingsModal
          isOpen={true}
          handleClose={handleClose}
          handleStart={() => {}}
          preSelectedIntegrationType="airtable"
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
