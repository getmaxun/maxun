import React, { useState } from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { useNavigate } from 'react-router-dom';
import { Paper, Button, useTheme, Modal, Typography, Stack, TextField, InputAdornment, IconButton } from "@mui/material"; // Added TextField, InputAdornment, IconButton
import { AutoAwesome, FormatListBulleted, VpnKey, Usb, CloudQueue, Description, Favorite, ContentCopy } from "@mui/icons-material"; // Added ContentCopy
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
  const { notify } = useGlobalInfoStore();
  
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);

  const ossDiscountCode = "MAXUNOSS8"; 

  const handleChange = (event: React.SyntheticEvent, newValue: string) => {
    navigate(`/${newValue}`);
    handleChangeContent(newValue);
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
    padding: '20px 16px 20px 22px',
    minHeight: '48px',
    minWidth: '100%',
    display: 'flex',
    alignItems: 'center',
    textTransform: 'none',
    color: theme.palette.mode === 'light' ? '#6C6C6C' : 'inherit',
    '&:hover': {
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
            <Tab value="robots" label={t('mainmenu.recordings')} icon={<AutoAwesome />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
            <Tab value="runs" label={t('mainmenu.runs')} icon={<FormatListBulleted />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
            <Tab value="proxy" label={t('mainmenu.proxy')} icon={<Usb />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
            <Tab value="apikey" label={t('mainmenu.apikey')} icon={<VpnKey />} iconPosition="start" sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 'medium' }} />
          </Tabs>
          <hr />
          <Box sx={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <Button href='https://docs.maxun.dev' target="_blank" rel="noopener noreferrer" sx={buttonStyles} startIcon={<Description />}>
              Documentation
            </Button>
            <Button onClick={() => setCloudModalOpen(true)} sx={buttonStyles} startIcon={<CloudQueue />}>
              Join Maxun Cloud
            </Button>
            <Button onClick={() => setSponsorModalOpen(true)} sx={buttonStyles} startIcon={<Favorite />}>
              Sponsor Us
            </Button>
          </Box>
        </Box>
      </Paper>

      <Modal open={cloudModalOpen} onClose={() => setCloudModalOpen(false)}>
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'background.paper', borderRadius: 2, p: 4, width: 600 }}>
          <Typography variant="h6" gutterBottom>
            Join Maxun Cloud
          </Typography>
          <Typography variant="body1" gutterBottom>
            Extract web data without getting blocked on Maxun Cloud.
          </Typography>
          <Typography variant="body1" gutterBottom>
            As a thank-you to Open Source users, enjoy 8% off your subscription!
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 3, mb: 1 }}>
            Use the following discount code at checkout:
          </Typography>
          <TextField
            fullWidth
            value={ossDiscountCode}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={copyDiscountCode} edge="end" aria-label="copy discount code">
                    <ContentCopy />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ mb: 3 }}
          />

          <Button href="https://app.maxun.dev/login" target="_blank" fullWidth variant="outlined" sx={{ mt: 2 }}>
            Go to Maxun Cloud
          </Button>
        </Box>
      </Modal>

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
            <Button href="https://github.com/sponsors/YOUR_GITHUB" target="_blank" variant="outlined" fullWidth>
              Sponsor $5 One-Time
            </Button>
            <Button href="https://github.com/sponsors/YOUR_GITHUB" target="_blank" variant="outlined" fullWidth>
              Sponsor $5 Monthly
            </Button>
          </Stack>
        </Box>
      </Modal>
    </>
  );
};