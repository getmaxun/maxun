import React, { useState, useEffect } from 'react'; 
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import { useNavigate, useLocation } from 'react-router-dom';
import { Paper, Button, useTheme, Modal, Typography, Stack, Divider } from "@mui/material";
import { AutoAwesome, VpnKey, Usb, CloudQueue, Description, Favorite, SlowMotionVideo, PlayArrow, ArrowForwardIos, Star } from "@mui/icons-material";
import { useTranslation } from 'react-i18next';

interface MainMenuProps {
  value: string;
  handleChangeContent: (newValue: string) => void;
}

export const MainMenu = ({ value = 'robots', handleChangeContent }: MainMenuProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [starCount, setStarCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchStarCount = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('https://api.github.com/repos/getmaxun/maxun', {
          headers: {
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setStarCount(data.stargazers_count);
        } else {
          console.error('Failed to fetch GitHub star count');
        }
      } catch (error) {
        console.error('Error fetching GitHub star count:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStarCount();
    
    // Optional: Refresh star count every 5 minutes
    const intervalId = setInterval(fetchStarCount, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, []);

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

  const defaultcolor = theme.palette.mode === 'light' ? 'black' : 'white';

  const buttonStyles = {
    justifyContent: 'flex-start',
    textAlign: 'left',
    fontSize: '15px',
    letterSpacing: '0.02857em',
    padding: '20px 20px 0px 22px',
    minHeight: '60px',
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

  const starButtonStyles = {
    justifyContent: 'flex-start',
    textAlign: 'left',
    fontSize: '15px',
    padding: '12px 20px 12px 22px',
    minHeight: '48px',
    minWidth: '100%',
    display: 'flex',
    alignItems: 'center',
    textTransform: 'none',
    color: theme.palette.mode === 'light' ? '#6C6C6C' : 'inherit',
    backgroundColor: theme.palette.mode === 'light' ? '#fafafa' : 'rgba(255, 255, 255, 0.04)',
    '&:hover': {
      color: theme.palette.mode === 'light' ? '#6C6C6C' : 'inherit',
      backgroundColor: theme.palette.mode === 'light' ? '#f0f0f0' : 'rgba(255, 255, 255, 0.08)',
    },
  };

  return (
    <>
      <Paper
        sx={{
          height: '100%',
          width: '230px',
          backgroundColor: theme.palette.background.paper,
          color: defaultcolor,
          display: 'flex',
          flexDirection: 'column',
        }}
        variant="outlined"
        square
      >
        <Box sx={{ 
          width: '100%', 
          paddingBottom: '1rem',
          flexGrow: 1,
          overflowY: 'auto'
        }}>
          <Tabs
              value={value}
              onChange={handleChange}
              textColor="primary"
              indicatorColor="primary"
              orientation="vertical"
              sx={{ 
                alignItems: 'flex-start', 
                '& .MuiTabs-indicator': { display: 'none' },
                paddingTop: '0.5rem'
              }}
            >
            <Tab
              value="robots"
              label={t('mainmenu.recordings')}
              icon={<AutoAwesome sx={{ fontSize: 20 }} />}
              iconPosition="start"
              disableRipple={true}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }}
              onClick={handleRobotsClick} />
            <Tab value="runs"
              label={t('mainmenu.runs')}
              icon={<PlayArrow sx={{ fontSize: 20 }} />}
              iconPosition="start"
              disableRipple={true}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }} />
            <Tab value="proxy"
              label={t('mainmenu.proxy')}
              icon={<Usb sx={{ fontSize: 20 }} />}
              iconPosition="start"
              disableRipple={true}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }} />
            <Tab value="apikey"
              label={t('mainmenu.apikey')}
              icon={<VpnKey sx={{ fontSize: 20 }}/>}
              iconPosition="start"
              disableRipple={true}
              sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '16px' }} />
          </Tabs>
          <Divider sx={{ borderColor: theme.palette.mode === 'dark' ? "#080808ff" : "" }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <Button
              href='https://docs.maxun.dev/sdk/sdk-overview'
              target="_blank"
              rel="noopener noreferrer"
              sx={buttonStyles} startIcon={<ArrowForwardIos sx={{ fontSize: 20 }} />}>
              SDK
            </Button>
            <Button
              onClick={() => setDocModalOpen(true)}
              sx={buttonStyles}
              startIcon={<Description sx={{ fontSize: 20 }} />}
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
              sx={buttonStyles} startIcon={<CloudQueue sx={{ fontSize: 16 }} />}>
              Join Maxun Cloud
            </Button>
            <Button onClick={() => setSponsorModalOpen(true)} sx={buttonStyles} startIcon={<Favorite sx={{ fontSize: 16 }} />}>
              Sponsor Us
            </Button>
          </Box>
        </Box>

        <Button
          href="https://github.com/getmaxun/maxun"
          target="_blank"
          rel="noopener noreferrer"
          sx={starButtonStyles}
          startIcon={
            <Star 
              sx={{ 
                fontSize: 16, 
                color: theme.palette.mode === 'light' ? '#ffb400' : '#ffd740'
              }} 
            />
          }
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <span style={{ fontSize: "0.85rem"}}>Star On GitHub</span>
            {isLoading ? (
              <Typography 
                variant="caption" 
                sx={{ 
                  color: theme.palette.mode === 'light' ? '#666' : '#aaa',
                  fontSize: '0.75rem'
                }}
              >
                ...
              </Typography>
            ) : starCount !== null ? (
              <Box
                sx={{
                  backgroundColor: theme.palette.mode === 'light' ? '#f0f0f0' : 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '2px 8px',
                  fontSize: '0.7rem',
                  color: theme.palette.mode === 'light' ? '#666' : '#ccc',
                  fontWeight: 500,
                }}
              >
                {starCount.toLocaleString()}
              </Box>
            ) : null}
          </Box>
        </Button>
      </Paper>

      <Modal open={sponsorModalOpen} onClose={() => setSponsorModalOpen(false)}>
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'rgba(13, 13, 13, 1)', borderRadius: 2, p: 4, width: 600 }}>
          <Typography variant="h6" marginBottom={4}>
            Support Maxun Open Source
          </Typography>
          <Typography variant="body1" gutterBottom>
            Maxun is built by a small, full-time team. Your donations directly contribute to making it better.
            <br />
            Thank you for your support! 🩷
          </Typography>
          <Stack direction="row" spacing={2} mt={4}>
            <Button href="https://github.com/sponsors/amhsirak" target="_blank" rel="noopener noreferrer" variant="outlined" fullWidth>
              Sponsor Maxun on GitHub Sponsors
            </Button>
          </Stack>
        </Box>
      </Modal>
    </>
  );
};