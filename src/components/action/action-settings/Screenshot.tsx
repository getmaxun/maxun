import React, { forwardRef, useImperativeHandle } from 'react';
import { MenuItem, TextField } from "@mui/material";
import { ScreenshotSettings as Settings } from "../../../shared/types";
import styled from "styled-components";
import { SelectChangeEvent } from "@mui/material/Select/Select";
import { Dropdown } from "../../ui/DropdownMui";

export const ScreenshotSettings = forwardRef((props, ref) => {
  const [settings, setSettings] = React.useState<Settings>({});
  useImperativeHandle(ref, () => ({
    getSettings() {
      return settings;
    }
  }));

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value, type } = event.target;
    let parsedValue: any = value;
    if (type === "number") {
      parsedValue = parseInt(value);
    };
    setSettings({
      ...settings,
      [id]: parsedValue,
    });
  };

  const handleSelect = (event: SelectChangeEvent) => {
    const { name, value } = event.target;
    let parsedValue: any = value;
    if (value === "true" || value === "false") {
      parsedValue = value === "true";
    };
    setSettings({
      ...settings,
      [name]: parsedValue,
    });
  };

  return (
    <SettingsWrapper>
      <Dropdown
        id="type"
        label="type"
        value={settings.type || "png"}
        handleSelect={handleSelect}
      >
        <MenuItem value="jpeg">jpeg</MenuItem>
        <MenuItem value="png">png</MenuItem>
      </Dropdown>
      {settings.type === "jpeg" ?
        <TextField
          type="number"
          id="quality"
          label="quality"
          size='small'
          InputProps={{ inputProps: { min: 0, max: 100 } }}
          onChange={handleInput}
        /> : null
      }
      <TextField
        type="number"
        id="timeout"
        label="timeout"
        size='small'
        onChange={handleInput}
        defaultValue='30000'
      />
      <Dropdown
        id="animations"
        label="animations"
        value={settings.animations || 'allow'}
        handleSelect={handleSelect}
      >
        <MenuItem value="disabled">disabled</MenuItem>
        <MenuItem value="allow">allow</MenuItem>
      </Dropdown>
      {settings.type === "png" ?
        <Dropdown
          id="omitBackground"
          label="omitBackground"
          value={settings.omitBackground?.toString() || "false"}
          handleSelect={handleSelect}
        >
          <MenuItem value="true">true</MenuItem>
          <MenuItem value="false">false</MenuItem>
        </Dropdown>
        : null
      }
      <Dropdown
        id="caret"
        label="caret"
        value={settings.caret || "hide"}
        handleSelect={handleSelect}
      >
        <MenuItem value="hide">hide</MenuItem>
        <MenuItem value="initial">initial</MenuItem>
      </Dropdown>
      <Dropdown
        id="fullPage"
        label="fullPage"
        value={settings.fullPage?.toString() || "false"}
        handleSelect={handleSelect}
      >
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </Dropdown>
      <Dropdown
        id="scale"
        label="scale"
        value={settings.scale || "device"}
        handleSelect={handleSelect}
      >
        <MenuItem value="css">css</MenuItem>
        <MenuItem value="device">device</MenuItem>
      </Dropdown>
    </SettingsWrapper>
  );
});

const SettingsWrapper = styled.div`
  margin-left: 15px;
  * {
    margin-bottom: 10px;
  }
`;
