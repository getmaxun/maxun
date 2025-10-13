import React, { useState } from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { useNavigate, useLocation } from 'react-router-dom';
import { Paper, Button, useTheme, Modal, Typography, Stack, TextField, InputAdornment, IconButton } from "@mui/material";
import { AutoAwesome, FormatListBulleted, VpnKey, Usb, CloudQueue, Description, Favorite, ContentCopy, SlowMotionVideo } from "@mui/icons-material";
import { useTranslation } from 'react-i18next';
import { useGlobalInfoStore } from "../../context/globalInfo";

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'robots', handleChangeContent }: MainMenuProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useGlobalInfoStore();

  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);

  const ossDiscountCode = "MAXUNOSS8";

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    navigate(`/${newValue}`);
    handleChangeContent(newValue);
  };

  const handleRobotsClick = () => {
    if (location.pathname !== '/robots') {
      navigate('/robots');
      handleChangeContent('robots');
    }
  };

  const copyDiscountCode = () => {
    navigator.clipboard.writeText(ossDiscountCode).then(() => {
      notify("success", "Discount code copied to clipboard!");
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      notify("error", "Failed to copy discount code.");
    });
  };

  const defaultcolor = theme.palette.mode === 'light' ? 'black' : 'white';

  const buttonStyles = {
    justifyContent: 'flex-start',
    textAlign: 'left',
    fontSize: '17px',
    letterSpacing: '0.02857em',
    padding: '20px 20px 20px 22px',
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
    <>
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
            <Tab value="robots" label={t('mainmenu.recordings')} icon={<AutoAwesome />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} onClick={handleRobotsClick} />
            <Tab value="runs" label={t('mainmenu.runs')} icon={<FormatListBulleted />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
            <Tab value="proxy" label={t('mainmenu.proxy')} icon={<Usb />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
            <Tab value="apikey" label={t('mainmenu.apikey')} icon={<VpnKey />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
          </Tabs>
          <hr />
          <Box sx={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <Button
              onClick={() => setDocModalOpen(true)}
              sx={buttonStyles}
              startIcon={<Description />}
            >
              Documentation
            </Button>
            <Modal open={docModalOpen ?? false} onClose={() => setDocModalOpen(false)}>
              <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'background.paper', borderRadius: 2, p: 4, width: 400 }}>
                <Stack spacing={2}>
                  <Button
                    href="https://docs.maxun.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outlined"
                    startIcon={<Description />}
                    fullWidth
                  >
                    Documentation
                  </Button>
                  <Button
                    href="https://www.youtube.com/@MaxunOSS/videos"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outlined"
                    startIcon={<SlowMotionVideo />}
                    fullWidth
                  >
                    Video Tutorials
                  </Button>
                </Stack>
              </Box>
            </Modal>
            <Button
              href='https://app.maxun.dev/'
              target="_blank"
              rel="noopener noreferrer"
              sx={buttonStyles} startIcon={<CloudQueue />}>
              Join Maxun Cloud
            </Button>
            <Button onClick={() => setSponsorModalOpen(true)} sx={buttonStyles} startIcon={<Favorite />}>
              Sponsor Us
            </Button>
          </Box>
        </Box>
      </Paper>
      <Modal open={sponsorModalOpen} onClose={() => setSponsorModalOpen(false)}>
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'background.paper', borderRadius: 2, p: 4, width: 600 }}>
          <Typography variant="h6" marginBottom={4}>
            Support Maxun Open Source
          </Typography>
          <Typography variant="body1" gutterBottom>
            Maxun is built by a small, full-time team. Your donations directly contribute to making it better.
            <br />
            <br />
            Thank you for your support! 💙
          </Typography>
          <Stack direction="row" spacing={2} mt={2}>
            <Button href="https://github.com/sponsors/amhsirak" target="_blank" rel="noopener noreferrer" variant="outlined" fullWidth>
              Sponsor Maxun on GitHub Sponsors
            </Button>
          </Stack>
        </Box>
      </Modal>
    </>
  );
};
