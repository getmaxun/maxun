import React, { useState, useEffect } from "react";
import { GenericModal } from "../ui/GenericModal";
import {
  MenuItem,
  Typography,
  CircularProgress,
  Alert,
  AlertTitle,
} from "@mui/material";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import axios from "axios";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { getStoredRecording } from "../../api/storage";
import { apiUrl } from "../../apiConfig.js";
import Cookies from "js-cookie";
import { useTranslation } from "react-i18next";

interface IntegrationProps {
  isOpen: boolean;
  handleStart: (data: IntegrationSettings) => void;
  handleClose: () => void;
}

export interface IntegrationSettings {
  spreadsheetId: string;
  spreadsheetName: string;
  airtableBaseId: string;
  airtableBaseName: string;
  data: string;
}

// Helper functions to replace js-cookie functionality
const getCookie = (name: string): string | null => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() || null;
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
    airtableBaseId: "",
    airtableBaseName: "",
    data: "",
  });

  const [spreadsheets, setSpreadsheets] = useState<{ id: string; name: string }[]>([]);
  const [airtableBases, setAirtableBases] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recordingId, notify } = useGlobalInfoStore();
  const [recording, setRecording] = useState<any>(null);

  // Authenticate with Google
  const authenticateWithGoogle = () => {
    const redirectUri = `${window.location.origin}/google/callback`;
    window.location.href = `${apiUrl}/auth/google?robotId=${recordingId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  };
  
  const authenticateWithAirtable = () => {
    const redirectUri = `${window.location.origin}/airtable/callback`;
    window.location.href = `${apiUrl}/auth/airtable?robotId=${recordingId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  // Handle OAuth callback
  const handleGoogleCallback = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      
      if (!code) {
        setError(t("integration_settings.errors.no_auth_code"));
        return;
      }
  
      const response = await axios.get(
        `${apiUrl}/auth/google/callback?code=${code}&robotId=${recordingId}`
      );
      
      if (response.data.accessToken) {
        notify("success", t("integration_settings.notifications.google_auth_success"));
        await fetchSpreadsheetFiles();
      }
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
  
    } catch (error) {
      setError(t("integration_settings.errors.google_auth_error"));
    }
  };

  const handleAirtableCallback = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      
      if (!code) {
        setError(t("integration_settings.errors.no_auth_code"));
        return;
      }
  
      const response = await axios.get(
        `${apiUrl}/auth/airtable/callback?code=${code}&robotId=${recordingId}`
      );
      
      if (response.data.accessToken) {
        notify("success", t("integration_settings.notifications.airtable_auth_success"));
        await fetchAirtableBases();
      }
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
  
    } catch (error) {
      setError(t("integration_settings.errors.airtable_auth_error"));
    }
  };

  // Fetch Google Sheets
  const fetchSpreadsheetFiles = async () => {
    try {
      const response = await axios.get(`${apiUrl}/auth/gsheets/files?robotId=${recordingId}`, {
        withCredentials: true,
      });
      setSpreadsheets(response.data);
    } catch (error: any) {
      console.error("Error fetching spreadsheet files:", error.response?.data?.message || error.message);
      notify("error", t("integration_settings.errors.fetch_error", { message: error.response?.data?.message || error.message }));
    }
  };

  // Fetch Airtable Bases
  const fetchAirtableBases = async () => {
    try {
      const response = await axios.get(`${apiUrl}/auth/airtable/bases?robotId=${recordingId}`, {
        withCredentials: true,
      });
      setAirtableBases(response.data);
    } catch (error: any) {
      console.error("Error fetching Airtable bases:", error.response?.data?.message || error.message);
      notify("error", t("integration_settings.errors.fetch_error", { message: error.response?.data?.message || error.message }));
    }
  };

  // Handle Google Sheet selection
  const handleSpreadsheetSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedSheet = spreadsheets.find((sheet) => sheet.id === e.target.value);
    if (selectedSheet) {
      setSettings({
        ...settings,
        spreadsheetId: selectedSheet.id,
        spreadsheetName: selectedSheet.name,
      });
    }
  };

  // Handle Airtable Base selection
  const handleAirtableBaseSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedBase = airtableBases.find((base) => base.id === e.target.value);
    if (selectedBase) {
      setSettings({
        ...settings,
        airtableBaseId: selectedBase.id,
        airtableBaseName: selectedBase.name,
      });
    }
  };

  // Update Google Sheet ID
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
      notify("success", t("integration_settings.notifications.sheet_selected"));
      console.log("Google Sheet ID updated:", response.data);
    } catch (error: any) {
      console.error("Error updating Google Sheet ID:", error.response?.data?.message || error.message);
    }
  };

  // Update Airtable Base ID
  const updateAirtableBaseId = async () => {
    try {
      const response = await axios.post(
        `${apiUrl}/auth/airtable/update`,
        {
          baseId: settings.airtableBaseId,
          baseName: settings.airtableBaseName,
          robotId: recordingId,
        },
        { withCredentials: true }
      );
      notify("success", t("integration_settings.notifications.base_selected"));
      console.log("Airtable Base ID updated:", response.data);
    } catch (error: any) {
      console.error("Error updating Airtable Base ID:", error.response?.data?.message || error.message);
    }
  };

  // Remove Integration
  const removeIntegration = async () => {
    try {
      await axios.post(
        `${apiUrl}/auth/gsheets/remove`,
        { robotId: recordingId },
        { withCredentials: true }
      );

      setRecording(null);
      setSpreadsheets([]);
      setAirtableBases([]);
      setSettings({ spreadsheetId: "", spreadsheetName: "", airtableBaseId: "", airtableBaseName: "", data: "" });
    } catch (error: any) {
      console.error("Error removing integration:", error.response?.data?.message || error.message);
    }
  };

  useEffect(() => {
    const checkAuthCallback = () => {
      const path = window.location.pathname;
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
  
      if (code) {
        if (path.includes('/google/callback')) {
          handleGoogleCallback();
        } else if (path.includes('/airtable/callback')) {
          handleAirtableCallback();
        }
      }
    };
  
    checkAuthCallback();
    
    // Cleanup function
    return () => {
      window.history.replaceState({}, document.title, window.location.pathname);
    };
  }, []);

  return (
    <GenericModal isOpen={isOpen} onClose={handleClose} modalStyle={modalStyle}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginLeft: "65px" }}>
        <Typography variant="h6">{t("integration_settings.title")}</Typography>

        {recording && (recording.google_sheet_id || recording.airtable_base_id) ? (
          <>
            {recording.google_sheet_id && (
              <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
                <AlertTitle>{t("integration_settings.alerts.success.title")}</AlertTitle>
                {t("integration_settings.alerts.success.content", { sheetName: recording.google_sheet_name })}
                <a href={`https://docs.google.com/spreadsheets/d/${recording.google_sheet_id}`} target="_blank" rel="noreferrer">
                  {t("integration_settings.alerts.success.here")}
                </a>.
                <br />
                <strong>{t("integration_settings.alerts.success.note")}</strong> {t("integration_settings.alerts.success.sync_limitation")}
              </Alert>
            )}

            {recording.airtable_base_id && (
              <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
                <AlertTitle>{t("integration_settings.alerts.success.title")}</AlertTitle>
                {t("integration_settings.alerts.success.content", { sheetName: recording.airtable_base_name })}
                <a href={`https://airtable.com/${recording.airtable_base_id}`} target="_blank" rel="noreferrer">
                  {t("integration_settings.alerts.success.here")}
                </a>.
                <br />
                <strong>{t("integration_settings.alerts.success.note")}</strong> {t("integration_settings.alerts.success.sync_limitation")}
              </Alert>
            )}

            <Button variant="outlined" color="error" onClick={removeIntegration} style={{ marginTop: "15px" }}>
              {t("integration_settings.buttons.remove_integration")}
            </Button>
          </>
        ) : (
          <>
            {!recording?.google_sheet_email && !recording?.airtable_email ? (
              <>
                <p>{t("integration_settings.descriptions.sync_info")}</p>
                <Button variant="contained" color="primary" onClick={authenticateWithGoogle} style={{ marginBottom: "10px" }}>
                  {t("integration_settings.buttons.authenticate_google")}
                </Button>
                <Button variant="contained" color="primary" onClick={authenticateWithAirtable}>
                  {t("integration_settings.buttons.authenticate_airtable")}
                </Button>
              </>
            ) : (
              <>
                {(recording.google_sheet_email || recording.airtable_email) && (
                  <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                    {t("integration_settings.descriptions.authenticated_as", {
                      email: recording.google_sheet_email || recording.airtable_email,
                    })}
                  </Typography>
                )}

                {loading ? (
                  <CircularProgress sx={{ marginBottom: "15px" }} />
                ) : error ? (
                  <Typography color="error">{error}</Typography>
                ) : (
                  <>
                    {recording.google_sheet_email && (
                      <>
                        <TextField
                          sx={{ marginBottom: "15px" }}
                          select
                          label={t("integration_settings.fields.select_sheet")}
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
                            {t("integration_settings.fields.selected_sheet", {
                              name: spreadsheets.find((s) => s.id === settings.spreadsheetId)?.name,
                              id: settings.spreadsheetId,
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
                          {t("integration_settings.buttons.submit_google")}
                        </Button>
                      </>
                    )}

                    {recording.airtable_email && (
                      <>
                        <TextField
                          sx={{ marginBottom: "15px" }}
                          select
                          label={t("integration_settings.fields.select_base")}
                          required
                          value={settings.airtableBaseId}
                          onChange={handleAirtableBaseSelect}
                          fullWidth
                        >
                          {airtableBases.map((base) => (
                            <MenuItem key={base.id} value={base.id}>
                              {base.name}
                            </MenuItem>
                          ))}
                        </TextField>

                        {settings.airtableBaseId && (
                          <Typography sx={{ marginBottom: "10px" }}>
                            {t("integration_settings.fields.selected_base", {
                              name: airtableBases.find((b) => b.id === settings.airtableBaseId)?.name,
                              id: settings.airtableBaseId,
                            })}
                          </Typography>
                        )}

                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => {
                            updateAirtableBaseId();
                            handleStart(settings);
                          }}
                          style={{ marginTop: "10px" }}
                          disabled={!settings.airtableBaseId || loading}
                        >
                          {t("integration_settings.buttons.submit_airtable")}
                        </Button>
                      </>
                    )}
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