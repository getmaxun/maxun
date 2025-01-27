import React, { useState, useEffect } from "react";
import { GenericModal } from "../ui/GenericModal";
import {
  MenuItem,
  Typography,
  CircularProgress,
  Alert,
  AlertTitle,
  Button,
  TextField,
} from "@mui/material";
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
  spreadsheetId?: string;
  spreadsheetName?: string;
  airtableBaseId?: string;
  airtableBaseName?: string;
  data: string;
  integrationType: "googleSheets" | "airtable";
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
    integrationType: "googleSheets",
  });

  const [spreadsheets, setSpreadsheets] = useState<{ id: string; name: string }[]>([]);
  const [airtableBases, setAirtableBases] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recordingId, notify } = useGlobalInfoStore();
  const [recording, setRecording] = useState<any>(null);

  const [airtableAuthStatus, setAirtableAuthStatus] = useState<boolean | null>(null);

  // Authenticate with Google Sheets
  const authenticateWithGoogle = () => {
    window.location.href = `${apiUrl}/auth/google?robotId=${recordingId}`;
  };

  // Authenticate with Airtable
  const authenticateWithAirtable = () => {
    window.location.href = `${apiUrl}/auth/airtable?robotId=${recordingId}`;
  };

  // Fetch Google Sheets files
  const fetchSpreadsheetFiles = async () => {
    try {
      const response = await axios.get(
        `${apiUrl}/auth/gsheets/files?robotId=${recordingId}`,
        { withCredentials: true }
      );
      setSpreadsheets(response.data);
    } catch (error: any) {
      console.error("Error fetching spreadsheet files:", error);
      notify("error", t("integration_settings.errors.fetch_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Fetch Airtable bases
  const fetchAirtableBases = async () => {
    try {
      const response = await axios.get(
        `${apiUrl}/auth/airtable/bases?robotId=${recordingId}`,
        { withCredentials: true }
      );
      setAirtableBases(response.data);
    } catch (error: any) {
      console.error("Error fetching Airtable bases:", error);
      notify("error", t("integration_settings.errors.fetch_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Handle Google Sheets selection
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

  // Handle Airtable base selection
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

  // Update Google Sheets integration
  const updateGoogleSheetId = async () => {
    try {
      await axios.post(
        `${apiUrl}/auth/gsheets/update`,
        {
          spreadsheetId: settings.spreadsheetId,
          spreadsheetName: settings.spreadsheetName,
          robotId: recordingId,
        },
        { withCredentials: true }
      );
      notify("success", t("integration_settings.notifications.sheet_selected"));
    } catch (error: any) {
      console.error("Error updating Google Sheet ID:", error);
      notify("error", t("integration_settings.errors.update_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Update Airtable integration
  const updateAirtableBase = async () => {
    try {
      await axios.post(
        `${apiUrl}/auth/airtable/update`,
        {
          baseId: settings.airtableBaseId,
          baseName: settings.airtableBaseName,
          robotId: recordingId,
        },
        { withCredentials: true }
      );
      notify("success", t("integration_settings.notifications.base_selected"));
    } catch (error: any) {
      console.error("Error updating Airtable base:", error);
      notify("error", t("integration_settings.errors.update_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Remove Google Sheets integration
  const removeGoogleSheetsIntegration = async () => {
    try {
      await axios.post(
        `${apiUrl}/auth/gsheets/remove`,
        { robotId: recordingId },
        { withCredentials: true }
      );
      setSpreadsheets([]);
      setSettings({ ...settings, spreadsheetId: "", spreadsheetName: "" });
      notify("success", t("integration_settings.notifications.integration_removed"));
    } catch (error: any) {
      console.error("Error removing Google Sheets integration:", error);
      notify("error", t("integration_settings.errors.remove_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Remove Airtable integration
  const removeAirtableIntegration = async () => {
    try {
      await axios.post(
        `${apiUrl}/auth/airtable/remove`,
        { robotId: recordingId },
        { withCredentials: true }
      );
      setAirtableBases([]);
      setSettings({ ...settings, airtableBaseId: "", airtableBaseName: "" });
      notify("success", t("integration_settings.notifications.integration_removed"));
    } catch (error: any) {
      console.error("Error removing Airtable integration:", error);
      notify("error", t("integration_settings.errors.remove_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Handle OAuth callback for Airtable
  const handleAirtableOAuthCallback = async () => {
    try {
      const response = await axios.get(`${apiUrl}/auth/airtable/callback`);
      if (response.data.success) {
        setAirtableAuthStatus(true);
        fetchAirtableBases(); // Fetch bases after successful authentication
      }
    } catch (error) {
      setError("Error authenticating with Airtable");
    }
  };

  // Fetch recording info on component mount
  useEffect(() => {
    const fetchRecordingInfo = async () => {
      if (!recordingId) return;
      const recording = await getStoredRecording(recordingId);
      if (recording) {
        setRecording(recording);
        if (recording.google_sheet_id) {
          setSettings({ ...settings, integrationType: "googleSheets" });
        } else if (recording.airtable_base_id) {
          setSettings({ ...settings, integrationType: "airtable" });
        }
      }
    };
    fetchRecordingInfo();
  }, [recordingId]);

  // Handle Airtable authentication status
  useEffect(() => {
    const status = getCookie("airtable_auth_status");
    const message = getCookie("airtable_auth_message");

    if (status === "success" && message) {
      notify("success", message);
      removeCookie("airtable_auth_status");
      removeCookie("airtable_auth_message");
      setAirtableAuthStatus(true);
      fetchAirtableBases(); // Fetch bases after successful authentication
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    if (code) {
      handleAirtableOAuthCallback();
    }
  }, [recordingId]);

  console.log(recording)


  const [selectedIntegrationType, setSelectedIntegrationType] = useState<
  "googleSheets" | "airtable" | null
>(null);

// Add this UI at the top of the modal return statement
if (!selectedIntegrationType) {
  return (
    <GenericModal
      isOpen={isOpen}
      onClose={handleClose}
      modalStyle={modalStyle}
    >
      <div style={{ 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        padding: "20px" 
      }}>
        <Typography variant="h6" sx={{ marginBottom: "20px" }}>
          {t("integration_settings.title_select_integration")}
        </Typography>
        <div style={{ display: "flex", gap: "20px" }}>
          {/* Google Sheets Button */}
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              setSelectedIntegrationType("googleSheets");
              setSettings({ ...settings, integrationType: "googleSheets" });
            }}
          >
            Google Sheets
          </Button>

          {/* Airtable Button */}
          <Button
            variant="contained"
            color="secondary"
            onClick={() => {
              setSelectedIntegrationType("airtable");
              setSettings({ ...settings, integrationType: "airtable" });
            }}
          >
            Airtable
          </Button>
        </div>
      </div>
    </GenericModal>
  );
}

  

  return (
    <GenericModal isOpen={isOpen} onClose={handleClose} modalStyle={modalStyle}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        marginLeft: "65px",
      }}>
        <Typography variant="h6">
          {t("integration_settings.title")}
        </Typography>

        {/* Google Sheets Integration */}
        {settings.integrationType === "googleSheets" && (
          <>
            {recording?.google_sheet_id ? (
              <>
                <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
                  <AlertTitle>{t("integration_settings.alerts.success.title")}</AlertTitle>
                  {t("integration_settings.alerts.success.content", {
                    sheetName: recording.google_sheet_name,
                  })}
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${recording.google_sheet_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("integration_settings.alerts.success.here")}
                  </a>
                </Alert>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={removeGoogleSheetsIntegration}
                  style={{ marginTop: "15px" }}
                >
                  {t("integration_settings.buttons.remove_integration")}
                </Button>
              </>
            ) : (
              <>
                {!recording?.google_sheet_email ? (
                  <>
                    <p>{t("integration_settings.descriptions.sync_info")}</p>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={authenticateWithGoogle}
                    >
                      {t("integration_settings.buttons.authenticate")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                      {t("integration_settings.descriptions.authenticated_as", {
                        email: recording.google_sheet_email,
                      })}
                    </Typography>
                    {loading ? (
                      <CircularProgress sx={{ marginBottom: "15px" }} />
                    ) : error ? (
                      <Typography color="error">{error}</Typography>
                    ) : spreadsheets.length === 0 ? (
                      <Button
                        variant="outlined"
                        color="primary"
                        onClick={fetchSpreadsheetFiles}
                      >
                        {t("integration_settings.buttons.fetch_sheets")}
                      </Button>
                    ) : (
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
                          {t("integration_settings.buttons.submit")}
                        </Button>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Airtable Integration */}
        {settings.integrationType === "airtable" && (
          <>
            {recording?.airtable_base_id ? (
              <>
                <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #00c3ff" }}>
                  <AlertTitle>{t("integration_settings.alerts.airtable_success.title")}</AlertTitle>
                  {t("integration_settings.alerts.airtable_success.content", {
                    baseName: recording.airtable_base_name,
                  })}
                  <a
                    href={`https://airtable.com/${recording.airtable_base_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("integration_settings.alerts.airtable_success.here")}
                  </a>
                </Alert>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={removeAirtableIntegration}
                  style={{ marginTop: "15px" }}
                >
                  {t("integration_settings.buttons.remove_integration")}
                </Button>
              </>
            ) : (
              <>
                {!recording?.airtable_access_token ? (
                  <>
                    <p>{t("integration_settings.descriptions.airtable_sync_info")}</p>
                    <Button
                      variant="contained"
                      color="secondary"
                      onClick={authenticateWithAirtable}
                    >
                      {t("integration_settings.buttons.authenticate_airtable")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                      {t("integration_settings.descriptions.authenticated_as", {
                        email: "hghghg",
                      })}
                    </Typography>
                    {loading ? (
                      <CircularProgress sx={{ marginBottom: "15px" }} />
                    ) : error ? (
                      <Typography color="error">{error}</Typography>
                    ) : airtableBases.length === 0 ? (
                      <Button
                        variant="outlined"
                        color="secondary"
                        onClick={fetchAirtableBases}
                      >
                        {t("integration_settings.buttons.fetch_airtable_bases")}
                      </Button>
                    ) : (
                      <>
                        <TextField
                          sx={{ marginBottom: "15px" }}
                          select
                          label={t("integration_settings.fields.select_airtable_base")}
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
                        <Button
                          variant="contained"
                          color="secondary"
                          onClick={() => {
                            updateAirtableBase();
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