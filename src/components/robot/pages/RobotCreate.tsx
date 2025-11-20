import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  TextField,
  Button,
  FormControlLabel,
  Checkbox,
  IconButton,
  Grid,
  Card,
  CircularProgress,
  Container,
  CardContent,
  Tabs,
  Tab
} from '@mui/material';
import { ArrowBack, PlayCircleOutline, Article, Code, Description } from '@mui/icons-material';
import { useGlobalInfoStore } from '../../../context/globalInfo';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../../api/recording';
import { AuthContext } from '../../../context/auth';
import { GenericModal } from '../../ui/GenericModal';


interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`robot-tabpanel-${index}`}
      aria-labelledby={`robot-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

const RobotCreate: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setBrowserId, setRecordingUrl, notify, setRecordingId, setRerenderRobots } = useGlobalInfoStore();

  const [tabValue, setTabValue] = useState(0);
  const [url, setUrl] = useState('');
  const [markdownRobotName, setMarkdownRobotName] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [activeBrowserId, setActiveBrowserId] = useState('');

  const { state } = React.useContext(AuthContext);
  const { user } = state;

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };


  const handleStartRecording = async () => {
    if (!url.trim()) {
      notify('error', 'Please enter a valid URL');
      return;
    }

    setIsLoading(true);

    try {
      const canCreateRecording = await canCreateBrowserInState("recording");

      if (!canCreateRecording) {
        const activeBrowser = await getActiveBrowserId();
        if (activeBrowser) {
          setActiveBrowserId(activeBrowser);
          setWarningModalOpen(true);
        } else {
          notify('warning', t('recordingtable.notifications.browser_limit_warning'));
        }
        setIsLoading(false);
        return;
      }

      setBrowserId('new-recording');
      setRecordingUrl(url);

      window.sessionStorage.setItem('browserId', 'new-recording');
      window.sessionStorage.setItem('recordingUrl', url);
      window.sessionStorage.setItem('initialUrl', url);
      window.sessionStorage.setItem('needsLogin', needsLogin.toString());

      const sessionId = Date.now().toString();
      window.sessionStorage.setItem('recordingSessionId', sessionId);

      window.open(`/recording-setup?session=${sessionId}`, '_blank');
      window.sessionStorage.setItem('nextTabIsRecording', 'true');

      // Reset loading state immediately after opening new tab
      setIsLoading(false);
      navigate('/robots');
    } catch (error) {
      console.error('Error starting recording:', error);
      notify('error', 'Failed to start recording. Please try again.');
      setIsLoading(false);
    }
  };

  const handleDiscardAndCreate = async () => {
    if (activeBrowserId) {
      await stopRecording(activeBrowserId);
      notify('warning', t('browser_recording.notifications.terminated'));
    }

    setWarningModalOpen(false);
    setIsLoading(false);

    // Continue with the original Recording logic
    setBrowserId('new-recording');
    setRecordingUrl(url);

    window.sessionStorage.setItem('browserId', 'new-recording');
    window.sessionStorage.setItem('recordingUrl', url);
    window.sessionStorage.setItem('initialUrl', url);
    window.sessionStorage.setItem('needsLogin', needsLogin.toString());

    const sessionId = Date.now().toString();
    window.sessionStorage.setItem('recordingSessionId', sessionId);

    window.open(`/recording-setup?session=${sessionId}`, '_blank');
    window.sessionStorage.setItem('nextTabIsRecording', 'true');

    navigate('/robots');
  };






  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box>
        <Box display="flex" alignItems="center" mb={3}>
          <IconButton
            onClick={() => navigate('/robots')}
            sx={{
              ml: -1,
              mr: 1,
              color: theme => theme.palette.text.primary,
              backgroundColor: 'transparent !important',
              '&:hover': {
                backgroundColor: 'transparent !important',
              },
              '&:active': {
                backgroundColor: 'transparent !important',
              },
              '&:focus': {
                backgroundColor: 'transparent !important',
              },
              '&:focus-visible': {
                backgroundColor: 'transparent !important',
              },
            }}
            disableRipple
            aria-label="Go back"
          >
            <ArrowBack />
          </IconButton>
          <Typography variant="h5" component="h1">
            Create New Robot
          </Typography>
        </Box>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="robot type tabs">
            <Tab
              icon={<Code />}
              iconPosition="start"
              label="Data Extraction Robot"
              id="robot-tab-0"
              aria-controls="robot-tabpanel-0"
            />
            <Tab
              icon={<Description />}
              iconPosition="start"
              label="Markdown Robot"
              id="robot-tab-1"
              aria-controls="robot-tabpanel-1"
            />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <Card sx={{ mb: 4, p: 4, textAlign: 'center' }}>
          <Box display="flex" flexDirection="column" alignItems="center">
            {/* Logo (kept as original) */}
            <img
              src="https://ik.imagekit.io/ys1blv5kv/maxunlogo.png"
              width={73}
              height={65}
              style={{
                borderRadius: '5px',
                marginBottom: '30px'
              }}
              alt="Maxun Logo"
            />

            {/* Origin URL Input */}
            <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
              <TextField
                placeholder="Example: https://www.ycombinator.com/companies/"
                variant="outlined"
                fullWidth
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Box>

            {/* Checkbox */}
            <Box sx={{ width: '100%', maxWidth: 700, mb: 3, textAlign: 'left' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={needsLogin}
                    onChange={(e) => setNeedsLogin(e.target.checked)}
                    color="primary"
                  />
                }
                label="This website needs logging in."
              />
            </Box>

            {/* Button */}
            <Button
              variant="contained"
              fullWidth
              onClick={handleStartRecording}
              disabled={!url.trim() || isLoading}
              sx={{
                bgcolor: '#ff00c3',
                py: 1.4,
                fontSize: '1rem',
                textTransform: 'none',
                maxWidth: 700,
                borderRadius: 2
              }}
              startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
            >
              {isLoading ? 'Starting...' : 'Start Recording'}
            </Button>
          </Box>
        </Card>



        <Box mt={6} textAlign="center">
          <Typography variant="h6" gutterBottom>
            First time creating a robot?
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Get help and learn how to use Maxun effectively.
          </Typography>

          <Grid container spacing={3} justifyContent="center">

            {/* YouTube Tutorials */}
            <Grid item xs={12} sm={6} md={4}>
              <Card
                sx={{
                  height: 140,
                  cursor: "pointer",
                }}
                onClick={() => window.open("https://www.youtube.com/@MaxunOSS/videos", "_blank")}
              >
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center", // center content
                    height: "100%",
                    textAlign: "center",
                    p: 2,
                    color: (theme) =>
                      theme.palette.mode === 'light' ? 'rgba(0, 0, 0, 0.54)' : '',
                  }}
                >
                  <PlayCircleOutline sx={{ fontSize: "32px", mb: 2 }} />

                  <Box sx={{ textAlign: "center" }}>
                    <Typography variant="body1" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                      Video Tutorials
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4, mt: 1 }}>
                      Watch step-by-step guides
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Documentation */}
            <Grid item xs={12} sm={6} md={4}>
              <Card
                sx={{
                  height: 140,
                  cursor: "pointer",
                }}
                onClick={() => window.open("https://docs.maxun.dev", "_blank")}
              >
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center", // center everything
                    height: "100%",
                    textAlign: "center",
                    p: 2,
                    color: (theme) =>
                      theme.palette.mode === 'light' ? 'rgba(0, 0, 0, 0.54)' : '',
                  }}
                >
                  <Article sx={{ fontSize: "32px", mb: 2 }} />

                  <Box sx={{ textAlign: "center" }}>
                    <Typography variant="body1" fontWeight="600" sx={{ lineHeight: 1.2 }}>
                      Documentation
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4, mt: 1 }}>
                      Explore detailed guides
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Card sx={{ mb: 4, p: 4, textAlign: 'center' }}>
            <Box display="flex" flexDirection="column" alignItems="center">
              <img
                src="https://ik.imagekit.io/ys1blv5kv/maxunlogo.png"
                width={73}
                height={65}
                style={{
                  borderRadius: '5px',
                  marginBottom: '30px'
                }}
                alt="Maxun Logo"
              />

              <Typography variant="h6" gutterBottom>
                Create Markdown Robot
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Convert any webpage to clean markdown format
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
                <TextField
                  placeholder="Example: My Blog Article Robot"
                  variant="outlined"
                  fullWidth
                  value={markdownRobotName}
                  onChange={(e) => setMarkdownRobotName(e.target.value)}
                  label="Robot Name"
                  sx={{ mb: 2 }}
                />
                <TextField
                  placeholder="Example: https://example.com/blog/article"
                  variant="outlined"
                  fullWidth
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  label="URL to convert"
                />
              </Box>

              <Button
                variant="contained"
                fullWidth
                onClick={async () => {
                  if (!url.trim()) {
                    notify('error', 'Please enter a valid URL');
                    return;
                  }
                  if (!markdownRobotName.trim()) {
                    notify('error', 'Please enter a robot name');
                    return;
                  }
                  setIsLoading(true);
                  const { createMarkdownRobot } = await import('../../../api/storage');
                  const result = await createMarkdownRobot(url, markdownRobotName);
                  setIsLoading(false);

                  if (result) {
                    setRerenderRobots(true);
                    notify('success', `${markdownRobotName} created successfully!`);
                    navigate('/robots');
                  } else {
                    notify('error', 'Failed to create markdown robot');
                  }
                }}
                disabled={!url.trim() || !markdownRobotName.trim() || isLoading}
                sx={{
                  bgcolor: '#ff00c3',
                  py: 1.4,
                  fontSize: '1rem',
                  textTransform: 'none',
                  maxWidth: 700,
                  borderRadius: 2
                }}
                startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
              >
                {isLoading ? 'Creating...' : 'Create Markdown Robot'}
              </Button>
            </Box>
          </Card>
        </TabPanel>
      </Box>


      <GenericModal isOpen={isWarningModalOpen} onClose={() => {
        setWarningModalOpen(false);
        setIsLoading(false);
      }} modalStyle={modalStyle}>
        <div style={{ padding: '10px' }}>
          <Typography variant="h6" gutterBottom>{t('recordingtable.warning_modal.title')}</Typography>
          <Typography variant="body1" style={{ marginBottom: '20px' }}>
            {t('recordingtable.warning_modal.message')}
          </Typography>

          <Box display="flex" justifyContent="space-between" mt={2}>
            <Button
              onClick={handleDiscardAndCreate}
              variant="contained"
              color="error"
            >
              {t('recordingtable.warning_modal.discard_and_create')}
            </Button>
            <Button
              onClick={() => {
                setWarningModalOpen(false);
                setIsLoading(false);
              }}
              variant="outlined"
            >
              {t('recordingtable.warning_modal.cancel')}
            </Button>
          </Box>
        </div>
      </GenericModal>


    </Container>
  );
};

export default RobotCreate;

const modalStyle = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};