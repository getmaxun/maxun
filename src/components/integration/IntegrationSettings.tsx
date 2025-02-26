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
import { useNavigate } from "react-router-dom";

interface IntegrationProps {
  isOpen: boolean;
  handleStart: (data: IntegrationSettings) => void;
  handleClose: () => void;
  preSelectedIntegrationType?: "googleSheets" | "airtable" | null;
}

export interface IntegrationSettings {
  spreadsheetId?: string;
  spreadsheetName?: string;
  airtableBaseId?: string;
  airtableBaseName?: string;
  airtableTableName?: string,
  airtableTableId?: string,
  data: string;
  integrationType: "googleSheets" | "airtable";
}

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
  preSelectedIntegrationType = null,
}: IntegrationProps) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<IntegrationSettings>({
    spreadsheetId: "",
    spreadsheetName: "",
    airtableBaseId: "",
    airtableBaseName: "",
    airtableTableName: "",
    airtableTableId: "",
    data: "",
    integrationType: preSelectedIntegrationType || "googleSheets",
  });

  const [spreadsheets, setSpreadsheets] = useState<{ id: string; name: string }[]>([]);
  const [airtableBases, setAirtableBases] = useState<{ id: string; name: string }[]>([]);
  const [airtableTables, setAirtableTables] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { 
    recordingId, 
    notify, 
    setRerenderRobots 
  } = useGlobalInfoStore();
  
  const [recording, setRecording] = useState<any>(null);
  const navigate = useNavigate();

  const [selectedIntegrationType, setSelectedIntegrationType] = useState<
    "googleSheets" | "airtable" | null
  >(preSelectedIntegrationType);

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
      setLoading(false);
      console.error("Error fetching spreadsheet files:", error);
      notify("error", t("integration_settings.google.errors.fetch_error", {
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
      setLoading(false);
      console.error("Error fetching Airtable bases:", error);
      notify("error", t("integration_settings.airtable.errors.fetch_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  const fetchAirtableTables = async (baseId: string, recordingId: string) => {
    try {
      const response = await axios.get(
        `${apiUrl}/auth/airtable/tables?robotId=${recordingId}&baseId=${baseId}`,
        { withCredentials: true }
      );
      setAirtableTables(response.data);
    }
    catch (error: any) {
      setLoading(false);
      console.error("Error fetching Airtable tables:", error);
      notify("error", t("integration_settings.airtable.errors.fetch_tables_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  }

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
  const handleAirtableBaseSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedBase = airtableBases.find((base) => base.id === e.target.value);
  
    if (selectedBase) {
      setSettings((prevSettings) => ({
        ...prevSettings,
        airtableBaseId: selectedBase.id,
        airtableBaseName: selectedBase.name,
      }));

      if (recordingId) {
        await fetchAirtableTables(selectedBase.id, recordingId);
      } else {
        console.error("Recording ID is null");
      }
    }
  };

  const handleAirtabletableSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedTable = airtableTables.find((table) => table.id === e.target.value);
    if (selectedTable) {
      setSettings((prevSettings) => ({
        ...prevSettings,
        airtableTableId: e.target.value,
        airtableTableName: selectedTable?.name||"",
      }));
    }
  };

  const refreshRecordingData = async () => {
    if (!recordingId) return null;
    const updatedRecording = await getStoredRecording(recordingId);
    setRecording(updatedRecording);
    setRerenderRobots(true);
    return updatedRecording;
  };

  const updateGoogleSheetId = async () => {
    try {
      setLoading(true);
      await axios.post(
        `${apiUrl}/auth/gsheets/update`,
        {
          spreadsheetId: settings.spreadsheetId,
          spreadsheetName: settings.spreadsheetName,
          robotId: recordingId,
        },
        { withCredentials: true }
      );
      
      // Refresh recording data immediately
      await refreshRecordingData();
      
      notify("success", t("integration_settings.google.notifications.sheet_selected"));
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error updating Google Sheet ID:", error);
      notify("error", t("integration_settings.google.errors.update_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Update Airtable integration
  const updateAirtableBase = async () => {
    try {
      setLoading(true);
      await axios.post(
        `${apiUrl}/auth/airtable/update`,
        {
          baseId: settings.airtableBaseId,
          baseName: settings.airtableBaseName,
          robotId: recordingId,
          tableName: settings.airtableTableName,
          tableId: settings.airtableTableId,
        },
        { withCredentials: true }
      );
      
      await refreshRecordingData();
      
      notify("success", t("integration_settings.airtable.notifications.base_selected"));
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error updating Airtable base:", error);
      notify("error", t("integration_settings.airtable.errors.update_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Remove Google Sheets integration
  const removeGoogleSheetsIntegration = async () => {
    try {
      setLoading(true);
      await axios.post(
        `${apiUrl}/auth/gsheets/remove`,
        { robotId: recordingId },
        { withCredentials: true }
      );
      
      // Clear UI state
      setSpreadsheets([]);
      setSettings({ ...settings, spreadsheetId: "", spreadsheetName: "" });
      
      // Refresh recording data
      await refreshRecordingData();
      
      notify("success", t("integration_settings.google.notifications.integration_removed"));
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error removing Google Sheets integration:", error);
      notify("error", t("integration_settings.google.errors.remove_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  // Remove Airtable integration
  const removeAirtableIntegration = async () => {
    try {
      setLoading(true);
      await axios.post(
        `${apiUrl}/auth/airtable/remove`,
        { robotId: recordingId },
        { withCredentials: true }
      );
      
      setAirtableBases([]);
      setAirtableTables([]);
      setSettings({ ...settings, airtableBaseId: "", airtableBaseName: "", airtableTableName:"", airtableTableId: "" });
      
      await refreshRecordingData();
      
      notify("success", t("integration_settings.airtable.notifications.integration_removed"));
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error removing Airtable integration:", error);
      notify("error", t("integration_settings.airtable.errors.remove_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  const handleAirtableOAuthCallback = async () => {
    try {
      const response = await axios.get(`${apiUrl}/auth/airtable/callback`);
      if (response.data.success) {
        await refreshRecordingData();
      }
    } catch (error) {
      setError(t("integration_settings.airtable.errors.auth_error"));
    }
  };

  useEffect(() => {
    const fetchRecordingInfo = async () => {
      if (!recordingId) return;
      
      setLoading(true);
      
      const recording = await getStoredRecording(recordingId);
      if (recording) {
        setRecording(recording);
        
        if (recording.google_sheet_id) {
          setSettings(prev => ({ ...prev, integrationType: "googleSheets" }));
        } else if (recording.airtable_base_id) {
          setSettings(prev => ({
            ...prev,
            airtableBaseId: recording.airtable_base_id || "",
            airtableBaseName: recording.airtable_base_name || "",
            airtableTableName: recording.airtable_table_name || "",
            airtableTableId: recording.airtable_table_id || "",
            integrationType: recording.airtable_base_id ? "airtable" : "googleSheets"
          }));
        }
      }
      
      setLoading(false);
    };
    
    fetchRecordingInfo();
  }, [recordingId, preSelectedIntegrationType]);

  useEffect(() => {
    const status = getCookie("airtable_auth_status");
    const message = getCookie("airtable_auth_message");

    if (status === "success") {
      notify("success", message || t("integration_settings.airtable.notifications.auth_success"));
      removeCookie("airtable_auth_status");
      removeCookie("airtable_auth_message");
      refreshRecordingData();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    if (code) {
      handleAirtableOAuthCallback();
    }
  }, []);

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
            <Button
              variant="contained"
              color="primary"
              onClick={() => {
                setSelectedIntegrationType("googleSheets");
                setSettings({ ...settings, integrationType: "googleSheets" });
                navigate(`/robots/${recordingId}/integrate/google`);
              }}
            >
              Google Sheets
            </Button>

            <Button
              variant="contained"
              color="primary"
              onClick={() => {
                setSelectedIntegrationType("airtable");
                setSettings({ ...settings, integrationType: "airtable" });
                navigate(`/robots/${recordingId}/integrate/airtable`);
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

        {settings.integrationType === "googleSheets" && (
          <>
            <Typography variant="h6">
              {t("integration_settings.google.title")}
            </Typography>

            {recording?.google_sheet_id ? (
              <>
                <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
                  <AlertTitle>{t("integration_settings.google.alerts.success.title")}</AlertTitle>
                  {t("integration_settings.google.alerts.success.content", {
                    sheetName: recording.google_sheet_name,
                  })}
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${recording.google_sheet_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("integration_settings.google.alerts.success.here")}
                  </a>
                </Alert>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={removeGoogleSheetsIntegration}
                  style={{ marginTop: "15px" }}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={24} /> : t("integration_settings.google.buttons.remove_integration")}
                </Button>
              </>
            ) : (
              <>
                {!recording?.google_sheet_email ? (
                  <>
                    <p>{t("integration_settings.google.descriptions.sync_info")}</p>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={authenticateWithGoogle}
                      disabled={loading}
                    >
                      {loading ? <CircularProgress size={24} /> : t("integration_settings.google.buttons.authenticate")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                      {t("integration_settings.google.descriptions.authenticated_as", {
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
                        disabled={loading}
                      >
                        {t("integration_settings.google.buttons.fetch_sheets")}
                      </Button>
                    ) : (
                      <>
                        <TextField
                          sx={{ marginBottom: "15px" }}
                          select
                          label={t("integration_settings.google.fields.select_sheet")}
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
                          onClick={updateGoogleSheetId}
                          style={{ marginTop: "10px" }}
                          disabled={!settings.spreadsheetId || loading}
                        >
                          {loading ? <CircularProgress size={24} /> : t("integration_settings.google.buttons.submit")}
                        </Button>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {settings.integrationType === "airtable" && (
          <>
            <Typography variant="h6">
              {t("integration_settings.airtable.title")}
            </Typography>

            {recording?.airtable_base_id ? (
              <>
                <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
                  <AlertTitle>{t("integration_settings.airtable.alerts.success.title")}</AlertTitle>
                  {t("integration_settings.airtable.alerts.success.content", {
                    baseName: recording.airtable_base_name,
                    tableName: recording.airtable_table_name
                  })}
                  <a
                    href={`https://airtable.com/${recording.airtable_base_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("integration_settings.airtable.alerts.success.here")}
                  </a>
                </Alert>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={removeAirtableIntegration}
                  style={{ marginTop: "15px" }}
                  disabled={loading}
                >
                  {loading ? <CircularProgress size={24} /> : t("integration_settings.airtable.buttons.remove_integration")}
                </Button>
              </>
            ) : (
              <>
                {!recording?.airtable_access_token ? (
                  <>
                    <p>{t("integration_settings.airtable.descriptions.sync_info")}</p>
                    <Button
                      variant="contained"
                      color="primary" 
                      onClick={authenticateWithAirtable}
                      disabled={loading}
                    >
                      {loading ? <CircularProgress size={24} /> : t("integration_settings.airtable.buttons.authenticate")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                      {t("integration_settings.airtable.descriptions.authenticated_as")}
                    </Typography>
                    {loading ? (
                      <CircularProgress sx={{ marginBottom: "15px" }} />
                    ) : error ? (
                      <Typography color="error">{error}</Typography>
                    ) : airtableBases.length === 0 ? (
                      <Button
                        variant="outlined"
                        color="primary" 
                        onClick={fetchAirtableBases}
                        disabled={loading}
                      >
                        {t("integration_settings.airtable.buttons.fetch_bases")}
                      </Button>
                    ) : (
                      <>
                        <TextField
                          sx={{ marginBottom: "15px" }}
                          select
                          label={t("integration_settings.airtable.fields.select_base")}
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
                        <TextField
                          sx={{ marginBottom: "15px" }}
                          select
                          label={t("integration_settings.airtable.fields.select_table")}
                          required
                          value={settings.airtableTableId}
                          onChange={handleAirtabletableSelect}
                          fullWidth
                        >
                          {airtableTables.map((table) => (
                            <MenuItem key={table.id} value={table.id}>
                              {table.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        <Button
                          variant="contained"
                          color="primary" 
                          onClick={updateAirtableBase}
                          style={{ marginTop: "10px" }}
                          disabled={!settings.airtableBaseId || loading}
                        >
                          {loading ? <CircularProgress size={24} /> : t("integration_settings.airtable.buttons.submit")}
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