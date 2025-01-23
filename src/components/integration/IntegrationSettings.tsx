import React, { useState, useEffect } from "react";
import { GenericModal } from "../ui/GenericModal";
import {
  MenuItem,
  Typography,
  CircularProgress,
  Alert,
  AlertTitle,
  Chip,
} from "@mui/material";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import axios from "axios";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { getStoredRecording } from "../../api/storage";
import { apiUrl } from "../../apiConfig.js";
import Cookies from 'js-cookie';
import { useTranslation } from "react-i18next";


interface IntegrationProps {
  isOpen: boolean;
  handleStart: (data: IntegrationSettings) => void;
  handleClose: () => void;
}

export interface IntegrationSettings {
  spreadsheetId: string;
  spreadsheetName: string;
  data: string;
}

// Helper functions to replace js-cookie functionality
const getCookie = (name: string): string | null => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
};

const removeCookie = (name: string): void => {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
};

export const IntegrationSettingsModal = ({
  isOpen,
  handleStart,
  handleClose,
}: IntegrationProps) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<IntegrationSettings>({
    spreadsheetId: "",
    spreadsheetName: "",
    data: "",
  });

  const [spreadsheets, setSpreadsheets] = useState<
    { id: string; name: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recordingId, notify } = useGlobalInfoStore();
  const [recording, setRecording] = useState<any>(null);

  const authenticateWithGoogle = () => {
    window.location.href = `${apiUrl}/auth/google?robotId=${recordingId}`;
  };

  const handleOAuthCallback = async () => {
    try {
      const response = await axios.get(`${apiUrl}/auth/google/callback`);
      const { google_sheet_email, files } = response.data;
    } catch (error) {
      setError("Error authenticating with Google");
    }
  };

  const fetchSpreadsheetFiles = async () => {
    try {
      const response = await axios.get(
        `${apiUrl}/auth/gsheets/files?robotId=${recordingId}`,
        {
          withCredentials: true,
        }
      );
      setSpreadsheets(response.data);
    } catch (error: any) {
      console.error(
        "Error fetching spreadsheet files:",
        error.response?.data?.message || error.message
      );
      notify(
        "error",
        t('integration_settings.errors.fetch_error', {
          message: error.response?.data?.message || error.message
        })
      );
    }
  };

  const handleSpreadsheetSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedSheet = spreadsheets.find(
      (sheet) => sheet.id === e.target.value
    );
    if (selectedSheet) {
      setSettings({
        ...settings,
        spreadsheetId: selectedSheet.id,
        spreadsheetName: selectedSheet.name,
      });
    }
  };

  const updateGoogleSheetId = async () => {
    try {
      const response = await axios.post(
        `${apiUrl}/auth/gsheets/update`,
        {
          spreadsheetId: settings.spreadsheetId,
          spreadsheetName: settings.spreadsheetName,
          robotId: recordingId,
        },
        { withCredentials: true }
      );
      notify(`success`, t('integration_settings.notifications.sheet_selected'));
      console.log("Google Sheet ID updated:", response.data);
    } catch (error: any) {
      console.error(
        "Error updating Google Sheet ID:",
        error.response?.data?.message || error.message
      );
    }
  };

  const removeIntegration = async () => {
    try {
      await axios.post(
        `${apiUrl}/auth/gsheets/remove`,
        { robotId: recordingId },
        { withCredentials: true }
      );

      setRecording(null);
      setSpreadsheets([]);
      setSettings({ spreadsheetId: "", spreadsheetName: "", data: "" });
    } catch (error: any) {
      console.error(
        "Error removing Google Sheets integration:",
        error.response?.data?.message || error.message
      );
    }
  };

  useEffect(() => {
    // Check if there is a success message in cookies
    const status = getCookie("robot_auth_status");
    const message = getCookie("robot_auth_message");

    if (status === "success" && message) {
      notify("success", message);
      // Clear the cookies after reading
      removeCookie("robot_auth_status");
      removeCookie("robot_auth_message");
    }

    // Check if we're on the callback URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    if (code) {
      handleOAuthCallback();
    }

    const fetchRecordingInfo = async () => {
      if (!recordingId) return;
      const recording = await getStoredRecording(recordingId);
      if (recording) {
        setRecording(recording);
      }
    };

    fetchRecordingInfo();
  }, [recordingId]);

  return (
    <GenericModal isOpen={isOpen} onClose={handleClose} modalStyle={modalStyle}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        marginLeft: "65px",
      }}>
        <Typography variant="h6">
          {t('integration_settings.title')}
        </Typography>

        {recording && recording.google_sheet_id ? (
          <>
            <Alert severity="info" sx={{ marginTop: '10px', border: '1px solid #ff00c3' }}>
              <AlertTitle>{t('integration_settings.alerts.success.title')}</AlertTitle>
              {t('integration_settings.alerts.success.content', { sheetName: recording.google_sheet_name })}
              <a href={`https://docs.google.com/spreadsheets/d/${recording.google_sheet_id}`}
                target="_blank"
                rel="noreferrer">
                {t('integration_settings.alerts.success.here')}
              </a>.
              <br />
              <strong>{t('integration_settings.alerts.success.note')}</strong> {t('integration_settings.alerts.success.sync_limitation')}
            </Alert>
            <Button
              variant="outlined"
              color="error"
              onClick={removeIntegration}
              style={{ marginTop: "15px" }}
            >
              {t('integration_settings.buttons.remove_integration')}
            </Button>
          </>
        ) : (
          <>
            {!recording?.google_sheet_email ? (
              <>
                <p>{t('integration_settings.descriptions.sync_info')}</p>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={authenticateWithGoogle}
                >
                  {t('integration_settings.buttons.authenticate')}
                </Button>
              </>
            ) : (
              <>
                {recording.google_sheet_email && (
                  <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                    {t('integration_settings.descriptions.authenticated_as', {
                      email: recording.google_sheet_email
                    })}
                  </Typography>
                )}

                {loading ? (
                  <CircularProgress sx={{ marginBottom: "15px" }} />
                ) : error ? (
                  <Typography color="error">{error}</Typography>
                ) : spreadsheets.length === 0 ? (
                  <>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <Button
                        variant="outlined"
                        color="primary"
                        onClick={fetchSpreadsheetFiles}
                      >
                        {t('integration_settings.buttons.fetch_sheets')}
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={removeIntegration}
                      >
                        {t('integration_settings.buttons.remove_integration')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <TextField
                      sx={{ marginBottom: "15px" }}
                      select
                      label={t('integration_settings.fields.select_sheet')}
                      required
                      value={settings.spreadsheetId}
                      onChange={handleSpreadsheetSelect}
                      fullWidth
                    >
                      {spreadsheets.map((sheet) => (
                        <MenuItem key={sheet.id} value={sheet.id}>
                          {sheet.name}
                        </MenuItem>
                      ))}
                    </TextField>

                    {settings.spreadsheetId && (
                      <Typography sx={{ marginBottom: "10px" }}>
                        {t('integration_settings.fields.selected_sheet', {
                          name: spreadsheets.find((s) => s.id === settings.spreadsheetId)?.name,
                          id: settings.spreadsheetId
                        })}
                      </Typography>
                    )}

                    <Button
                      variant="contained"
                      color="primary"
                      onClick={() => {
                        updateGoogleSheetId();
                        handleStart(settings);
                      }}
                      style={{ marginTop: "10px" }}
                      disabled={!settings.spreadsheetId || loading}
                    >
                      {t('integration_settings.buttons.submit')}
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </GenericModal>
  );
};

export const modalStyle = {
  top: "40%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "50%",
  backgroundColor: "background.paper",
  p: 4,
  height: "fit-content",
  display: "block",
  padding: "20px",
};