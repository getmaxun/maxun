import * as React from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { Paper, Button } from "@mui/material";
import { AutoAwesome, FormatListBulleted, VpnKey, Usb, Article, Link, CloudQueue } from "@mui/icons-material";
import { apiUrl } from "../../apiConfig";

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'recordings', handleChangeContent }: MainMenuProps) => {

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    handleChangeContent(newValue);
  };

  return (
    <Paper
      sx={{
        height: 'auto',
        width: '250px',
        backgroundColor: 'white',
        paddingTop: '0.5rem',
      }}
      variant="outlined"
      square
    >
      <Box sx={{
        width: '100%',
        paddingBottom: '1rem',
      }}>
        <Tabs
          value={value}
          onChange={handleChange}
          textColor="primary"
          indicatorColor="primary"
          orientation="vertical"
          sx={{ alignItems: 'flex-start' }}
        >
          <Tab
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              fontSize: 'medium',
            }}
            value="recordings"
            label="Robots"
            icon={<AutoAwesome />}
            iconPosition="start"
          />
          <Tab
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              fontSize: 'medium',
            }}
            value="runs"
            label="Runs"
            icon={<FormatListBulleted />}
            iconPosition="start"
          />
          <Tab
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              fontSize: 'medium',
            }}
            value="proxy"
            label="Proxy"
            icon={<Usb />}
            iconPosition="start"
          />
          <Tab
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              fontSize: 'medium',
            }}
            value="apikey"
            label="API Key"
            icon={<VpnKey />}
            iconPosition="start"
          />
        </Tabs>
        <hr />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
          <Button href={`${apiUrl}/api-docs/`} target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<Article />}>
            API Docs
          </Button>
          <Button href="https://forms.gle/hXjgqDvkEhPcaBW76" target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<CloudQueue />}>
            Join Maxun Cloud
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}

const buttonStyles = {
  justifyContent: 'flex-start',
  textAlign: 'left',
  fontSize: 'medium',
  padding: '6px 16px 6px 22px', 
  minHeight: '48px',
  minWidth: '100%',
  display: 'flex',
  alignItems: 'center',
  textTransform: 'none',
  color: '#6C6C6C !important',
};