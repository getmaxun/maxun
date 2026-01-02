import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  TextField,
  Button,
  Checkbox,
  IconButton,
  Card,
  CircularProgress,
  Container,
  CardContent,
  Tabs,
  Tab,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Collapse,
  FormControlLabel
} from '@mui/material';
import { ArrowBack, AutoAwesome, HighlightAlt } from '@mui/icons-material';
import { useGlobalInfoStore, useCacheInvalidation } from '../../../context/globalInfo';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../../api/recording';
import { createScrapeRobot, createLLMRobot, createAndRunRecording, createCrawlRobot, createSearchRobot } from "../../../api/storage";
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
  const [extractRobotName, setExtractRobotName] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [activeBrowserId, setActiveBrowserId] = useState('');
  const [outputFormats, setOutputFormats] = useState<string[]>([]);
  const [generationMode, setGenerationMode] = useState<'agent' | 'recorder' | null>(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'openai' | 'ollama'>('ollama');
  const [llmModel, setLlmModel] = useState('default');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [aiRobotName, setAiRobotName] = useState('');

  const [crawlRobotName, setCrawlRobotName] = useState('');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlMode, setCrawlMode] = useState<'domain' | 'subdomain' | 'path'>('domain');
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(3);
  const [crawlIncludePaths, setCrawlIncludePaths] = useState<string>('');
  const [crawlExcludePaths, setCrawlExcludePaths] = useState<string>('');
  const [crawlUseSitemap, setCrawlUseSitemap] = useState(true);
  const [crawlFollowLinks, setCrawlFollowLinks] = useState(true);
  const [crawlRespectRobots, setCrawlRespectRobots] = useState(true);
  const [showCrawlAdvanced, setShowCrawlAdvanced] = useState(false);

  const [searchRobotName, setSearchRobotName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLimit, setSearchLimit] = useState(10);
  const [searchProvider] = useState<'duckduckgo'>('duckduckgo');
  const [searchMode, setSearchMode] = useState<'discover' | 'scrape'>('discover');
  const [searchTimeRange, setSearchTimeRange] = useState<'day' | 'week' | 'month' | 'year' | ''>('');

  const { state } = React.useContext(AuthContext);
  const { user } = state;
  const { addOptimisticRobot, removeOptimisticRobot, invalidateRecordings, invalidateRuns, addOptimisticRun } = useCacheInvalidation();

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

  const handleCreateCrawlRobot = async () => {
    if (!crawlUrl.trim()) {
      notify('error', 'Please enter a valid URL');
      return;
    }
    if (!crawlRobotName.trim()) {
      notify('error', 'Please enter a robot name');
      return;
    }

    setIsLoading(true);
    const result = await createCrawlRobot(
      crawlUrl,
      crawlRobotName,
      {
        mode: crawlMode,
        limit: crawlLimit,
        maxDepth: crawlMaxDepth,
        includePaths: crawlIncludePaths ? crawlIncludePaths.split(',').map(p => p.trim()) : [],
        excludePaths: crawlExcludePaths ? crawlExcludePaths.split(',').map(p => p.trim()) : [],
        useSitemap: crawlUseSitemap,
        followLinks: crawlFollowLinks,
        respectRobots: crawlRespectRobots
      }
    );
    setIsLoading(false);

    if (result) {
      invalidateRecordings();
      notify('success', `${crawlRobotName} created successfully!`);
      navigate('/robots');
    } else {
      notify('error', 'Failed to create crawl robot');
    }
  };

  const handleCreateSearchRobot = async () => {
    if (!searchQuery.trim()) {
      notify('error', 'Please enter a search query');
      return;
    }
    if (!searchRobotName.trim()) {
      notify('error', 'Please enter a robot name');
      return;
    }

    setIsLoading(true);
    const result = await createSearchRobot(
      searchRobotName,
      {
        query: searchQuery,
        limit: searchLimit,
        provider: searchProvider,
        filters: {
          timeRange: searchTimeRange ? searchTimeRange as 'day' | 'week' | 'month' | 'year' : undefined
        },
        mode: searchMode
      }
    );
    setIsLoading(false);

    if (result) {
      invalidateRecordings();
      notify('success', `${searchRobotName} created successfully!`);
      navigate('/robots');
    } else {
      notify('error', 'Failed to create search robot');
    }
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
            <Tab label="Scrape" id="scrape-robot" aria-controls="scrape-robot" />
            <Tab label="Crawl" id="crawl-robot" aria-controls="crawl-robot" />
            <Tab label="Search" id="search-robot" aria-controls="search-robot" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <Card sx={{ mb: 4, p: 4 }}>
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
                Extract structured data from websites using AI or record your own extraction workflow.
              </Typography>
              <Box sx={{ width: '100%', maxWidth: 700, mb: 3 }}>
                <TextField
                  placeholder="Example: https://www.ycombinator.com/companies/"
                  variant="outlined"
                  fullWidth
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  label="Website URL"
                />
              </Box>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom sx={{ mb: 2 }} color="text.secondary">
                  Choose How to Build
                </Typography>

                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Card
                    onClick={() => setGenerationMode('recorder')}
                    sx={{
                      flex: 1,
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: generationMode === 'recorder' ? '#ff00c3' : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: '#ff00c3',
                      }
                    }}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 3, color:"text.secondary" }}>
                      <HighlightAlt sx={{ fontSize: 32, mb: 1 }} />
                      <Typography variant="h6" gutterBottom>
                        Recorder Mode
                      </Typography>
                      <Typography variant="body2">
                        Record your actions into a workflow.
                      </Typography>
                    </CardContent>
                  </Card>

                  <Card
                    onClick={() => setGenerationMode('agent')}
                    sx={{
                      flex: 1,
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: generationMode === 'agent' ? '#ff00c3' : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: '#ff00c3',
                      },
                      position: 'relative'
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        background: '#ff00c3',
                        color: '#fff',
                        px: 1,
                        py: 0.3,
                        borderRadius: '10px',
                        fontSize: '0.7rem',
                      }}
                    >
                      Beta
                    </Box>

                    <CardContent sx={{ textAlign: 'center', py: 3, color:"text.secondary" }}>
                      <AutoAwesome sx={{ fontSize: 32, mb: 1 }} />
                      <Typography variant="h6" gutterBottom>
                        AI Mode
                      </Typography>
                      <Typography variant="body2">
                        Describe the task. It builds it for you.
                      </Typography>
                    </CardContent>
                  </Card>
                </Box>
              </Box>
                {generationMode === 'agent' && (
                  <Box sx={{ width: '100%', maxWidth: 700 }}>
                    <Box sx={{ mb: 3 }}>
                      <TextField
                        placeholder="Robot Name"
                        variant="outlined"
                        fullWidth
                        value={extractRobotName}
                        onChange={(e) => setExtractRobotName(e.target.value)}
                        label="Robot Name"
                      />
                    </Box>

                    <Box sx={{ mb: 3 }}>
                      <TextField
                        placeholder="Example: Extract first 15 company names, descriptions, and batch information"
                        variant="outlined"
                        fullWidth
                        multiline
                        rows={3}
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        label="Extraction Prompt"
                      />
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                      <FormControl sx={{ flex: 1 }}>
                        <InputLabel>LLM Provider</InputLabel>
                        <Select
                          value={llmProvider}
                          label="LLM Provider"
                          onChange={(e) => {
                            const provider = e.target.value as 'anthropic' | 'openai' | 'ollama';
                            setLlmProvider(provider);
                            setLlmModel('default');
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
                        <InputLabel>Model</InputLabel>
                        <Select
                          value={llmModel}
                          label="Model"
                          onChange={(e) => setLlmModel(e.target.value)}
                        >
                          {llmProvider === 'ollama' ? (
                            [
                              <MenuItem key="default" value="default">Default (llama3.2-vision)</MenuItem>,
                              <MenuItem key="llama3.2-vision" value="llama3.2-vision">llama3.2-vision</MenuItem>,
                              <MenuItem key="llama3.2" value="llama3.2">llama3.2</MenuItem>
                            ]
                          ) : llmProvider === 'anthropic' ? (
                            [
                              <MenuItem key="default" value="default">Default (claude-3-5-sonnet)</MenuItem>,
                              <MenuItem key="claude-3-5-sonnet-20241022" value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022</MenuItem>,
                              <MenuItem key="claude-3-opus-20240229" value="claude-3-opus-20240229">claude-3-opus-20240229</MenuItem>
                            ]
                          ) : (
                            [
                              <MenuItem key="default" value="default">Default (gpt-4-vision-preview)</MenuItem>,
                              <MenuItem key="gpt-4-vision-preview" value="gpt-4-vision-preview">gpt-4-vision-preview</MenuItem>,
                              <MenuItem key="gpt-4o" value="gpt-4o">gpt-4o</MenuItem>
                            ]
                          )}
                        </Select>
                      </FormControl>
                    </Box>

                    {/* API Key for non-Ollama providers */}
                    {llmProvider !== 'ollama' && (
                      <Box sx={{ mb: 3 }}>
                        <TextField
                          placeholder={`${llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API Key`}
                          variant="outlined"
                          fullWidth
                          type="password"
                          value={llmApiKey}
                          onChange={(e) => setLlmApiKey(e.target.value)}
                          label="API Key (Optional if set in .env)"
                        />
                      </Box>
                    )}

                    {llmProvider === 'ollama' && (
                      <Box sx={{ mb: 3 }}>
                        <TextField
                          placeholder="http://localhost:11434"
                          variant="outlined"
                          fullWidth
                          value={llmBaseUrl}
                          onChange={(e) => setLlmBaseUrl(e.target.value)}
                          label="Ollama Base URL (Optional)"
                        />
                      </Box>
                    )}

                    <Button
                      variant="contained"
                      fullWidth
                      onClick={async () => {
                        if (!url.trim()) {
                          notify('error', 'Please enter a valid URL');
                          return;
                        }
                        if (!extractRobotName.trim()) {
                          notify('error', 'Please enter a robot name');
                          return;
                        }
                        if (!aiPrompt.trim()) {
                          notify('error', 'Please enter an extraction prompt');
                          return;
                        }

                        const tempRobotId = `temp-${Date.now()}`;
                        const robotDisplayName = extractRobotName;

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

                        notify('info', `Robot ${robotDisplayName} creation started`);
                        navigate('/robots');

                        try {
                          const result = await createLLMRobot(
                            url,
                            aiPrompt,
                            llmProvider,
                            llmModel === 'default' ? undefined : llmModel,
                            llmApiKey || undefined,
                            llmBaseUrl || undefined,
                            extractRobotName
                          );

                          removeOptimisticRobot(tempRobotId);

                          if (!result || !result.robot) {
                            notify('error', 'Failed to create AI robot. Please check your LLM configuration.');
                            invalidateRecordings();
                            return;
                          }

                          const robotMetaId = result.robot.recording_meta.id;
                          const robotName = result.robot.recording_meta.name;

                          invalidateRecordings();
                          notify('success', `${robotName} created successfully!`);

                          const optimisticRun = {
                            id: robotMetaId,
                            runId: `temp-${Date.now()}`,
                            status: 'running',
                            name: robotName,
                            startedAt: new Date().toISOString(),
                            finishedAt: '',
                            robotMetaId: robotMetaId,
                            log: 'Starting...',
                            isOptimistic: true
                          };

                          addOptimisticRun(optimisticRun);

                          const runResponse = await createAndRunRecording(robotMetaId, {
                            maxConcurrency: 1,
                            maxRepeats: 1,
                            debug: false
                          });

                          invalidateRuns();

                          if (runResponse && runResponse.runId) {
                            await new Promise(resolve => setTimeout(resolve, 300));
                            navigate(`/runs/${robotMetaId}/run/${runResponse.runId}`);
                            notify('info', `Run started: ${robotName}`);
                          } else {
                            notify('warning', 'Robot created but failed to start execution.');
                            navigate('/robots');
                          }
                        } catch (error: any) {
                          console.error('Error in AI robot creation:', error);
                          removeOptimisticRobot(tempRobotId);
                          invalidateRecordings();
                          notify('error', error?.message || 'Failed to create and run AI robot');
                        }
                      }}
                      disabled={!url.trim() || !extractRobotName.trim() || !aiPrompt.trim() || isLoading}
                      sx={{
                        bgcolor: '#ff00c3',
                        py: 1.4,
                        fontSize: '1rem',
                        textTransform: 'none',
                        borderRadius: 2
                      }}
                      startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
                    >
                      {isLoading ? 'Creating & Running...' : 'Create & Run Robot'}
                    </Button>
                  </Box>
                )}

                {generationMode === 'recorder' && (
                  <Box sx={{ width: '100%', maxWidth: 700 }}>
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
                        borderRadius: 2
                      }}
                      startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
                    >
                      {isLoading ? 'Starting...' : 'Start Recording'}
                    </Button>
                  </Box>
                )}
              </Box>
          </Card>
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
                Crawl entire websites and gather data from multiple pages automatically.
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
                <TextField
                  label="Robot Name"
                  placeholder="Example: YC Companies Crawler"
                  fullWidth
                  value={crawlRobotName}
                  onChange={(e) => setCrawlRobotName(e.target.value)}
                  sx={{ mb: 2 }}
                />
                <TextField
                  label="Starting URL"
                  placeholder="https://www.ycombinator.com/companies"
                  fullWidth
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                  sx={{ mb: 2 }}
                />

                <TextField
                  label="Max Pages to Crawl"
                  type="number"
                  fullWidth
                  value={crawlLimit}
                  onChange={(e) => setCrawlLimit(parseInt(e.target.value) || 10)}
                  sx={{ mb: 2 }}
                />

                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-start', mb: 2 }}>
                  <Button
                  onClick={() => setShowCrawlAdvanced(!showCrawlAdvanced)}
                  sx={{
                    textTransform: 'none',
                    color: '#ff00c3',
                  }}
                  >
                  {showCrawlAdvanced ? 'Hide Advanced Options' : 'Advanced Options'}
                  </Button>
                </Box>

                <Collapse in={showCrawlAdvanced}>
                  <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Crawl Scope</InputLabel>
                      <Select
                        value={crawlMode}
                        label="Crawl Scope"
                        onChange={(e) => setCrawlMode(e.target.value as any)}
                      >
                        <MenuItem value="domain">Same Domain Only</MenuItem>
                        <MenuItem value="subdomain">Include Subdomains</MenuItem>
                        <MenuItem value="path">Specific Path Only</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      label="Max Depth"
                      type="number"
                      fullWidth
                      value={crawlMaxDepth}
                      onChange={(e) => setCrawlMaxDepth(parseInt(e.target.value) || 3)}
                      sx={{ mb: 2 }}
                      helperText="How many links deep to follow (default: 3)"
                      FormHelperTextProps={{ sx: { ml: 0 } }}
                    />

                    <TextField
                      label="Include Paths"
                      placeholder="Example: /products, /blog"
                      fullWidth
                      value={crawlIncludePaths}
                      onChange={(e) => setCrawlIncludePaths(e.target.value)}
                      sx={{ mb: 2 }}
                      helperText="Only crawl URLs matching these paths (comma-separated)"
                      FormHelperTextProps={{ sx: { ml: 0 } }}
                    />

                    <TextField
                      label="Exclude Paths"
                      placeholder="Example: /admin, /login"
                      fullWidth
                      value={crawlExcludePaths}
                      onChange={(e) => setCrawlExcludePaths(e.target.value)}
                      sx={{ mb: 2 }}
                      helperText="Skip URLs matching these paths (comma-separated)"
                      FormHelperTextProps={{ sx: { ml: 0 } }}
                    />

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={crawlUseSitemap}
                            onChange={(e) => setCrawlUseSitemap(e.target.checked)}
                          />
                        }
                        label="Use sitemap.xml for URL discovery"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={crawlFollowLinks}
                            onChange={(e) => setCrawlFollowLinks(e.target.checked)}
                          />
                        }
                        label="Follow links on pages"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={crawlRespectRobots}
                            onChange={(e) => setCrawlRespectRobots(e.target.checked)}
                          />
                        }
                        label="Respect robots.txt"
                      />
                    </Box>
                  </Box>
                </Collapse>
              </Box>

              <Button
                variant="contained"
                fullWidth
                onClick={handleCreateCrawlRobot}
                disabled={!crawlUrl.trim() || !crawlRobotName.trim() || isLoading}
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
                {isLoading ? 'Creating...' : 'Create Robot'}
              </Button>
            </Box>
          </Card>
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
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
                Search the web and gather data from relevant results.
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
                <TextField
                  label="Robot Name"
                  placeholder="Example: AI News Monitor"
                  fullWidth
                  value={searchRobotName}
                  onChange={(e) => setSearchRobotName(e.target.value)}
                  sx={{ mb: 2 }}
                />

                <TextField
                  label="Search Query"
                  placeholder="Example: latest AI breakthroughs 2025"
                  fullWidth
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  sx={{ mb: 2 }}
                />

                <TextField
                  label="Number of Results"
                  type="number"
                  fullWidth
                  value={searchLimit}
                  onChange={(e) => setSearchLimit(parseInt(e.target.value) || 10)}
                  sx={{ mb: 2 }}
                />

                <Box sx={{ display: 'flex', gap: 2 }}>
                  <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Mode</InputLabel>
                  <Select
                    value={searchMode}
                    label="Mode"
                    onChange={(e) => setSearchMode(e.target.value as any)}
                  >
                    <MenuItem value="discover">Discover URLs Only</MenuItem>
                    <MenuItem value="scrape">Extract Data from Results</MenuItem>
                  </Select>
                  </FormControl>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={searchTimeRange}
                    label="Time Range"
                    onChange={(e) => setSearchTimeRange(e.target.value as 'day' | 'week' | 'month' | 'year' | '')}
                  >
                    <MenuItem value="">No Filter</MenuItem>
                    <MenuItem value="day">Past 24 Hours</MenuItem>
                    <MenuItem value="week">Past Week</MenuItem>
                    <MenuItem value="month">Past Month</MenuItem>
                    <MenuItem value="year">Past Year</MenuItem>
                  </Select>
                  </FormControl>
                </Box>
              </Box>

              <Button
                variant="contained"
                fullWidth
                onClick={handleCreateSearchRobot}
                disabled={!searchQuery.trim() || !searchRobotName.trim() || isLoading}
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
                {isLoading ? 'Creating...' : 'Create Robot'}
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