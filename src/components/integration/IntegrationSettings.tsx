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
  IconButton,
  Box,
  Chip,
  Card,
  CardContent,
  CardActions,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Science as ScienceIcon } from "@mui/icons-material";
import axios from "axios";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { getStoredRecording } from "../../api/storage";
import { apiUrl } from "../../apiConfig.js";
import { v4 as uuid } from "uuid";

import Cookies from "js-cookie";

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { addWebhook, updateWebhook, removeWebhook, getWebhooks, testWebhook,WebhookConfig } from "../../api/webhook";

interface IntegrationProps {
  isOpen: boolean;
  handleStart: (data: IntegrationSettings) => void;
  handleClose: () => void;
  preSelectedIntegrationType?: "googleSheets" | "airtable" | "webhook" | null;
}

export interface IntegrationSettings {
  spreadsheetId?: string;
  spreadsheetName?: string;
  airtableBaseId?: string;
  airtableBaseName?: string;
  airtableTableName?: string,
  airtableTableId?: string,
  webhooks?: WebhookConfig[];
  data: string;
  integrationType: "googleSheets" | "airtable" | "webhook";
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
    webhooks: [],
    data: "",
    integrationType: preSelectedIntegrationType || "googleSheets",
  });

  const [spreadsheets, setSpreadsheets] = useState<{ id: string; name: string }[]>([]);
  const [airtableBases, setAirtableBases] = useState<{ id: string; name: string }[]>([]);
  const [airtableTables, setAirtableTables] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<string | null>(null);
  const [newWebhook, setNewWebhook] = useState<WebhookConfig>({
    id: "",
    url: "",
    events: ["run_completed"],
    active: true,
  });
  const [urlError, setUrlError] = useState<string | null>(null);

  const {
    recordingId,
    notify,
    setRerenderRobots
  } = useGlobalInfoStore();

  const [recording, setRecording] = useState<any>(null);
  const navigate = useNavigate();

  const [selectedIntegrationType, setSelectedIntegrationType] = useState<
    "googleSheets" | "airtable" | "webhook" | null
  >(preSelectedIntegrationType);

  const authenticateWithGoogle = () => {
    window.location.href = `${apiUrl}/auth/google?robotId=${recordingId}`;
  };

  // Authenticate with Airtable
  const authenticateWithAirtable = () => {
    window.location.href = `${apiUrl}/auth/airtable?robotId=${recordingId}`;
  };

  const validateWebhookData = (url: string, events: string[], excludeId?: string) => {
    if (!url) {
      setUrlError("Please provide webhook URL");
      return false;
    }

    try {
      new URL(url);
    } catch {
      setUrlError("Please provide a valid URL");
      return false;
    }

    const existingWebhook = settings.webhooks?.find(
      (webhook) => webhook.url === url && webhook.id !== excludeId
    );

    if (existingWebhook) {
      setUrlError("This webhook URL is already in use");
      return false;
    }

    if (!events || events.length === 0) {
      setUrlError("Please select at least one event");
      return false;
    }

    setUrlError(null);
    return true;
  };

  const fetchWebhooks = async () => {
    try {
      setLoading(true);
      if (!recordingId) return;

      const response = await getWebhooks(recordingId);

      if (response.ok && response.webhooks) {
        setSettings(prev => ({
          ...prev,
          webhooks: response.webhooks
        }));
      } else {
        notify("error", response.error || "Failed to fetch webhooks");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error fetching webhooks:", error);
      notify("error", "Failed to fetch webhooks");
    }
  };

  const addWebhookSetting = async () => {
    if (!validateWebhookData(newWebhook.url, newWebhook.events)) {
      if (!newWebhook.url) {
        notify("error", "Please provide webhook URL");
      } else if (!newWebhook.events || newWebhook.events.length === 0) {
        notify("error", "Please select at least one event");
      }
      return;
    }

    if (!recordingId) return;

    try {
      setLoading(true);
      const webhookWithId = {
        ...newWebhook,
        id: uuid(),
      };

      const response = await addWebhook(webhookWithId, recordingId);

      if (response.ok) {
        const updatedWebhooks = [...(settings.webhooks || []), webhookWithId];
        setSettings({ ...settings, webhooks: updatedWebhooks });
        
        resetWebhookForm();
        await refreshRecordingData();
        notify("success", "Webhook added successfully");
      } else {
        notify("error", response.error || "Failed to add webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.log("Error adding webhook:", error);
      notify("error", "Failed to add webhook");
    }
  };

  const updateWebhookSetting = async () => {
    if (!editingWebhook || !recordingId) return;

    if (!validateWebhookData(newWebhook.url, newWebhook.events, editingWebhook)) {
      if (!newWebhook.url) {
        notify("error", "Please provide webhook URL");
      } else if (!newWebhook.events || newWebhook.events.length === 0) {
        notify("error", "Please select at least one event");
      }
      return;
    }

    try {
      setLoading(true);
      const response = await updateWebhook(newWebhook, recordingId);

      if (response.ok) {
        const updatedWebhooks = (settings.webhooks || []).map(w => 
          w.id === editingWebhook ? newWebhook : w
        );
        setSettings({ ...settings, webhooks: updatedWebhooks });

        resetWebhookForm();
        await refreshRecordingData();
        notify("success", "Webhook updated successfully");
      } else {
        notify("error", response.error || "Failed to update webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error updating webhook:", error);
      notify("error", "Failed to update webhook");
    }
  };

  const removeWebhookSetting = async (webhookId: string) => {
    if (!recordingId) return;

    try {
      setLoading(true);
      const response = await removeWebhook(webhookId, recordingId);

      if (response.ok) {
        const updatedWebhooks = (settings.webhooks || []).filter(w => w.id !== webhookId);
        setSettings({ ...settings, webhooks: updatedWebhooks });

        await refreshRecordingData();
        notify("success", "Webhook removed successfully");
      } else {
        notify("error", response.error || "Failed to remove webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error removing webhook:", error);
      notify("error", "Failed to remove webhook");
    }
  };

  const toggleWebhookStatusSetting = async (webhookId: string) => {
    if (!recordingId) return;

    try {
      const webhook = settings.webhooks?.find(w => w.id === webhookId);
      if (!webhook) return;

      const updatedWebhook = { ...webhook, active: !webhook.active };
      
      const response = await updateWebhook(updatedWebhook, recordingId);

      if (response.ok) {
        const updatedWebhooks = (settings.webhooks || []).map(w => 
          w.id === webhookId ? updatedWebhook : w
        );
        setSettings({ ...settings, webhooks: updatedWebhooks });

        await refreshRecordingData();
        notify("success", `Webhook ${updatedWebhook.active ? "enabled" : "disabled"}`);
      } else {
        notify("error", response.error || "Failed to update webhook");
      }
    } catch (error: any) {
      console.error("Error toggling webhook status:", error);
      notify("error", "Failed to update webhook");
    }
  };

  const testWebhookSetting = async (webhook: WebhookConfig) => {
    if (!recordingId) return;

    try {
      setLoading(true);
      const response = await testWebhook(webhook, recordingId);

      if (response.ok) {
        const updatedWebhooks = (settings.webhooks || []).map(w => 
          w.id === webhook.id ? { ...w, lastCalledAt: new Date().toISOString() } : w
        );
        setSettings({ ...settings, webhooks: updatedWebhooks });

        notify("success", "Test webhook sent successfully");
      } else {
        notify("error", response.error || "Failed to test webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error testing webhook:", error);
      notify("error", "Failed to test webhook");
    }
  };

  const editWebhookSetting = (webhook: WebhookConfig) => {
    setNewWebhook(webhook);
    setEditingWebhook(webhook.id);
    setShowWebhookForm(true);
  };

  const resetWebhookForm = () => {
    setNewWebhook({
      id: "",
      url: "",
      events: ["run_completed"],
      active: true,
    });
    setShowWebhookForm(false);
    setEditingWebhook(null);
    setUrlError(null); 
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
        airtableTableName: selectedTable?.name || "",
      }));
    }
  };

  const refreshRecordingData = async () => {
    if (!recordingId) return null;
    const updatedRecording = await getStoredRecording(recordingId);
    setRecording(updatedRecording);
    
    await fetchWebhooks();
    
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
      setSettings({ ...settings, airtableBaseId: "", airtableBaseName: "", airtableTableName: "", airtableTableId: "" });

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

        if (preSelectedIntegrationType) {
          setSettings(prev => ({ ...prev, integrationType: preSelectedIntegrationType }));
        } else if (recording.google_sheet_id) {
          setSettings(prev => ({ ...prev, integrationType: "googleSheets" }));
        } else if (recording.airtable_base_id) {
          setSettings(prev => ({
            ...prev,
            airtableBaseId: recording.airtable_base_id || "",
            airtableBaseName: recording.airtable_base_name || "",
            airtableTableName: recording.airtable_table_name || "",
            airtableTableId: recording.airtable_table_id || "",
            integrationType: "airtable"
          }));
        }

        await fetchWebhooks();
        
        if (!preSelectedIntegrationType && !recording.google_sheet_id && !recording.airtable_base_id) {
          const webhookResponse = await getWebhooks(recordingId);
          if (webhookResponse.ok && webhookResponse.webhooks && webhookResponse.webhooks.length > 0) {
            setSettings(prev => ({ ...prev, integrationType: "webhook" }));
          }
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

  const formatEventName = (event: string) => {
    switch (event) {
      case "run_completed":
        return "Run finished";
      case "run_failed":
        return "Run failed";
      default:
        return event;
    }
  };

  const formatLastCalled = (lastCalledAt?: string | null) => {
    if (!lastCalledAt) {
      return "Not called yet";
    }

    const date = new Date(lastCalledAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) {
      return "Just now";
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

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
          <div style={{ display: "flex", gap: "20px" }}>
            <Button
              variant="outlined"
              onClick={() => {
                setSelectedIntegrationType("googleSheets");
                setSettings({ ...settings, integrationType: "googleSheets" });
                navigate(`/robots/${recordingId}/integrate/google`);
              }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}
            >
              <img src="/svg/gsheet.svg" alt="Google Sheets" style={{ margin: "6px" }} />
              Google Sheets
            </Button>

            <Button
              variant="outlined"
              onClick={() => {
                setSelectedIntegrationType("airtable");
                setSettings({ ...settings, integrationType: "airtable" });
                navigate(`/robots/${recordingId}/integrate/airtable`);
              }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}
            >
              <img src="/svg/airtable.svg" alt="Airtable" style={{ margin: "6px" }} />
              Airtable
            </Button>

            <Button
              variant="outlined"
              onClick={() => {
                setSelectedIntegrationType("webhook");
                setSettings({ ...settings, integrationType: "webhook" });
                navigate(`/robots/${recordingId}/integrate/webhook`);
              }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}
            >
              <img src="/svg/webhook.svg" alt="Webhook" style={{ margin: "6px" }} />
              Webhooks
            </Button>

            <Button
              variant="outlined"
              onClick={() => {
                window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer");
              }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}
            >
              <img src="/svg/mcp.svg" alt="MCP" style={{ margin: "6px" }} />
              MCP
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
        maxWidth: "1000px",
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
                    style={{ marginLeft: "4px", fontWeight: "bold" }}
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
                    style={{ marginLeft: "4px", fontWeight: "bold" }}
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

        {settings.integrationType === "webhook" && (
          <>
            <Typography variant="h6" sx={{ marginBottom: "20px" }}>
              Integrate using Webhooks
            </Typography>

            {settings.webhooks && settings.webhooks.length > 0 && (
              <TableContainer component={Paper} sx={{ marginBottom: "30px", width: "100%" }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Webhook URL</strong></TableCell>
                      <TableCell><strong>Call when</strong></TableCell>
                      <TableCell><strong>Last called</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>Actions</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {settings.webhooks.map((webhook) => (
                      <TableRow key={webhook.id}>
                        <TableCell>{webhook.url}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {webhook.events.map((event) => (
                              <Chip 
                                key={event} 
                                label={formatEventName(event)} 
                                size="small"
                                variant="outlined"
                              />
                            ))}
                          </Box>
                        </TableCell>
                        <TableCell>{formatLastCalled(webhook.lastCalledAt)}</TableCell>
                        <TableCell>
                          <Switch
                            checked={webhook.active}
                            onChange={() => toggleWebhookStatusSetting(webhook.id)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", gap: "8px" }}>
                            <IconButton
                              size="small"
                              onClick={() => testWebhookSetting(webhook)}
                              disabled={loading || !webhook.active}
                              title="Test"
                            >
                              <ScienceIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => editWebhookSetting(webhook)}
                              disabled={loading}
                              title="Edit"
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => removeWebhookSetting(webhook.id)}
                              disabled={loading}
                              title="Delete"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {!showWebhookForm && (
              <Box sx={{ marginBottom: "20px", width: "100%" }}>
                <Box sx={{ display: "flex", gap: "15px", alignItems: "center", marginBottom: "15px" }}>
                  <TextField
                    label="Webhook URL"
                    placeholder="https://your-api.com/webhook/endpoint"
                    sx={{ flex: 1 }}
                    value={newWebhook.url}
                    onChange={(e) => {
                      setNewWebhook({ ...newWebhook, url: e.target.value });
                      if (urlError) setUrlError(null);
                    }}
                    error={!!urlError}
                    helperText={urlError}
                    required
                    aria-describedby="webhook-url-help"
                  />
                  <TextField
                    select
                    label="When"
                    value={newWebhook.events[0] || "run_completed"}
                    onChange={(e) => setNewWebhook({ 
                      ...newWebhook, 
                      events: [e.target.value]
                    })}
                    sx={{ minWidth: "200px" }}
                    required
                  >
                    <MenuItem value="run_completed">Run finished</MenuItem>
                    <MenuItem value="run_failed">Run failed</MenuItem>
                  </TextField>
                </Box>
                
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="textSecondary" sx={{ marginTop: "10px" }}>
                    Refer to the <a href="https://docs.maxun.dev/api/webhooks" style={{ color: '#ff00c3', textDecoration: 'none' }}>API documentation</a> for examples and details.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={addWebhookSetting}
                    disabled={!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0 || loading || !!urlError}
                  >
                    Add New Webhook
                  </Button>
                </Box>
              </Box>
            )}

            {showWebhookForm && (
              <Card sx={{ width: "100%", marginBottom: "20px" }}>
                <CardContent>
                  <Typography variant="h6" sx={{ marginBottom: "20px" }}>
                    {editingWebhook ? "Edit Webhook" : "Add New Webhook"}
                  </Typography>
                  
                  <TextField
                    fullWidth
                    label="Webhook URL"
                    value={newWebhook.url}
                    onChange={(e) => {
                      setNewWebhook({ ...newWebhook, url: e.target.value });
                      if (urlError) setUrlError(null);
                    }}
                    sx={{ marginBottom: "15px" }}
                    placeholder="https://your-api.com/webhook/endpoint"
                    required
                    error={!!urlError}
                    helperText={urlError}
                  />

                  <TextField
                    fullWidth
                    select
                    label="Call when"
                    value={newWebhook.events}
                    onChange={(e) => setNewWebhook({ 
                      ...newWebhook, 
                      events: typeof e.target.value === 'string' ? [e.target.value] : e.target.value 
                    })}
                    SelectProps={{
                      multiple: true,
                      renderValue: (selected) => (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {(selected as string[]).map((value) => (
                            <Chip key={value} label={formatEventName(value)} size="small" />
                          ))}
                        </Box>
                      ),
                    }}
                    sx={{ marginBottom: "20px" }}
                    required
                  >
                    <MenuItem value="run_completed">Run finished</MenuItem>
                    <MenuItem value="run_failed">Run failed</MenuItem>
                  </TextField>
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={newWebhook.active}
                        onChange={(e) => setNewWebhook({ ...newWebhook, active: e.target.checked })}
                      />
                    }
                    label="Active"
                    sx={{ marginBottom: "10px" }}
                  />
                </CardContent>
                
                <CardActions>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={editingWebhook ? updateWebhookSetting : addWebhookSetting}
                    disabled={!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0 || loading || !!urlError}
                  >
                    {loading ? (
                      <CircularProgress size={24} />
                    ) : (
                      editingWebhook ? "Update Webhook" : "Add Webhook"
                    )}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={resetWebhookForm}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                </CardActions>
              </Card>
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
  width: "60%",
  backgroundColor: "background.paper",
  p: 4,
  height: "fit-content",
  display: "block",
  padding: "20px",
  maxHeight: "90vh",
  overflow: "auto",
};
