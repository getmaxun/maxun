import * as React from 'react';
import { Box, IconButton, Tab, Tabs } from "@mui/material";
import { useBrowserDimensionsStore } from "../../context/browserDimensions";
import { Close } from "@mui/icons-material";
import { useThemeMode } from '../../context/theme-provider';

interface BrowserTabsProp {
  tabs: string[],
  handleTabChange: (index: number) => void,
  handleAddNewTab: () => void,
  handleCloseTab: (index: number) => void,
  handleChangeIndex: (index: number) => void;
  tabIndex: number
}

export const BrowserTabs = (
  {
    tabs, handleTabChange, handleAddNewTab,
    handleCloseTab, handleChangeIndex, tabIndex
  }: BrowserTabsProp) => {

  let tabWasClosed = false;

  const { width } = useBrowserDimensionsStore();

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    if (!tabWasClosed) {
      handleChangeIndex(newValue);
    }
  };
  const isDarkMode = useThemeMode().darkMode;

  return (
    <Box sx={{
      display: 'flex',
      overflow: 'auto',
      alignItems: 'center',
      backgroundColor: `${isDarkMode? '#1e2124' : 'white'}`, // Dark background synced with BrowserNavbar
      padding: '8px',
      borderRadius: '8px 8px 0px 0px',
      boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.3)', // Synced shadow style
      width: '900px', // Fixed width
    }}>
      <Box sx={{ borderColor: '#333' }}> {/* Synced border color */}
        <Tabs
          value={tabIndex}
          onChange={handleChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            backgroundColor: `${isDarkMode? '#1e2124' : 'white'}`, // Dark background synced with BrowserNavbar
            minHeight: '48px',
            '& .MuiTabs-indicator': {
              backgroundColor: '#ff00c3', // Synced subtle indicator color
              height: '3px',
              borderRadius: '3px 3px 0 0',
            },
          }}
        >
          {tabs.map((tab, index) => {
            return (
              <Tab
                key={`tab-${index}`}
                id={`tab-${index}`}
                sx={{
                  backgroundColor: '#f5f5f5', // Synced dark background for tabs
                  borderRadius: '8px 8px 0px 0px',
                  marginRight: '8px',
                  minHeight: '48px',
                  textTransform: 'none',
                  fontWeight: '500',
                  fontSize: '14px',
                  color: 'black', // Synced light gray text color
                  
                  '&.Mui-selected': {
                    backgroundColor:` ${isDarkMode?"#2a2a2a":"#f5f5f5"}`, // Synced selected tab color
                    color: '#ff00c3', // Slightly lighter text when selected
                  },
                }}
                icon={<CloseButton closeTab={() => {
                  tabWasClosed = true;
                  handleCloseTab(index);
                }} disabled={tabs.length === 1}
                />}
                iconPosition="end"
                onClick={() => {
                  if (!tabWasClosed) {
                    handleTabChange(index)
                  }
                }}
                label={tab}
              />
            );
          })}
        </Tabs>
      </Box>
      {/* <IconButton
        aria-label="add tab"
        onClick={handleAddNewTab}
        sx={{
          backgroundColor: '#2A2A2A', // Synced dark button background
          color: '#CFCFCF', // Synced light text color
          marginLeft: '8px',
          '&:hover': { backgroundColor: '#3A3A3A' }, // Synced hover color
        }}
      >
        +
      </IconButton> */}
    </Box>
  );
}

interface CloseButtonProps {
  closeTab: () => void;
  disabled: boolean;
}

const CloseButton = ({ closeTab, disabled }: CloseButtonProps) => {
  return (
    <IconButton
      aria-label="close"
      size={"small"}
      onClick={closeTab}
      disabled={disabled}
      sx={{
        height: '28px',
        width: '28px',
        padding: '4px',
        backgroundColor: '#3A3A3A', // Synced dark gray background
        borderRadius: '50%',
        '&:hover': {
          backgroundColor: '#505050', // Synced hover color for close button
          color: '#FFFFFF',
        },
        '&.Mui-disabled': {
          opacity: 0.4, // Lower opacity for disabled state
        },
        transition: 'background-color 0.3s ease, color 0.3s ease',
      }}
    >
      <Close fontSize="small" />
    </IconButton>
  );
}
