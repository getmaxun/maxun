import React from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { useNavigate } from 'react-router-dom';
import { Paper, Button, useTheme } from "@mui/material";
import { AutoAwesome, FormatListBulleted, VpnKey, Usb, CloudQueue, Description, SlowMotionVideo } from "@mui/icons-material";
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'robots', handleChangeContent }: MainMenuProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    navigate(`/${newValue}`);
    handleChangeContent(newValue);
  };

  // Define colors based on theme mode
  const defaultcolor = theme.palette.mode === 'light' ? 'black' : 'white';

  const buttonStyles = {
    justifyContent: 'flex-start',
    textAlign: 'left',
    fontSize: '17px',
    letterSpacing: '0.02857em',
    padding: '20px 16px 20px 22px',
    minHeight: '48px',
    minWidth: '100%',
    display: 'flex',
    alignItems: 'center',
    textTransform: 'none',
    color: theme.palette.mode === 'light' ? '#6C6C6C' : 'inherit',
    '&:hover': {
      color: theme.palette.mode === 'light' ? '#6C6C6C' : 'inherit',
      backgroundColor: theme.palette.mode === 'light' ? '#f5f5f5' : 'inherit',
    },
  };


  return (
    <Paper
      sx={{
        height: '100%',
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
            value="robots"
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
        <Box sx={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
          {/* <Button href={`${apiUrl}/api-docs/`} target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<Code />}>
            {t('mainmenu.apidocs')}
          </Button> */}
          <Button href='https://docs.maxun.dev' target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<Description />}>
            Documentation
          </Button>
          <Button href="https://www.youtube.com/@MaxunOSS/videos" target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<SlowMotionVideo />}>
            Tutorials
          </Button>
          <Button href="https://app.maxun.dev/login" target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<CloudQueue />}>
            {t('mainmenu.feedback')}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};
