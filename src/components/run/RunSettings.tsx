import React, { useState, useEffect } from "react";
import { GenericModal } from "../ui/GenericModal";
import { MenuItem, TextField, Typography, Switch, FormControlLabel } from "@mui/material";
import { Dropdown } from "../ui/DropdownMui";
import Button from "@mui/material/Button";
import { modalStyle } from "../recorder/AddWhereCondModal";

interface RunSettingsProps {
  isOpen: boolean;
  handleStart: (settings: RunSettings) => void;
  handleClose: () => void;
  isTask: boolean;
  params?: string[];
}

export interface RunSettings {
  maxConcurrency: number;
  maxRepeats: number;
  debug: boolean;
  params?: any;
}

export const RunSettingsModal = ({ isOpen, handleStart, handleClose, isTask, params }: RunSettingsProps) => {
  const [settings, setSettings] = useState<RunSettings>({
    maxConcurrency: 1,
    maxRepeats: 1,
    debug: true,
  });

  const [showInterpreterSettings, setShowInterpreterSettings] = useState(false);

  useEffect(() => {
    if (!showInterpreterSettings) {
      handleStart(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInterpreterSettings]);

  if (!showInterpreterSettings) {
    return null;
  }

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
          alignItems: "flex-start",
          marginLeft: "65px",
        }}
      >
        {isTask && (
          <React.Fragment>
            <Typography sx={{ margin: "20px 0px" }}>
              Recording parameters:
            </Typography>
            {params?.map((item, index) => (
              <TextField
                sx={{ marginBottom: "15px" }}
                key={`param-${index}`}
                type="string"
                label={item}
                required
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    params: settings.params
                      ? { ...settings.params, [item]: e.target.value }
                      : { [item]: e.target.value },
                  })
                }
              />
            ))}
          </React.Fragment>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={showInterpreterSettings}
              onChange={() =>
                setShowInterpreterSettings(!showInterpreterSettings)
              }
            />
          }
          label="Developer Mode Settings"
          sx={{ margin: "20px 0px" }}
        />

        {showInterpreterSettings && (
          <React.Fragment>
            <TextField
              sx={{ marginBottom: "15px" }}
              type="number"
              label="Max Concurrency"
              required
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxConcurrency: parseInt(e.target.value, 10),
                })
              }
              defaultValue={settings.maxConcurrency}
            />
            <TextField
              sx={{ marginBottom: "15px" }}
              type="number"
              label="Max Repeats"
              required
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxRepeats: parseInt(e.target.value, 10),
                })
              }
              defaultValue={settings.maxRepeats}
            />
            <Dropdown
              id="debug"
              label="Debug Mode"
              value={settings.debug?.toString()}
              handleSelect={(e) =>
                setSettings({
                  ...settings,
                  debug: e.target.value === "true",
                })
              }
            >
              <MenuItem value="true">true</MenuItem>
              <MenuItem value="false">false</MenuItem>
            </Dropdown>
          </React.Fragment>
        )}

        <Button
          variant="contained"
          onClick={() => handleStart(settings)}
          sx={{ marginTop: "20px" }}
        >
          Run Robot
        </Button>
      </div>
    </GenericModal>
  );
};
