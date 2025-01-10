import React from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { Paper, Button, useTheme } from "@mui/material";
import { AutoAwesome, FormatListBulleted, VpnKey, Usb, Article, CloudQueue, Code, } from "@mui/icons-material";
import { apiUrl } from "../../apiConfig";
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'recordings', handleChangeContent }: MainMenuProps) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    handleChangeContent(newValue);
  };

  // Define colors based on theme mode
  const defaultcolor = theme.palette.mode === 'light' ? 'black' : 'white';

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
    color: theme.palette.mode === 'light' ? '#6C6C6C' : 'inherit',
  };


  return (
    <Paper
      sx={{
        height: 'auto',
        width: '250px',
        backgroundColor: theme.palette.background.paper,
        paddingTop: '0.5rem',
        color: defaultcolor,
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
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              fontSize: 'medium',
            }}
            value="recordings"
            label={t('mainmenu.recordings')}
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
            label={t('mainmenu.runs')}
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
            label={t('mainmenu.proxy')}
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
            label={t('mainmenu.apikey')}
            icon={<VpnKey />}
            iconPosition="start"
          />
        </Tabs>
        <hr />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
          <Button href={`${apiUrl}/api-docs/`} target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<Code />}>
            {t('mainmenu.apidocs')}
          </Button>
          <Button href="https://forms.gle/hXjgqDvkEhPcaBW76" target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<CloudQueue />}>
            {t('mainmenu.feedback')}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};