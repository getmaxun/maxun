import React, { useRef } from 'react';
import styled from "styled-components";
import { Button } from "@mui/material";
import * as Settings from "./action-settings";
import { useSocketStore } from "../../context/socket";

interface ActionSettingsProps {
  action: string;
  darkMode?: boolean;
}

export const ActionSettings = ({ action, darkMode = false }: ActionSettingsProps) => {
  const settingsRef = useRef<{ getSettings: () => object }>(null);
  const { socket } = useSocketStore();

  const DisplaySettings = () => {
    switch (action) {
      case "screenshot":
        return <Settings.ScreenshotSettings ref={settingsRef} />;
      case 'scroll':
        return <Settings.ScrollSettings ref={settingsRef} />;
      case 'scrape':
        return <Settings.ScrapeSettings ref={settingsRef} />;
      case 'scrapeSchema':
        return <Settings.ScrapeSchemaSettings ref={settingsRef} />;
      default:
        return null;
    }
  };

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const settings = settingsRef.current?.getSettings();
    socket?.emit(`action`, {
      action,
      settings
    });
  };

  return (
    <div>
      <ActionSettingsWrapper action={action} darkMode={darkMode}>
        <form onSubmit={handleSubmit}>
          <DisplaySettings />
          <Button
            variant="outlined"
            type="submit"
            sx={{
              display: "table-cell",
              float: "right",
              marginRight: "15px",
              marginTop: "20px",
            }}
          >
            Add Action
          </Button>
        </form>
      </ActionSettingsWrapper>
    </div>
  );
};

// Ensure that the Wrapper accepts the darkMode prop for styling adjustments.
const ActionSettingsWrapper = styled.div<{ action: string; darkMode: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: ${({ action }) => (action === 'script' ? 'stretch' : 'center')};
  justify-content: center;
  margin-top: 20px;
  background-color: ${({ darkMode }) => (darkMode ? '#1E1E1E' : 'white')};
  color: ${({ darkMode }) => (darkMode ? 'white' : 'black')};
`;
