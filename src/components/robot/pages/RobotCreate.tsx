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
  Tab,
  FormControl,
  Select,
  MenuItem,
  InputLabel
} from '@mui/material';
import { ArrowBack, PlayCircleOutline, Article, Code, Description } from '@mui/icons-material';
import { useGlobalInfoStore, useCacheInvalidation } from '../../../context/globalInfo';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../../api/recording';
import { createScrapeRobot, createLLMRobot, createAndRunRecording } from "../../../api/storage";
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
  const [scrapeRobotName, setScrapeRobotName] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [activeBrowserId, setActiveBrowserId] = useState('');
  const [outputFormats, setOutputFormats] = useState<string[]>([]);

  // AI Extract tab state
  const [aiPrompt, setAiPrompt] = useState('');
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'openai' | 'ollama'>('ollama');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [aiRobotName, setAiRobotName] = useState('');

  const { state } = React.useContext(AuthContext);
  const { user } = state;
  const { addOptimisticRobot, removeOptimisticRobot, invalidateRecordings } = useCacheInvalidation();

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

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, mt: "-30px" }}>
          <Tabs
            value={tabValue}
            centered
            onChange={handleTabChange}
            aria-label="robot type tabs"
            sx={{
              minHeight: 36,
              '& .MuiTab-root': {
                minHeight: 36,
                paddingX: 2,
                paddingY: 1.5,
                minWidth: 0,
              },
              '& .MuiTabs-indicator': {
                height: 2,
              },
            }}
          >
            <Tab label="Extract" id="extract-robot" aria-controls="extract-robot" />
            <Tab label="AI Extract" id="ai-extract-robot" aria-controls="ai-extract-robot" />
            <Tab label="Scrape" id="scrape-robot" aria-controls="scrape-robot" />
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

              <Typography variant="body2" color="text.secondary" mb={3}>
                Extract structured data from websites in a few clicks.
              </Typography>

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

              <Typography variant="body2" color="text.secondary" mb={3}>
                AI-powered extraction: Describe what you want to extract in natural language.
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
                <TextField
                  placeholder="Example: AI Product Extractor"
                  variant="outlined"
                  fullWidth
                  value={aiRobotName}
                  onChange={(e) => setAiRobotName(e.target.value)}
                  sx={{ mb: 2 }}
                  label="Robot Name (Optional)"
                />
                <TextField
                  placeholder="Example: https://www.ycombinator.com/companies/"
                  variant="outlined"
                  fullWidth
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  label="Website URL"
                  sx={{ mb: 2 }}
                />
                <TextField
                  placeholder="Example: Extract first 15 company names, descriptions, and batch information"
                  variant="outlined"
                  fullWidth
                  multiline
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  label="Extraction Prompt"
                  sx={{ mb: 2 }}
                />

                <Box sx={{ width: '100%', display: 'flex', gap: 2, mb: 2 }}>
                  <FormControl sx={{ flex: 1 }}>
                    <InputLabel id="llm-provider-label">LLM Provider</InputLabel>
                    <Select
                      labelId="llm-provider-label"
                      id="llm-provider"
                      value={llmProvider}
                      label="LLM Provider"
                      onChange={(e) => {
                        const provider = e.target.value as 'anthropic' | 'openai' | 'ollama';
                        setLlmProvider(provider);
                        setLlmModel('');
                        if (provider === 'ollama') {
                          setLlmBaseUrl('http://localhost:11434');
                        } else {
                          setLlmBaseUrl('');
                        }
                      }}
                    >
                      <MenuItem value="ollama">Ollama (Local)</MenuItem>
                      <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
                      <MenuItem value="openai">OpenAI (GPT-4)</MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl sx={{ flex: 1 }}>
                    <InputLabel id="llm-model-label">Model (Optional)</InputLabel>
                    <Select
                      labelId="llm-model-label"
                      id="llm-model"
                      value={llmModel}
                      label="Model (Optional)"
                      onChange={(e) => setLlmModel(e.target.value)}
                    >
                      {llmProvider === 'ollama' && (
                        <>
                          <MenuItem value="">Default (llama3.2-vision)</MenuItem>
                          <MenuItem value="llama3.2-vision">llama3.2-vision</MenuItem>
                          <MenuItem value="llama3.2">llama3.2</MenuItem>
                        </>
                      )}
                      {llmProvider === 'anthropic' && (
                        <>
                          <MenuItem value="">Default (claude-3-5-sonnet)</MenuItem>
                          <MenuItem value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022</MenuItem>
                          <MenuItem value="claude-3-opus-20240229">claude-3-opus-20240229</MenuItem>
                        </>
                      )}
                      {llmProvider === 'openai' && (
                        <>
                          <MenuItem value="">Default (gpt-4-vision-preview)</MenuItem>
                          <MenuItem value="gpt-4-vision-preview">gpt-4-vision-preview</MenuItem>
                          <MenuItem value="gpt-4o">gpt-4o</MenuItem>
                        </>
                      )}
                    </Select>
                  </FormControl>
                </Box>

                {llmProvider !== 'ollama' && (
                  <TextField
                    placeholder={`${llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API Key (or set in .env)`}
                    variant="outlined"
                    fullWidth
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    label="API Key (Optional if set in .env)"
                    sx={{ mb: 2 }}
                  />
                )}

                {llmProvider === 'ollama' && (
                  <TextField
                    placeholder="http://localhost:11434"
                    variant="outlined"
                    fullWidth
                    value={llmBaseUrl}
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    label="Ollama Base URL (Optional)"
                    sx={{ mb: 2 }}
                  />
                )}
              </Box>

              <Button
                variant="contained"
                fullWidth
                onClick={async () => {
                  if (!url.trim()) {
                    notify('error', 'Please enter a valid URL');
                    return;
                  }
                  if (!aiPrompt.trim()) {
                    notify('error', 'Please enter an extraction prompt');
                    return;
                  }

                  const tempRobotId = `temp-${Date.now()}`;
                  const robotDisplayName = aiRobotName || `LLM Extract: ${aiPrompt.substring(0, 50)}`;

                  const optimisticRobot = {
                    id: tempRobotId,
                    recording_meta: {
                      id: tempRobotId,
                      name: robotDisplayName,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      pairs: 0,
                      params: [],
                      type: 'extract',
                      url: url,
                    },
                    recording: { workflow: [] },
                    isLoading: true,
                    isOptimistic: true
                  };

                  addOptimisticRobot(optimisticRobot);

                  notify('info', `Robot ${robotDisplayName} creation started (AI Powered)`);
                  navigate('/robots');

                  try {
                    const result = await createLLMRobot(
                      url,
                      aiPrompt,
                      llmProvider,
                      llmModel || undefined,
                      llmApiKey || undefined,
                      llmBaseUrl || undefined,
                      aiRobotName || undefined
                    );

                    removeOptimisticRobot(tempRobotId);

                    if (!result || !result.robot) {
                      notify('error', 'Failed to create AI robot. Please check your LLM configuration.');
                      invalidateRecordings();
                      return;
                    }

                    const robotMetaId = result.robot.recording_meta.id;
                    notify('success', `${result.robot.recording_meta.name} created successfully!`);

                    invalidateRecordings();

                    await new Promise(resolve => setTimeout(resolve, 500));

                    notify('info', 'Starting robot execution...');
                    const runResponse = await createAndRunRecording(robotMetaId, {
                      maxConcurrency: 1,
                      maxRepeats: 1,
                      debug: true
                    });

                    if (runResponse && runResponse.runId) {
                      notify('success', 'Robot is now running!');
                      navigate(`/runs/${robotMetaId}/run/${runResponse.runId}`);
                    } else {
                      notify('warning', 'Robot created but failed to start execution. You can run it manually from the robots page.');
                    }
                  } catch (error: any) {
                    console.error('Error in AI robot creation:', error);
                    removeOptimisticRobot(tempRobotId);
                    invalidateRecordings();
                    notify('error', error?.message || 'Failed to create and run AI robot');
                  }
                }}
                disabled={!url.trim() || !aiPrompt.trim() || isLoading}
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
                {isLoading ? 'Creating & Running...' : 'Create & Run AI Robot'}
              </Button>
            </Box>
          </Card>
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
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

              <Typography variant="body2" color="text.secondary" mb={3}>
                Turn websites into LLM-ready Markdown, clean HTML, or screenshots for AI apps.
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
                <TextField
                  placeholder="Example: YC Companies Scraper"
                  variant="outlined"
                  fullWidth
                  value={scrapeRobotName}
                  onChange={(e) => setScrapeRobotName(e.target.value)}
                  sx={{ mb: 2 }}
                  label="Robot Name"
                />
                <TextField
                  placeholder="Example: https://www.ycombinator.com/companies/"
                  variant="outlined"
                  fullWidth
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  label="Website URL"
                  sx={{ mb: 2 }}
                />

                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-start' }}>
                  <FormControl sx={{ mb: 2, width: '300px' }}>
                    <InputLabel id="output-formats-label">Output Formats *</InputLabel>
                    <Select
                      labelId="output-formats-label"
                      id="output-formats"
                      multiple
                      value={outputFormats}
                      label="Output Formats *"
                      onChange={(e) => {
                        const value = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                        setOutputFormats(value);
                      }}
                      renderValue={(selected) => {
                        if (selected.length === 0) {
                          return <em style={{ color: '#999' }}>Select formats</em>;
                        }
                        return `${selected.length} format${selected.length > 1 ? 's' : ''} selected`;
                      }}
                      MenuProps={{
                        PaperProps: {
                          style: {
                            maxHeight: 300,
                          },
                        },
                      }}
                    >
                      <MenuItem value="markdown">
                        <Checkbox checked={outputFormats.includes('markdown')} />
                        Markdown
                      </MenuItem>
                      <MenuItem value="html">
                        <Checkbox checked={outputFormats.includes('html')} />
                        HTML
                      </MenuItem>
                      <MenuItem value="screenshot-visible">
                        <Checkbox checked={outputFormats.includes('screenshot-visible')} />
                        Screenshot - Visible Viewport
                      </MenuItem>
                      <MenuItem value="screenshot-fullpage">
                        <Checkbox checked={outputFormats.includes('screenshot-fullpage')} />
                        Screenshot - Full Page
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Box>

              <Button
                variant="contained"
                fullWidth
                onClick={async () => {
                  if (!url.trim()) {
                    notify('error', 'Please enter a valid URL');
                    return;
                  }
                  if (!scrapeRobotName.trim()) {
                    notify('error', 'Please enter a robot name');
                    return;
                  }
                  if (outputFormats.length === 0) {
                    notify('error', 'Please select at least one output format');
                    return;
                  }

                  setIsLoading(true);
                  const result = await createScrapeRobot(url, scrapeRobotName, outputFormats);
                  setIsLoading(false);

                  if (result) {
                    setRerenderRobots(true);
                    notify('success', `${scrapeRobotName} created successfully!`);
                    navigate('/robots');
                  } else {
                    notify('error', 'Failed to create scrape robot');
                  }
                }}
                disabled={!url.trim() || !scrapeRobotName.trim() || outputFormats.length === 0 || isLoading}
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
                {isLoading
                  ? "Creating..."
                  : `Create Robot`
                }
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