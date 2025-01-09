import React from "react";
import { Button, MenuItem, TextField, Typography } from "@mui/material";
import { Dropdown } from "../ui/DropdownMui";
import { RunSettings } from "./RunSettings";
import { useSocketStore } from "../../context/socket";

interface LeftSidePanelSettingsProps {
  params: any[]
  settings: RunSettings,
  setSettings: (setting: RunSettings) => void
}

export const LeftSidePanelSettings = ({ params, settings, setSettings }: LeftSidePanelSettingsProps) => {
  const { socket } = useSocketStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      {params.length !== 0 && (
        <React.Fragment>
          <Typography>Parameters:</Typography>
          {params?.map((item: string, index: number) => {
            return <TextField
              sx={{ margin: '15px 0px' }}
              value={settings.params ? settings.params[item] : ''}
              key={`param-${index}`}
              type="string"
              label={item}
              required
              onChange={(e) => setSettings(
                {
                  ...settings,
                  params: settings.params
                    ? {
                      ...settings.params,
                      [item]: e.target.value,
                    }
                    : {
                      [item]: e.target.value,
                    },
                })}
            />
          })}
        </React.Fragment>
      )}
      <Typography sx={{ margin: '15px 0px' }}>Interpreter:</Typography>
      <TextField
        type="number"
        label="maxConcurrency"
        required
        onChange={(e) => setSettings(
          {
            ...settings,
            maxConcurrency: parseInt(e.target.value),
          })}
        defaultValue={settings.maxConcurrency}
      />
      <TextField
        sx={{ margin: '15px 0px' }}
        type="number"
        label="maxRepeats"
        required
        onChange={(e) => setSettings(
          {
            ...settings,
            maxRepeats: parseInt(e.target.value),
          })}
        defaultValue={settings.maxRepeats}
      />
      <Dropdown
        id="debug"
        label="debug"
        value={settings.debug?.toString()}
        handleSelect={(e) => setSettings(
          {
            ...settings,
            debug: e.target.value === "true",
          })}
      >
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </Dropdown>
      <Button sx={{ margin: '15px 0px' }} variant='contained'
        onClick={() => socket?.emit('settings', settings)}>change</Button>
    </div>
  );
}
