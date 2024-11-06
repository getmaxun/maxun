import React from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { Paper, Button, useTheme } from "@mui/material";
import { AutoAwesome, FormatListBulleted, VpnKey, Usb, Article, CloudQueue } from "@mui/icons-material";

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'recordings', handleChangeContent }: MainMenuProps) => {
  const theme = useTheme();

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    handleChangeContent(newValue);
  };

  return (
    <Paper
      sx={{
        height: 'auto',
        width: '250px',
        backgroundColor: theme.palette.background.paper,
        paddingTop: '0.5rem',
        color: theme.palette.text.primary,
      }}
      variant="outlined"
      square
    >
      <Box sx={{ width: '100%', paddingBottom: '1rem' }}>
        <Tabs
          value={value}
          onChange={handleChange}
          textColor="primary"
          indicatorColor="primary"
          orientation="vertical"
          sx={{ alignItems: 'flex-start' }}
        >
          <Tab
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium', color: theme.palette.text.primary }}
            value="recordings"
            label="Robots"
            icon={<AutoAwesome />}
            iconPosition="start"
          />
          <Tab
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium', color: theme.palette.text.primary }}
            value="runs"
            label="Runs"
            icon={<FormatListBulleted />}
            iconPosition="start"
          />
          <Tab
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium', color: theme.palette.text.primary }}
            value="proxy"
            label="Proxy"
            icon={<Usb />}
            iconPosition="start"
          />
          <Tab
            sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium', color: theme.palette.text.primary }}
            value="apikey"
            label="API Key"
            icon={<VpnKey />}
            iconPosition="start"
          />
        </Tabs>
        <hr />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
          <Button href="/api-docs" target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<Article />}>
            API Docs
          </Button>
          <Button href="https://forms.gle/hXjgqDvkEhPcaBW76" target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<CloudQueue />}>
            Join Maxun Cloud
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

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
  color: 'inherit',
};
