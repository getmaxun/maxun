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
  const [selectedIntegrationType, setSelectedIntegrationType] = useState<
    "googleSheets" | "airtable" | null
  >(null);
  const [settings, setSettings] = useState<IntegrationSettings>({
    spreadsheetId: "",
    spreadsheetName: "",
    airtableBaseId: "",
    airtableBaseName: "",
    data: "",
    integrationType: "googleSheets",
  });

  const [airtableTables, setAirtableTables] = useState<{ id: string; name: string }[]>([]);
  const [spreadsheets, setSpreadsheets] = useState<
    { id: string; name: string }[]
  >([]);
  const [airtableBases, setAirtableBases] = useState<
    { id: string; name: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recordingId, notify } = useGlobalInfoStore();
  const [recording, setRecording] = useState<any>(null);

  const authenticateWithGoogle = () => {
    window.location.href = `${apiUrl}/auth/google?robotId=${recordingId}`;
  };

  const authenticateWithAirtable = () => {
    window.location.href = `${apiUrl}/auth/airtable?robotId=${recordingId}`;
  };

  const handleIntegrationType = (type: "googleSheets" | "airtable") => {
    setSelectedIntegrationType(type);
    setSettings({
      ...settings,
      integrationType: type,
    });
  };

  const fetchAirtableTables = async (baseId: string) => {
    try {
      const response = await axios.get(
        `${apiUrl}/auth/airtable/tables?baseId=${baseId}&robotId=${recordingId}`,
        {
          withCredentials: true,
        }
      );
      setAirtableTables(response.data);
    } catch (error: any) {
      console.error(
        "Error fetching Airtable tables:",
        error.response?.data?.message || error.message
      );
      notify(
        "error",
        t("integration_settings.errors.fetch_error", {
          message: error.response?.data?.message || error.message,
        })
      );
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
        t("integration_settings.errors.fetch_error", {
          message: error.response?.data?.message || error.message,
        })
      );
    }
  };

  console.log("recordingId", recordingId);

  const fetchAirtableBases = async () => {
    try {
      const response = await axios.get(
        `${apiUrl}/auth/airtable/bases?robotId=${recordingId}`,
        {
          withCredentials: true,
        }
      );
      
      setAirtableBases(response.data);

      console.log("Airtable bases:", response.data);
      
    } catch (error: any) {
      console.error(
        "Error fetching Airtable bases:",
        error.response?.data?.message || error.message
      );
      notify(
        "error",
        t("integration_settings.errors.fetch_error", {
          message: error.response?.data?.message || error.message,
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

  const handleAirtableBaseSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedBase = airtableBases.find(
      (base) => base.id === e.target.value
    );
    if (selectedBase) {
      setSettings({
        ...settings,
        airtableBaseId: selectedBase.id,
        airtableBaseName: selectedBase.name,
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
      notify(`success`, t("integration_settings.notifications.sheet_selected"));
      console.log("Google Sheet ID updated:", response.data);
    } catch (error: any) {
      console.error(
        "Error updating Google Sheet ID:",
        error.response?.data?.message || error.message
      );
    }
  };

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
      notify(`success`, t("integration_settings.notifications.base_selected"));
      console.log("Airtable Base ID updated:", response.data);
    } catch (error: any) {
      console.error(
        "Error updating Airtable Base ID:",
        error.response?.data?.message || error.message
      );
    }
  };

  const removeIntegration = async () => {
    try {
      const endpoint =
        selectedIntegrationType === "googleSheets"
          ? "/auth/gsheets/remove"
          : "/auth/airtable/remove";

      await axios.post(
        `${apiUrl}${endpoint}`,
        { robotId: recordingId },
        { withCredentials: true }
      );

      setRecording(null);
      setSpreadsheets([]);
      setAirtableBases([]);
      setSelectedIntegrationType(null);
      setSettings({
        spreadsheetId: "",
        spreadsheetName: "",
        airtableBaseId: "",
        airtableBaseName: "",
        data: "",
        integrationType: "googleSheets",
      });
    } catch (error: any) {
      console.error(
        "Error removing integration:",
        error.response?.data?.message || error.message
      );
    }
  };

  useEffect(() => {
    const status = getCookie("robot_auth_status");
    const message = getCookie("robot_auth_message");

    if (status === "success" && message) {
      notify("success", message);
      removeCookie("robot_auth_status");
      removeCookie("robot_auth_message");
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    if (code) {
      // Determine which authentication callback to handle
      // You'll need to implement similar callback logic for Airtable
    }

    const fetchRecordingInfo = async () => {
      if (!recordingId) return;
      const recording = await getStoredRecording(recordingId);
      if (recording) {
        setRecording(recording);
        // Determine integration type based on existing integration
        if (recording.google_sheet_id) {
          setSelectedIntegrationType("googleSheets");
        } else if (recording.airtable_base_id) {
          setSelectedIntegrationType("airtable");
        }
      }
    };

    fetchRecordingInfo();
  }, [recordingId]);

  // Initial integration type selection
  if (!selectedIntegrationType) {
    return (
      <GenericModal
        isOpen={isOpen}
        onClose={handleClose}
        modalStyle={modalStyle}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "20px",
          }}
        >
          <Typography variant="h6" sx={{ marginBottom: "20px" }}>
            {t("integration_settings.title_select_integration")}
          </Typography>
          <div style={{ display: "flex", gap: "20px" }}>
            <Button
              variant="contained"
              color="primary"
              onClick={() => handleIntegrationType("googleSheets")}
            >
              Google Sheets
            </Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={() => handleIntegrationType("airtable")}
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          marginLeft: "65px",
        }}
      >
        <Typography variant="h6">
          {selectedIntegrationType === "googleSheets"
            ? t("integration_settings.title_google")
            : t("integration_settings.title_airtable")}
        </Typography>

        {recording &&
          (recording.google_sheet_id || recording.airtable_base_id ? (
            <>
              <Alert
                severity="info"
                sx={{ marginTop: "10px", border: "1px solid #ff00c3" }}
              >
                <AlertTitle>
                  {t("integration_settings.alerts.success.title")}
                </AlertTitle>
                {selectedIntegrationType === "googleSheets" ? (
                  <>
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
                  </>
                ) : (
                  <>
                    {t("integration_settings.alerts.success.content", {
                      sheetName: recording.airtable_base_name,
                    })}
                    <a
                      href={`https://airtable.com/${recording.airtable_base_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("integration_settings.alerts.success.here")}
                    </a>
                  </>
                )}
                <br />
                <strong>
                  {t("integration_settings.alerts.success.note")}
                </strong>{" "}
                {t("integration_settings.alerts.success.sync_limitation")}
              </Alert>
              <Button
                variant="outlined"
                color="error"
                onClick={removeIntegration}
                style={{ marginTop: "15px" }}
              >
                {t("integration_settings.buttons.remove_integration")}
              </Button>
            </>
          ) : null)}

        {!recording?.[
          selectedIntegrationType === "googleSheets"
            ? "google_sheet_email"
            : "airtable_email"
        ] ? (
          <>
            <p>{t("integration_settings.descriptions.sync_info")}</p>
            <Button
              variant="contained"
              color="primary"
              onClick={
                selectedIntegrationType === "googleSheets"
                  ? authenticateWithGoogle
                  : authenticateWithAirtable
              }
            >
              {t("integration_settings.buttons.authenticate")}
            </Button>
          </>
        ) : (
          <>
            {recording[
              selectedIntegrationType === "googleSheets"
                ? "google_sheet_email"
                : "airtable_email"
            ] && (
              <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                {t("integration_settings.descriptions.authenticated_as", {
                  email:
                    recording[
                      selectedIntegrationType === "googleSheets"
                        ? "google_sheet_email"
                        : "airtable_email"
                    ],
                })}
              </Typography>
            )}

            {loading ? (
              <CircularProgress sx={{ marginBottom: "15px" }} />
            ) : error ? (
              <Typography color="error">{error}</Typography>
            ) : (selectedIntegrationType === "googleSheets"
                ? spreadsheets
                : airtableBases
              ).length === 0 ? (
              <>
                <div style={{ display: "flex", gap: "10px" }}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={
                      selectedIntegrationType === "googleSheets"
                        ? fetchSpreadsheetFiles
                        : fetchAirtableBases
                    }
                  >
                    {t("integration_settings.buttons.fetch_sheets")}
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={removeIntegration}
                  >
                    {t("integration_settings.buttons.remove_integration")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <TextField
                  sx={{ marginBottom: "15px" }}
                  select
                  label={t("integration_settings.fields.select_sheet")}
                  required
                  value={
                    selectedIntegrationType === "googleSheets"
                      ? settings.spreadsheetId
                      : settings.airtableBaseId
                  }
                  onChange={
                    selectedIntegrationType === "googleSheets"
                      ? handleSpreadsheetSelect
                      : handleAirtableBaseSelect
                  }
                  fullWidth
                >
                  {(selectedIntegrationType === "googleSheets"
                    ? spreadsheets
                    : airtableBases
                  ).map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.name}
                    </MenuItem>
                  ))}
                </TextField>

                {(selectedIntegrationType === "googleSheets"
                  ? settings.spreadsheetId
                  : settings.airtableBaseId) && (
                  <Typography sx={{ marginBottom: "10px" }}>
                    {t("integration_settings.fields.selected_sheet", {
                      name:
                        selectedIntegrationType === "googleSheets"
                          ? spreadsheets.find(
                              (s) => s.id === settings.spreadsheetId
                            )?.name
                          : airtableBases.find(
                              (b) => b.id === settings.airtableBaseId
                            )?.name,
                      id:
                        selectedIntegrationType === "googleSheets"
                          ? settings.spreadsheetId
                          : settings.airtableBaseId,
                    })}
                  </Typography>
                )}

                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => {
                    if (selectedIntegrationType === "googleSheets") {
                      updateGoogleSheetId();
                    } else {
                      updateAirtableBaseId();
                    }
                    handleStart(settings);
                  }}
                  style={{ marginTop: "10px" }}
                  disabled={
                    !(selectedIntegrationType === "googleSheets"
                      ? settings.spreadsheetId
                      : settings.airtableBaseId) || loading
                  }
                >
                  {t("integration_settings.buttons.submit")}
                </Button>
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
