import React, { useState, useEffect } from "react";
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
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Science as ScienceIcon,
} from "@mui/icons-material";
import axios from "axios";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import { getStoredRecording } from "../../../api/storage";
import { apiUrl } from "../../../apiConfig.js";
import { v4 as uuid } from "uuid";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import {
  addWebhook,
  updateWebhook,
  removeWebhook,
  getWebhooks,
  testWebhook,
  WebhookConfig,
} from "../../../api/webhook";
import { RobotConfigPage } from "./RobotConfigPage";

interface IntegrationProps {
  handleStart: (data: IntegrationSettings) => void;
  robotPath?: string;
  preSelectedIntegrationType?: "googleSheets" | "airtable" | "webhook" | null;
}

export interface IntegrationSettings {
  spreadsheetId?: string;
  spreadsheetName?: string;
  airtableBaseId?: string;
  airtableBaseName?: string;
  airtableTableName?: string;
  airtableTableId?: string;
  webhooks?: WebhookConfig[];
  data: string;
  integrationType: "googleSheets" | "airtable" | "webhook";
}

export const RobotIntegrationPage = ({
  handleStart,
  robotPath = "robots",
  preSelectedIntegrationType = null,
}: IntegrationProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const pathSegments = location.pathname.split('/');
  const robotsIndex = pathSegments.findIndex(segment => segment === 'robots' || segment === 'prebuilt-robots');
  const integrateIndex = pathSegments.findIndex(segment => segment === 'integrate');

  const robotIdFromUrl = robotsIndex !== -1 && robotsIndex + 1 < pathSegments.length
    ? pathSegments[robotsIndex + 1]
    : null;

  const integrationType = integrateIndex !== -1 && integrateIndex + 1 < pathSegments.length
    ? pathSegments[integrateIndex + 1] as "googleSheets" | "airtable" | "webhook"
    : preSelectedIntegrationType || null;

  const [settings, setSettings] = useState<IntegrationSettings>({
    spreadsheetId: "",
    spreadsheetName: "",
    airtableBaseId: "",
    airtableBaseName: "",
    airtableTableName: "",
    airtableTableId: "",
    webhooks: [],
    data: "",
    integrationType: integrationType || "airtable",
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

  const { recordingId: recordingIdFromStore, notify, setRerenderRobots, setRecordingId } = useGlobalInfoStore();

  const recordingId = robotIdFromUrl || recordingIdFromStore;

  useEffect(() => {
    if (robotIdFromUrl && robotIdFromUrl !== recordingIdFromStore) {
      setRecordingId(robotIdFromUrl);
    }
  }, [robotIdFromUrl, recordingIdFromStore, setRecordingId]);

  const [recording, setRecording] = useState<any>(null);
  const [selectedIntegrationType, setSelectedIntegrationType] = useState<
    "googleSheets" | "airtable" | "webhook" | null
  >(integrationType);

  const isScrapeRobot = recording?.recording_meta?.type === "scrape";

  const authenticateWithGoogle = () => {
    if (!recordingId) {
      console.error("Cannot authenticate: recordingId is null");
      return;
    }
    const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
    const redirectUrl = `${window.location.origin}${basePath}/${recordingId}/integrate/googleSheets`;
    window.location.href = `${apiUrl}/auth/google?robotId=${recordingId}&redirectUrl=${encodeURIComponent(redirectUrl)}`;
  };

  const authenticateWithAirtable = () => {
    if (!recordingId) {
      console.error("Cannot authenticate: recordingId is null");
      return;
    }
    const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
    const redirectUrl = `${window.location.origin}${basePath}/${recordingId}/integrate/airtable`;
    window.location.href = `${apiUrl}/auth/airtable?robotId=${recordingId}&redirectUrl=${encodeURIComponent(redirectUrl)}`;
  };

  const validateWebhookData = (
    url: string,
    events: string[],
    excludeId?: string
  ) => {
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
        setSettings((prev) => ({ ...prev, webhooks: response.webhooks }));
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error fetching webhooks:", error);
    }
  };

  const addWebhookSetting = async () => {
    if (!validateWebhookData(newWebhook.url, newWebhook.events)) {
      if (!newWebhook.url) notify("error", "Please provide webhook URL");
      else if (!newWebhook.events || newWebhook.events.length === 0) notify("error", "Please select at least one event");
      return;
    }
    if (!recordingId) return;
    try {
      setLoading(true);
      const webhookWithId = { ...newWebhook, id: uuid() };
      const response = await addWebhook(webhookWithId, recordingId);
      if (response.ok) {
        setSettings((prev) => ({ ...prev, webhooks: [...(prev.webhooks || []), webhookWithId] }));
        setNewWebhook({ id: "", url: "", events: ["run_completed"], active: true });
        setShowWebhookForm(false);
        notify("success", "Webhook added successfully");
      } else {
        notify("error", response.message || "Failed to add webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      notify("error", "Failed to add webhook");
      console.error("Error adding webhook:", error);
    }
  };

  const updateWebhookSetting = async () => {
    if (!validateWebhookData(newWebhook.url, newWebhook.events, editingWebhook || undefined)) return;
    if (!recordingId || !editingWebhook) return;
    try {
      setLoading(true);
      const response = await updateWebhook({ ...newWebhook, id: editingWebhook }, recordingId);
      if (response.ok) {
        setSettings((prev) => ({
          ...prev,
          webhooks: (prev.webhooks || []).map((webhook) =>
            webhook.id === editingWebhook ? { ...newWebhook, id: editingWebhook } : webhook
          ),
        }));
        setNewWebhook({ id: "", url: "", events: ["run_completed"], active: true });
        setEditingWebhook(null);
        setShowWebhookForm(false);
        notify("success", "Webhook updated successfully");
      } else {
        notify("error", response.message || "Failed to update webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      notify("error", "Failed to update webhook");
      console.error("Error updating webhook:", error);
    }
  };

  const deleteWebhookSetting = async (webhookId: string) => {
    if (!recordingId) return;
    try {
      setLoading(true);
      const response = await removeWebhook(webhookId, recordingId);
      if (response.ok) {
        setSettings((prev) => ({ ...prev, webhooks: (prev.webhooks || []).filter((webhook) => webhook.id !== webhookId) }));
        if (recordingId) {
          const updatedRecording = await getStoredRecording(recordingId);
          setRecording(updatedRecording);
        }
        setRerenderRobots(true);
        notify("success", "Webhook removed successfully");
      } else {
        notify("error", response.error || "Failed to remove webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      notify("error", "Failed to remove webhook");
      console.error("Error removing webhook:", error);
    }
  };

  const testWebhookSetting = async (webhookId: string) => {
    if (!recordingId) return;
    const webhook = settings.webhooks?.find(w => w.id === webhookId);
    if (!webhook) return;
    try {
      setLoading(true);
      const response = await testWebhook(webhook, recordingId);
      if (response.ok) {
        notify("success", "Test webhook sent successfully");
      } else {
        notify("error", response.message || "Failed to test webhook");
      }
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      notify("error", "Failed to test webhook");
      console.error("Error testing webhook:", error);
    }
  };

  useEffect(() => {
    setSelectedIntegrationType(integrationType);
    setSettings(prev => ({ ...prev, integrationType: integrationType || "airtable" }));
  }, [integrationType]);

  useEffect(() => {
    const fetchRecording = async () => {
      if (recordingId) {
        try {
          const recordingData = await getStoredRecording(recordingId);
          setRecording(recordingData);
        } catch (error) {
          console.error("Failed to fetch recording:", error);
        }
      }
    };
    fetchRecording();
    if (selectedIntegrationType === "webhook") {
      fetchWebhooks();
    }
  }, [recordingId, selectedIntegrationType]);

  const handleCancel = () => {
    const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
    navigate(basePath);
  };

  const fetchSpreadsheetFiles = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/auth/gsheets/files?robotId=${recordingId}`, { withCredentials: true });
      setSpreadsheets(response.data);
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error fetching spreadsheet files:", error);
      notify("error", t("integration_settings.google.errors.fetch_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  const handleSpreadsheetSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedSheet = spreadsheets.find((sheet) => sheet.id === e.target.value);
    if (selectedSheet) {
      setSettings({ ...settings, spreadsheetId: selectedSheet.id, spreadsheetName: selectedSheet.name });
    }
  };

  const updateGoogleSheetId = async () => {
    try {
      setLoading(true);
      await axios.post(`${apiUrl}/auth/gsheets/update`, {
        spreadsheetId: settings.spreadsheetId,
        spreadsheetName: settings.spreadsheetName,
        robotId: recordingId,
      }, { withCredentials: true });
      if (recordingId) {
        const updatedRecording = await getStoredRecording(recordingId);
        setRecording(updatedRecording);
      }
      setRerenderRobots(true);
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

  const removeGoogleSheetsIntegration = async () => {
    try {
      setLoading(true);
      await axios.post(`${apiUrl}/auth/gsheets/remove`, { robotId: recordingId }, { withCredentials: true });
      setSpreadsheets([]);
      setSettings({ ...settings, spreadsheetId: "", spreadsheetName: "" });
      if (recordingId) {
        const updatedRecording = await getStoredRecording(recordingId);
        setRecording(updatedRecording);
      }
      setRerenderRobots(true);
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

  const fetchAirtableBases = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${apiUrl}/auth/airtable/bases?robotId=${recordingId}`, { withCredentials: true });
      setAirtableBases(response.data);
      setLoading(false);
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
      setLoading(true);
      const response = await axios.get(`${apiUrl}/auth/airtable/tables?robotId=${recordingId}&baseId=${baseId}`, { withCredentials: true });
      setAirtableTables(response.data);
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("Error fetching Airtable tables:", error);
      notify("error", t("integration_settings.airtable.errors.fetch_tables_error", {
        message: error.response?.data?.message || error.message,
      }));
    }
  };

  const handleAirtableBaseSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedBase = airtableBases.find((base) => base.id === e.target.value);
    if (selectedBase) {
      setSettings((prevSettings) => ({ ...prevSettings, airtableBaseId: selectedBase.id, airtableBaseName: selectedBase.name }));
      if (recordingId) await fetchAirtableTables(selectedBase.id, recordingId);
    }
  };

  const handleAirtabletableSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedTable = airtableTables.find((table) => table.id === e.target.value);
    if (selectedTable) {
      setSettings((prevSettings) => ({ ...prevSettings, airtableTableId: e.target.value, airtableTableName: selectedTable?.name || "" }));
    }
  };

  const updateAirtableBase = async () => {
    try {
      setLoading(true);
      await axios.post(`${apiUrl}/auth/airtable/update`, {
        baseId: settings.airtableBaseId,
        baseName: settings.airtableBaseName,
        robotId: recordingId,
        tableName: settings.airtableTableName,
        tableId: settings.airtableTableId,
      }, { withCredentials: true });
      if (recordingId) {
        const updatedRecording = await getStoredRecording(recordingId);
        setRecording(updatedRecording);
      }
      setRerenderRobots(true);
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

  const removeAirtableIntegration = async () => {
    try {
      setLoading(true);
      await axios.post(`${apiUrl}/auth/airtable/remove`, { robotId: recordingId }, { withCredentials: true });
      setAirtableBases([]);
      setAirtableTables([]);
      setSettings({ ...settings, airtableBaseId: "", airtableBaseName: "", airtableTableName: "", airtableTableId: "" });
      if (recordingId) {
        const updatedRecording = await getStoredRecording(recordingId);
        setRecording(updatedRecording);
      }
      setRerenderRobots(true);
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

  const renderGoogleSheetsIntegration = () => (
    <>
      <Typography variant="h6">
        {t("integration_settings.google.title")}
      </Typography>
      {recording?.google_sheet_id ? (
        <>
          <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
            <AlertTitle>{t("integration_settings.google.alerts.success.title")}</AlertTitle>
            {t("integration_settings.google.alerts.success.content", { sheetName: recording.google_sheet_name })}
            <a href={`https://docs.google.com/spreadsheets/d/${recording.google_sheet_id}`} target="_blank" rel="noreferrer" style={{ marginLeft: "4px", fontWeight: "bold" }}>
              {t("integration_settings.google.alerts.success.here")}
            </a>
          </Alert>
          <Button variant="outlined" color="error" onClick={removeGoogleSheetsIntegration} style={{ marginTop: "15px" }} disabled={loading}>
            {loading ? <CircularProgress size={24} /> : t("integration_settings.google.buttons.remove_integration")}
          </Button>
        </>
      ) : (
        <>
          {!recording?.google_sheet_email ? (
            <>
              <p>{t("integration_settings.google.descriptions.sync_info")}</p>
              <Button variant="contained" color="primary" onClick={authenticateWithGoogle} disabled={loading}>
                {loading ? <CircularProgress size={24} /> : t("integration_settings.google.buttons.authenticate")}
              </Button>
            </>
          ) : (
            <>
              <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                {t("integration_settings.google.descriptions.authenticated_as", { email: recording.google_sheet_email })}
              </Typography>
              {loading ? (
                <CircularProgress sx={{ marginBottom: "15px" }} />
              ) : error ? (
                <Typography color="error">{error}</Typography>
              ) : spreadsheets.length === 0 ? (
                <Button variant="outlined" color="primary" onClick={fetchSpreadsheetFiles} disabled={loading}>
                  {t("integration_settings.google.buttons.fetch_sheets")}
                </Button>
              ) : (
                <>
                  <TextField sx={{ marginBottom: "15px" }} select label={t("integration_settings.google.fields.select_sheet")} required value={settings.spreadsheetId} onChange={handleSpreadsheetSelect} fullWidth>
                    {spreadsheets.map((sheet) => (<MenuItem key={sheet.id} value={sheet.id}>{sheet.name}</MenuItem>))}
                  </TextField>
                  <Button variant="contained" color="primary" onClick={updateGoogleSheetId} style={{ marginTop: "10px" }} disabled={!settings.spreadsheetId || loading}>
                    {loading ? <CircularProgress size={24} /> : t("integration_settings.google.buttons.submit")}
                  </Button>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  const renderAirtableIntegration = () => (
    <>
      <Typography variant="h6">
        {t("integration_settings.airtable.title")}
      </Typography>
      {recording?.airtable_base_id ? (
        <>
          <Alert severity="info" sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}>
            <AlertTitle>{t("integration_settings.airtable.alerts.success.title")}</AlertTitle>
            {t("integration_settings.airtable.alerts.success.content", { baseName: recording.airtable_base_name, tableName: recording.airtable_table_name })}
            <a href={`https://airtable.com/${recording.airtable_base_id}`} target="_blank" rel="noreferrer" style={{ marginLeft: "4px", fontWeight: "bold" }}>
              {t("integration_settings.airtable.alerts.success.here")}
            </a>
          </Alert>
          <Button variant="outlined" color="error" onClick={removeAirtableIntegration} style={{ marginTop: "15px" }} disabled={loading}>
            {loading ? <CircularProgress size={24} /> : t("integration_settings.airtable.buttons.remove_integration")}
          </Button>
        </>
      ) : (
        <>
          {!recording?.airtable_access_token ? (
            <>
              <p>{t("integration_settings.airtable.descriptions.sync_info")}</p>
              <Button variant="contained" color="primary" onClick={authenticateWithAirtable} disabled={loading}>
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
                <Box sx={{ display: "flex", gap: "15px", alignItems: "center", marginBottom: "20px" }}>
                  <Button variant="outlined" color="primary" onClick={fetchAirtableBases} disabled={loading}>
                    {t("integration_settings.airtable.buttons.fetch_bases")}
                  </Button>
                  <Button variant="outlined" color="error" onClick={removeAirtableIntegration} disabled={loading}>
                    {loading ? <CircularProgress size={24} /> : t("integration_settings.airtable.buttons.remove_integration")}
                  </Button>
                </Box>
              ) : (
                <>
                  <TextField sx={{ marginBottom: "15px" }} select label={t("integration_settings.airtable.fields.select_base")} required value={settings.airtableBaseId} onChange={handleAirtableBaseSelect} fullWidth>
                    {airtableBases.map((base) => (<MenuItem key={base.id} value={base.id}>{base.name}</MenuItem>))}
                  </TextField>
                  <TextField sx={{ marginBottom: "15px" }} select label={t("integration_settings.airtable.fields.select_table")} required value={settings.airtableTableId} onChange={handleAirtabletableSelect} fullWidth>
                    {airtableTables.map((table) => (<MenuItem key={table.id} value={table.id}>{table.name}</MenuItem>))}
                  </TextField>
                  <Button variant="contained" color="primary" onClick={updateAirtableBase} style={{ marginTop: "10px" }} disabled={!settings.airtableBaseId || loading}>
                    {loading ? <CircularProgress size={24} /> : t("integration_settings.airtable.buttons.submit")}
                  </Button>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  const getIntegrationTitle = () => {
    switch (selectedIntegrationType) {
      case "googleSheets":
        return "Google Sheets Integration";
      case "airtable":
        return "Airtable Integration";
      case "webhook":
        return "Webhook Integration";
      default:
        return "Integrations";
    }
  };

  const editWebhookSetting = (webhook: WebhookConfig) => {
    setNewWebhook(webhook);
    setEditingWebhook(webhook.id);
    setShowWebhookForm(true);
  };

  const resetWebhookForm = () => {
    setNewWebhook({ id: "", url: "", events: ["run_completed"], active: true });
    setShowWebhookForm(false);
    setEditingWebhook(null);
    setUrlError(null);
  };

  const toggleWebhookStatusSetting = async (webhookId: string) => {
    if (!recordingId) return;
    try {
      const webhook = settings.webhooks?.find((w) => w.id === webhookId);
      if (!webhook) return;
      const updatedWebhook = { ...webhook, active: !webhook.active };
      const response = await updateWebhook(updatedWebhook, recordingId);
      if (response.ok) {
        const updatedWebhooks = (settings.webhooks || []).map((w) => w.id === webhookId ? updatedWebhook : w);
        setSettings({ ...settings, webhooks: updatedWebhooks });
        if (recordingId) {
          const updatedRecording = await getStoredRecording(recordingId);
          setRecording(updatedRecording);
        }
        setRerenderRobots(true);
        notify("success", `Webhook ${updatedWebhook.active ? "enabled" : "disabled"}`);
      } else {
        notify("error", response.message || "Failed to update webhook");
      }
    } catch (error: any) {
      console.error("Error toggling webhook status:", error);
      notify("error", "Failed to update webhook");
    }
  };

  const formatEventName = (event: string) => {
    switch (event) {
      case "run_completed": return "Run finished";
      case "run_failed": return "Run failed";
      default: return event;
    }
  };

  const formatLastCalled = (lastCalledAt?: string | null) => {
    if (!lastCalledAt) return "Not called yet";
    const date = new Date(lastCalledAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 1) return "Just now";
    else if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
    else if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    else if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    else return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const handleBack = () => {
    if (!recordingId) {
      console.error("Cannot navigate: recordingId is null");
      return;
    }

    setSelectedIntegrationType(null);
    setSettings({ ...settings, integrationType: "airtable" });
    const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
    navigate(`${basePath}/${recordingId}/integrate`);
  };

  // --- MAIN RENDER ---
  if (!selectedIntegrationType && !integrationType) {
    return (
      <RobotConfigPage
        title={getIntegrationTitle()}
        onCancel={handleCancel}
        cancelButtonText={t("buttons.cancel")}
        showSaveButton={false}
        // onBackToSelection={handleBack}
        // onArrowBack={handleBack}
        showCancelButton={false}
        backToSelectionText={t("buttons.back_arrow")}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            position: "relative",
            minHeight: "400px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(160px, 1fr))",
                gap: "20px",
                justifyContent: "start",
                maxWidth: "900px",
                width: "100%",
              }}
            >
              {!isScrapeRobot && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    if (!recordingId) return;
                    setSelectedIntegrationType("googleSheets");
                    setSettings({ ...settings, integrationType: "googleSheets" });
                    const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
                    navigate(`${basePath}/${recordingId}/integrate/googleSheets`);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "white",
                    color: "#ff00c3",
                  }}
                >
                  <img
                    src="https://ik.imagekit.io/ys1blv5kv/gsheet.svg"
                    alt="Google Sheets"
                    style={{ margin: "6px" }}
                  />
                  Google Sheets
                </Button>
              )}

              {!isScrapeRobot && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    if (!recordingId) return;
                    setSelectedIntegrationType("airtable");
                    setSettings({ ...settings, integrationType: "airtable" });
                    const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
                    navigate(`${basePath}/${recordingId}/integrate/airtable`);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "white",
                    color: "#ff00c3",
                  }}
                >
                  <img
                    src="https://ik.imagekit.io/ys1blv5kv/airtable.svg"
                    alt="Airtable"
                    style={{ margin: "6px" }}
                  />
                  Airtable
                </Button>
              )}


              <Button variant="outlined" onClick={() => {
                if (!recordingId) return;
                setSelectedIntegrationType("webhook");
                setSettings({ ...settings, integrationType: "webhook" });
                const basePath = robotPath === "prebuilt-robots" ? "/prebuilt-robots" : "/robots";
                navigate(`${basePath}/${recordingId}/integrate/webhook`);
              }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/webhook.svg" alt="Webhook" style={{ margin: "6px" }} />
                Webhooks
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/mcp.svg" alt="MCP" style={{ margin: "6px" }} />
                MCP
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/langchain.svg" alt="MCP" style={{ margin: "6px" }} height={150} width={100} />
                LangChain
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/langchain.svg" alt="MCP" style={{ margin: "6px" }} height={150} width={100} />
                LangGraph
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/vercel.svg" alt="MCP" style={{ margin: "6px" }} height={150} width={100} />
                Vercel AI SDK
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/openai.svg" alt="MCP" style={{ margin: "6px" }} height={150} width={100} />
                Open AI SDK
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/mastra.svg" alt="MCP" style={{ margin: "6px" }} height={150} width={100} />
                Mastra
              </Button>
              <Button variant="outlined" onClick={() => { window.open("https://docs.maxun.dev/mcp/setup", "_blank", "noopener,noreferrer"); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", background: 'white', color: '#ff00c3' }}>
                <img src="/svg/llamaindex.svg" alt="MCP" style={{ margin: "6px" }} height={150} width={100} />
                LlamaIndex
              </Button>
            </div>
          </div>
        </div>
      </RobotConfigPage>
    );
  }

  return (
    <RobotConfigPage
      title={getIntegrationTitle()}
      // onCancel={handleCancel}
      cancelButtonText={t("buttons.cancel")}
      showSaveButton={false}
      // onBackToSelection={handleBack}
      onArrowBack={handleBack}
      showCancelButton={false}
      backToSelectionText={t("buttons.back_arrow")}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", position: "relative", minHeight: "400px" }}>
        <div style={{ width: "100%" }}>
          {(selectedIntegrationType === "googleSheets" || integrationType === "googleSheets") && (
            <>{renderGoogleSheetsIntegration()}</>
          )}

          {(selectedIntegrationType === "airtable" || integrationType === "airtable") && (
            <>{renderAirtableIntegration()}</>
          )}

          {(selectedIntegrationType === "webhook" || integrationType === "webhook") && (
            <>
              <Typography variant="h6" sx={{ marginBottom: "20px" }}>Integrate using Webhooks</Typography>
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
                          <TableCell><Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>{webhook.events.map((event) => (<Chip key={event} label={formatEventName(event)} size="small" variant="outlined" />))}</Box></TableCell>
                          <TableCell>{formatLastCalled(webhook.lastCalledAt)}</TableCell>
                          <TableCell><Switch checked={webhook.active} onChange={() => toggleWebhookStatusSetting(webhook.id)} size="small" /></TableCell>
                          <TableCell><Box sx={{ display: "flex", gap: "8px" }}>
                            <IconButton size="small" onClick={() => testWebhookSetting(webhook.id)} disabled={loading || !webhook.active} title="Test"><ScienceIcon fontSize="small" /></IconButton>
                            <IconButton size="small" onClick={() => editWebhookSetting(webhook)} disabled={loading} title="Edit"><EditIcon fontSize="small" /></IconButton>
                            <IconButton size="small" onClick={() => deleteWebhookSetting(webhook.id)} disabled={loading} title="Delete"><DeleteIcon fontSize="small" /></IconButton>
                          </Box></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              {!showWebhookForm && (
                <Box sx={{ marginBottom: "20px", width: "100%" }}>
                  <Box sx={{ display: "flex", gap: "15px", alignItems: "center", marginBottom: "15px" }}>
                    <TextField label="Webhook URL" placeholder="https://your-api.com/webhook/endpoint" sx={{ flex: 1 }} value={newWebhook.url} onChange={(e) => { setNewWebhook({ ...newWebhook, url: e.target.value }); if (urlError) setUrlError(null); }} error={!!urlError} helperText={urlError} required aria-describedby="webhook-url-help" />
                    <TextField select label="When" value={newWebhook.events[0] || "run_completed"} onChange={(e) => setNewWebhook({ ...newWebhook, events: [e.target.value] })} sx={{ minWidth: "200px" }} required>
                      <MenuItem value="run_completed">Run finished</MenuItem>
                      <MenuItem value="run_failed">Run failed</MenuItem>
                    </TextField>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2" color="textSecondary" sx={{ marginTop: "10px" }}>Refer to the <a href="https://docs.maxun.dev/api/webhooks" style={{ color: "#ff00c3", textDecoration: "none" }}>API documentation</a> for examples and details.</Typography>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={addWebhookSetting} disabled={!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0 || loading || !!urlError}>Add New Webhook</Button>
                  </Box>
                </Box>
              )}
              {showWebhookForm && (
                <Card sx={{ width: "100%", marginBottom: "20px" }}>
                  <CardContent>
                    <Typography variant="h6" sx={{ marginBottom: "20px" }}>{editingWebhook ? "Edit Webhook" : "Add New Webhook"}</Typography>
                    <TextField fullWidth label="Webhook URL" value={newWebhook.url} onChange={(e) => { setNewWebhook({ ...newWebhook, url: e.target.value }); if (urlError) setUrlError(null); }} sx={{ marginBottom: "15px" }} placeholder="https://your-api.com/webhook/endpoint" required error={!!urlError} helperText={urlError} />
                    <TextField fullWidth select label="Call when" value={newWebhook.events} onChange={(e) => setNewWebhook({ ...newWebhook, events: typeof e.target.value === "string" ? [e.target.value] : e.target.value })}
                      SelectProps={{ multiple: true, renderValue: (selected) => (<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>{(selected as string[]).map((value) => (<Chip key={value} label={formatEventName(value)} size="small" />))}</Box>), }} sx={{ marginBottom: "20px" }} required>
                      <MenuItem value="run_completed">Run finished</MenuItem>
                      <MenuItem value="run_failed">Run failed</MenuItem>
                    </TextField>
                    <FormControlLabel control={<Switch checked={newWebhook.active} onChange={(e) => setNewWebhook({ ...newWebhook, active: e.target.checked })} />} label="Active" sx={{ marginBottom: "10px" }} />
                  </CardContent>
                  <CardActions>
                    <Button variant="contained" color="primary" onClick={editingWebhook ? updateWebhookSetting : addWebhookSetting} disabled={!newWebhook.url || !newWebhook.events || newWebhook.events.length === 0 || loading || !!urlError}>
                      {loading ? (<CircularProgress size={24} />) : editingWebhook ? ("Update Webhook") : ("Add Webhook")}
                    </Button>
                    <Button variant="outlined" onClick={resetWebhookForm} disabled={loading}>Cancel</Button>
                  </CardActions>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </RobotConfigPage>
  );
};
