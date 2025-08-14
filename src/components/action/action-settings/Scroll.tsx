import React, { forwardRef, useImperativeHandle } from 'react';
import { TextField } from "@mui/material";

export const ScrollSettings = forwardRef((props, ref) => {
  const [settings, setSettings] = React.useState<number>(0);
  useImperativeHandle(ref, () => ({
    getSettings() {
      return settings;
    }
  }));

  return (
    <TextField
      sx={{ marginLeft: '15px' }}
      type="number"
      label="Number of pages"
      required
      onChange={(e) => setSettings(parseInt(e.target.value))}
    />
  );
});
