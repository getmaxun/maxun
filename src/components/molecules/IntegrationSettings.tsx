import React, { useState, useEffect } from "react";
import { GenericModal } from "../atoms/GenericModal";
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

export const IntegrationSettingsModal = ({
  isOpen,
  handleStart,
  handleClose,
}: IntegrationProps) => {
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
        `Error fetching spreadsheet files: ${error.response?.data?.message || error.message
        }`
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
      notify(`success`, `Google Sheet selected successfully`)
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
    const status = Cookies.get("robot_auth_status");
    const message = Cookies.get("robot_auth_message");

    if (status === "success" && message) {
      notify("success", message);
      // Clear the cookies after reading
      Cookies.remove("robot_auth_status");
      Cookies.remove("robot_auth_message");
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          marginLeft: "65px",
        }}
      >
        <Typography variant="h6">
          Integrate with Google Sheet{" "}
          {/* <Chip label="beta" color="primary" variant="outlined" /> */}
        </Typography>

        {recording && recording.google_sheet_id ? (
          <>
            <Alert severity="info" sx={{ marginTop: '10px', border: '1px solid #ff00c3' }}>
              <AlertTitle>Google Sheet Integrated Successfully.</AlertTitle>
              Every time this robot creates a successful run, its captured data
              is appended to your {recording.google_sheet_name} Google Sheet.
              You can check the data updates{" "}
              <a
                href={`https://docs.google.com/spreadsheets/d/${recording.google_sheet_id}`}
                target="_blank"
                rel="noreferrer"
              >
                here
              </a>
              .
              <br />
              <strong>Note:</strong> The data extracted before integrating with
              Google Sheets will not be synced in the Google Sheet. Only the
              data extracted after the integration will be synced.
            </Alert>
            <Button
              variant="outlined"
              color="error"
              onClick={removeIntegration}
              style={{ marginTop: "15px" }}
            >
              Remove Integration
            </Button>
          </>
        ) : (
          <>
            {!recording?.google_sheet_email ? (
              <>
                <p>
                  If you enable this option, every time this robot runs a task
                  successfully, its captured data will be appended to your
                  Google Sheet.
                </p>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={authenticateWithGoogle}
                >
                  Authenticate with Google
                </Button>
              </>
            ) : (
              <>
                {recording.google_sheet_email && (
                  <Typography sx={{ margin: "20px 0px 30px 0px" }}>
                    Authenticated as: {recording.google_sheet_email}
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
                        Fetch Google Spreadsheets
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={removeIntegration}
                      >
                        Remove Integration
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <TextField
                      sx={{ marginBottom: "15px" }}
                      select
                      label="Select Google Sheet"
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
                        Selected Sheet:{" "}
                        {
                          spreadsheets.find(
                            (s) => s.id === settings.spreadsheetId
                          )?.name
                        }{" "}
                        (ID: {settings.spreadsheetId})
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
                      Submit
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
