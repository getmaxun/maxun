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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  FormControlLabel
} from '@mui/material';
import { ArrowBack, AutoAwesome, HighlightAlt, Article } from '@mui/icons-material';
import { useGlobalInfoStore, useCacheInvalidation } from '../../../context/globalInfo';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../../api/recording';
import { createScrapeRobot, createLLMRobot, createAndRunRecording, createCrawlRobot, createSearchRobot, createDocumentExtractRobot, createDocumentParseRobot } from "../../../api/storage";
import { AuthContext } from '../../../context/auth';
import { DEFAULT_OUTPUT_FORMATS, DOC_PARSE_FORMAT_OPTIONS, OUTPUT_FORMAT_LABELS, OUTPUT_FORMAT_OPTIONS, OutputFormats } from '../../../constants/outputFormats';

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

type LlmProvider = 'anthropic' | 'openai' | 'ollama';
type OpenAICompatiblePresetId = 'openai' | 'qianfan' | 'openrouter' | 'deepseek' | 'custom';

interface OpenAICompatiblePreset {
  label: string;
  baseUrl: string;
  baseUrlPlaceholder: string;
  baseUrlHelperText: string;
  modelPlaceholder: string;
  modelHelperText: string;
  apiKeyPlaceholder: string;
  apiKeyHelperText: string;
}

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_OPENAI_COMPATIBLE_PRESET_ID: OpenAICompatiblePresetId = 'openai';

const OPENAI_COMPATIBLE_PRESETS: Record<OpenAICompatiblePresetId, OpenAICompatiblePreset> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    baseUrlHelperText: 'Override only if your OpenAI-compatible endpoint is different.',
    modelPlaceholder: 'e.g. gpt-4o',
    modelHelperText: "Use an OpenAI model, or leave blank to use Maxun's default.",
    apiKeyPlaceholder: 'OpenAI API key',
    apiKeyHelperText: 'Use an OpenAI API key. If blank, Maxun falls back to OPENAI_API_KEY on the server.',
  },
  qianfan: {
    label: 'Qianfan / ERNIE',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    baseUrlPlaceholder: 'https://qianfan.baidubce.com/v2',
    baseUrlHelperText: 'Use the Qianfan OpenAI-compatible endpoint, or override it for your account.',
    modelPlaceholder: 'e.g. ernie-4.5-turbo-128k',
    modelHelperText: 'Enter an ERNIE model available in your Qianfan account.',
    apiKeyPlaceholder: 'Qianfan API key',
    apiKeyHelperText: 'Use a Qianfan API key. If blank, Maxun falls back to OPENAI_API_KEY on the server.',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    baseUrlPlaceholder: 'https://openrouter.ai/api/v1',
    baseUrlHelperText: 'Use the OpenRouter OpenAI-compatible endpoint, or override it for your account.',
    modelPlaceholder: 'e.g. openai/gpt-4o-mini',
    modelHelperText: 'Enter an OpenRouter model id from your enabled models.',
    apiKeyPlaceholder: 'OpenRouter API key',
    apiKeyHelperText: 'Use an OpenRouter API key. If blank, Maxun falls back to OPENAI_API_KEY on the server.',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    baseUrlPlaceholder: 'https://api.deepseek.com',
    baseUrlHelperText: 'Use the DeepSeek OpenAI-compatible endpoint, or override it for your account.',
    modelPlaceholder: 'e.g. deepseek-v4-flash',
    modelHelperText: 'Enter a DeepSeek model, for example deepseek-v4-flash.',
    apiKeyPlaceholder: 'DeepSeek API key',
    apiKeyHelperText: 'Use a DeepSeek API key. If blank, Maxun falls back to OPENAI_API_KEY on the server.',
  },
  custom: {
    label: 'Custom',
    baseUrl: '',
    baseUrlPlaceholder: 'https://api.example.com/v1',
    baseUrlHelperText: 'Enter your provider OpenAI-compatible base URL.',
    modelPlaceholder: 'e.g. provider-model-name',
    modelHelperText: 'Enter the model name expected by your provider.',
    apiKeyPlaceholder: 'Provider API key',
    apiKeyHelperText: 'Use the API key for your OpenAI-compatible provider.',
  },
};

const OPENAI_COMPATIBLE_PRESET_IDS: OpenAICompatiblePresetId[] = [
  'openai',
  'qianfan',
  'openrouter',
  'deepseek',
  'custom',
];

const getOpenAICompatiblePreset = (presetId: OpenAICompatiblePresetId) =>
  OPENAI_COMPATIBLE_PRESETS[presetId];

interface ModelFieldTextOptions {
  ollamaPlaceholder?: string;
  ollamaHelperText?: string;
  anthropicPlaceholder?: string;
  anthropicHelperText?: string;
}

const getModelPlaceholder = (
  provider: LlmProvider,
  presetId: OpenAICompatiblePresetId,
  options: ModelFieldTextOptions = {}
) => {
  if (provider === 'ollama') return options.ollamaPlaceholder || 'e.g. llama3.2-vision';
  if (provider === 'anthropic') return options.anthropicPlaceholder || 'e.g. claude-sonnet-4-6';
  return getOpenAICompatiblePreset(presetId).modelPlaceholder;
};

const getModelHelperText = (
  provider: LlmProvider,
  presetId: OpenAICompatiblePresetId,
  options: ModelFieldTextOptions = {}
) => {
  if (provider === 'ollama') return options.ollamaHelperText || 'Leave blank to use default: llama3.2-vision';
  if (provider === 'anthropic') return options.anthropicHelperText || 'Leave blank to use default: claude-sonnet-4-6';
  return getOpenAICompatiblePreset(presetId).modelHelperText;
};

const DOCUMENT_MODEL_FIELD_TEXT: ModelFieldTextOptions = {
  ollamaPlaceholder: 'e.g. llama3.2:latest',
  ollamaHelperText: 'Leave blank to use default: llama3.2:latest',
  anthropicPlaceholder: 'e.g. claude-3-5-haiku-20241022',
  anthropicHelperText: 'Leave blank to use default: claude-3-5-haiku-20241022',
};

interface OpenAICompatiblePresetFieldsProps {
  presetId: OpenAICompatiblePresetId;
  onPresetChange: (presetId: OpenAICompatiblePresetId) => void;
  baseUrl: string;
  onBaseUrlChange: (baseUrl: string) => void;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  bottomMargin?: number;
}

const OpenAICompatiblePresetFields: React.FC<OpenAICompatiblePresetFieldsProps> = ({
  presetId,
  onPresetChange,
  baseUrl,
  onBaseUrlChange,
  apiKey,
  onApiKeyChange,
  bottomMargin = 3,
}) => {
  const preset = getOpenAICompatiblePreset(presetId);

  return (
    <>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>OpenAI-compatible Preset</InputLabel>
        <Select
          value={presetId}
          label="OpenAI-compatible Preset"
          onChange={(e) => onPresetChange(e.target.value as OpenAICompatiblePresetId)}
        >
          {OPENAI_COMPATIBLE_PRESET_IDS.map((id) => (
            <MenuItem key={id} value={id}>
              {OPENAI_COMPATIBLE_PRESETS[id].label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        placeholder={preset.baseUrlPlaceholder}
        variant="outlined"
        fullWidth
        value={baseUrl}
        onChange={(e) => onBaseUrlChange(e.target.value)}
        label="Base URL"
        helperText={preset.baseUrlHelperText}
        sx={{ mb: 2 }}
        FormHelperTextProps={{ sx: { ml: 0.5 } }}
      />

      <TextField
        placeholder={preset.apiKeyPlaceholder}
        variant="outlined"
        fullWidth
        type="password"
        value={apiKey}
        onChange={(e) => onApiKeyChange(e.target.value)}
        label="API Key"
        helperText={preset.apiKeyHelperText}
        sx={{ mb: bottomMargin }}
        FormHelperTextProps={{ sx: { ml: 0.5 } }}
      />
    </>
  );
};

const RobotCreate: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setBrowserId, setRecordingUrl, notify, setRecordingId, setRerenderRobots, recordings } = useGlobalInfoStore();

  const [tabValue, setTabValue] = useState(0);
  const [url, setUrl] = useState('');
  const [scrapeRobotName, setScrapeRobotName] = useState('');
  const [extractRobotName, setExtractRobotName] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [activeBrowserId, setActiveBrowserId] = useState('');
  const [outputFormats, setOutputFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);
  const [generationMode, setGenerationMode] = useState<'agent' | 'recorder' | null>('recorder');

  const [aiPrompt, setAiPrompt] = useState('');
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('ollama');
  const [llmOpenAICompatiblePreset, setLlmOpenAICompatiblePreset] = useState<OpenAICompatiblePresetId>(DEFAULT_OPENAI_COMPATIBLE_PRESET_ID);
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');

  const [scrapePromptInstructions, setScrapePromptInstructions] = useState('');
  const [scrapePromptLlmProvider, setScrapePromptLlmProvider] = useState<LlmProvider>('ollama');
  const [scrapePromptOpenAICompatiblePreset, setScrapePromptOpenAICompatiblePreset] = useState<OpenAICompatiblePresetId>(DEFAULT_OPENAI_COMPATIBLE_PRESET_ID);
  const [scrapePromptLlmModel, setScrapePromptLlmModel] = useState('');
  const [scrapePromptLlmApiKey, setScrapePromptLlmApiKey] = useState('');
  const [scrapePromptLlmBaseUrl, setScrapePromptLlmBaseUrl] = useState(OLLAMA_DEFAULT_BASE_URL);
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

  const [crawlOutputFormats, setCrawlOutputFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);
  const [searchOutputFormats, setSearchOutputFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);

  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState('');
  const [documentRobotName, setDocumentRobotName] = useState('');
  const [documentMode, setDocumentMode] = useState<'extract' | 'parse'>('extract');
  const [documentParseFormats, setDocumentParseFormats] = useState<OutputFormats[]>([]);
  const [documentLlmProvider, setDocumentLlmProvider] = useState<LlmProvider>('ollama');
  const [documentOpenAICompatiblePreset, setDocumentOpenAICompatiblePreset] = useState<OpenAICompatiblePresetId>(DEFAULT_OPENAI_COMPATIBLE_PRESET_ID);
  const [documentLlmModel, setDocumentLlmModel] = useState('');
  const [documentLlmApiKey, setDocumentLlmApiKey] = useState('');
  const [documentLlmBaseUrl, setDocumentLlmBaseUrl] = useState('');

  const { state } = React.useContext(AuthContext);
  const { user } = state;
  const { addOptimisticRobot, removeOptimisticRobot, invalidateRecordings, invalidateRuns, updateOptimisticRun } = useCacheInvalidation();

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const getBaseUrlForProvider = (provider: LlmProvider, presetId: OpenAICompatiblePresetId) => {
    if (provider === 'ollama') return OLLAMA_DEFAULT_BASE_URL;
    if (provider === 'openai') return getOpenAICompatiblePreset(presetId).baseUrl;
    return '';
  };

  const applyLlmProvider = (
    provider: LlmProvider,
    presetId: OpenAICompatiblePresetId,
    setProvider: React.Dispatch<React.SetStateAction<LlmProvider>>,
    setModel: React.Dispatch<React.SetStateAction<string>>,
    setBaseUrl: React.Dispatch<React.SetStateAction<string>>,
    setApiKey: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setProvider(provider);
    setModel('');
    setBaseUrl(getBaseUrlForProvider(provider, presetId));
    setApiKey('');
  };

  const applyOpenAICompatiblePreset = (
    presetId: OpenAICompatiblePresetId,
    setPresetId: React.Dispatch<React.SetStateAction<OpenAICompatiblePresetId>>,
    setModel: React.Dispatch<React.SetStateAction<string>>,
    setBaseUrl: React.Dispatch<React.SetStateAction<string>>,
    setApiKey: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setPresetId(presetId);
    setModel('');
    setBaseUrl(getOpenAICompatiblePreset(presetId).baseUrl);
    setApiKey('');
  };


  const normalizeUrl = (rawUrl: string): string => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  };

  const handleStartRecording = async () => {
    if (!url.trim()) {
      notify('error', 'Please enter a valid URL');
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    setUrl(normalizedUrl);

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
      setRecordingUrl(normalizedUrl);

      window.sessionStorage.setItem('browserId', 'new-recording');
      window.sessionStorage.setItem('recordingUrl', normalizedUrl);
      window.sessionStorage.setItem('initialUrl', normalizedUrl);
      window.sessionStorage.setItem('needsLogin', needsLogin.toString());

      const sessionId = Date.now().toString();
      window.sessionStorage.setItem('recordingSessionId', sessionId);
      window.sessionStorage.setItem('recordingOriginPage', window.location.pathname + window.location.search);

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
    window.sessionStorage.setItem('recordingOriginPage', window.location.pathname + window.location.search);

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
    if (crawlOutputFormats.length === 0) {
      notify('error', 'Please select at least one output format');
      return;
    }

    const normalizedCrawlUrl = normalizeUrl(crawlUrl);
    setCrawlUrl(normalizedCrawlUrl);

    setIsLoading(true);
    try {
      const result = await createCrawlRobot(
        normalizedCrawlUrl,
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
        },
        crawlOutputFormats
      );
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${crawlRobotName} created successfully!`);
        navigate('/robots');
      } else {
        notify('error', 'Failed to create crawl robot');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create crawl robot');
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
    if (searchMode === 'scrape' && searchOutputFormats.length === 0) {
      notify('error', 'Please select at least one output format');
      return;
    }

    setIsLoading(true);
    try {
      const formatsForRequest = searchMode === 'discover' ? [] : searchOutputFormats;

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
        },
        formatsForRequest
      );
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${searchRobotName} created successfully!`);
        navigate('/robots');
      } else {
        notify('error', 'Failed to create search robot');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create search robot');
    }
  };

  const handleCreateDocumentRobot = async () => {
    if (!documentFile) { notify('error', 'Please upload a PDF file'); return; }
    if (!documentPrompt.trim()) { notify('error', 'Please enter an extraction prompt'); return; }
    if (!documentRobotName.trim()) { notify('error', 'Please enter a robot name'); return; }

    setIsLoading(true);
    try {
      const result = await createDocumentExtractRobot(
        documentFile,
        documentPrompt.trim(),
        documentRobotName.trim(),
        documentLlmProvider,
        documentLlmModel || undefined,
        documentLlmApiKey || undefined,
        documentLlmBaseUrl || undefined
      );
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${documentRobotName} created successfully!`);
        navigate('/robots');
      } else {
        notify('error', 'Failed to create document robot');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create document robot');
    }
  };

  const handleCreateDocumentParseRobot = async () => {
    if (!documentFile) { notify('error', 'Please upload a PDF file'); return; }
    if (!documentRobotName.trim()) { notify('error', 'Please enter a robot name'); return; }
    if (documentParseFormats.length === 0) { notify('error', 'Please select at least one output format'); return; }

    setIsLoading(true);
    try {
      const result = await createDocumentParseRobot(
        documentFile,
        documentRobotName.trim(),
        documentParseFormats
      );
      setIsLoading(false);
      if (result) {
        invalidateRecordings();
        notify('success', `${documentRobotName} created successfully!`);
        navigate('/robots');
      } else {
        notify('error', 'Failed to create document parse robot');
      }
    } catch (error: any) {
      setIsLoading(false);
      notify('error', error.message || 'Failed to create document parse robot');
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

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, mt: "-10px" }}>
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
            <Tab label="Document" id="document-robot" aria-controls="document-robot" />
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
                    <CardContent sx={{ textAlign: 'center', py: 3, color: "text.secondary" }}>
                      <HighlightAlt sx={{ fontSize: 26, mb: 0.5 }} />
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

                    <CardContent sx={{ textAlign: 'center', py: 3, color: "text.secondary" }}>
                      <AutoAwesome sx={{ fontSize: 26, mb: 0.5 }} />
                      <Typography variant="h6" gutterBottom>
                        AI Mode
                      </Typography>
                      <Typography variant="body2">
                        Describe the task. Maxun builds it for you.
                      </Typography>
                    </CardContent>
                  </Card>
                </Box>
              </Box>
              {generationMode === 'agent' && (
                <Box sx={{ width: '100%', maxWidth: 700 }}>
                  <Box sx={{ mb: 3 }}>
                    <TextField
                      placeholder="Name"
                      variant="outlined"
                      fullWidth
                      value={extractRobotName}
                      onChange={(e) => setExtractRobotName(e.target.value)}
                      label="Name"
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

                  <Box sx={{ mb: 3 }}>
                    <TextField
                      placeholder="Example: https://www.ycombinator.com/companies/"
                      variant="outlined"
                      fullWidth
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onBlur={() => setUrl(normalizeUrl(url))}
                      label="Website URL (Optional)"
                    />
                  </Box>

                  <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                    <FormControl sx={{ flex: 1 }}>
                      <InputLabel>LLM Provider</InputLabel>
                      <Select
                        value={llmProvider}
                        label="LLM Provider"
                        onChange={(e) => {
                          applyLlmProvider(
                            e.target.value as LlmProvider,
                            llmOpenAICompatiblePreset,
                            setLlmProvider,
                            setLlmModel,
                            setLlmBaseUrl,
                            setLlmApiKey
                          );
                        }}
                      >
                        <MenuItem value="ollama">Ollama (Local)</MenuItem>
                        <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
                        <MenuItem value="openai">OpenAI-compatible</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      sx={{ flex: 1 }}
                      value={llmModel}
                      label="Model"
                      placeholder={getModelPlaceholder(llmProvider, llmOpenAICompatiblePreset)}
                      onChange={(e) => setLlmModel(e.target.value)}
                      helperText={getModelHelperText(llmProvider, llmOpenAICompatiblePreset)}
                      FormHelperTextProps={{ sx: { ml: 0.5 } }}
                    />
                  </Box>

                  {llmProvider === 'openai' && (
                    <OpenAICompatiblePresetFields
                      presetId={llmOpenAICompatiblePreset}
                      onPresetChange={(presetId) => applyOpenAICompatiblePreset(
                        presetId,
                        setLlmOpenAICompatiblePreset,
                        setLlmModel,
                        setLlmBaseUrl,
                        setLlmApiKey
                      )}
                      baseUrl={llmBaseUrl}
                      onBaseUrlChange={setLlmBaseUrl}
                      apiKey={llmApiKey}
                      onApiKeyChange={setLlmApiKey}
                    />
                  )}

                  {llmProvider === 'anthropic' && (
                    <Box sx={{ mb: 3 }}>
                      <TextField
                        placeholder="Anthropic API key"
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
                      // URL is optional for AI mode - it will auto-search if not provided
                      if (!extractRobotName.trim()) {
                        notify('error', 'Please enter a robot name');
                        return;
                      }
                      if (!aiPrompt.trim()) {
                        notify('error', 'Please enter an extraction prompt');
                        return;
                      }
                      if (recordings.some(r => r.trim().toLowerCase() === extractRobotName.trim().toLowerCase())) {
                        notify('error', `A robot with the name "${extractRobotName.trim()}" already exists.`);
                        return;
                      }

                      const normalizedUrl = normalizeUrl(url);
                      setUrl(normalizedUrl);

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
                          url: normalizedUrl || '(auto-detecting...)',
                        },
                        recording: { workflow: [] },
                        isLoading: true,
                        isOptimistic: true
                      };

                      addOptimisticRobot(optimisticRobot);

                      notify('info', normalizedUrl
                        ? `Robot ${robotDisplayName} creation started`
                        : `Robot ${robotDisplayName} creation started (searching for website...)`);
                      navigate('/robots');

                      try {
                        const result = await createLLMRobot(
                          normalizedUrl || undefined,
                          aiPrompt,
                          llmProvider,
                          llmModel.trim() || undefined,
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

                        updateOptimisticRun(optimisticRun);

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
                    disabled={!extractRobotName.trim() || !aiPrompt.trim() || isLoading}
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
                <>
                  <Box sx={{ width: '100%', maxWidth: 700, mb: 3 }}>
                    <TextField
                      placeholder="Example: https://www.ycombinator.com/companies/"
                      variant="outlined"
                      fullWidth
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onBlur={() => setUrl(normalizeUrl(url))}
                      label="Website URL"
                    />
                  </Box>
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
                </>
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
                  label="Name"
                />
                <TextField
                  placeholder="Example: https://www.ycombinator.com/companies/"
                  variant="outlined"
                  fullWidth
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setUrl(normalizeUrl(url))}
                  label="Website URL"
                  sx={{ mb: 2 }}
                />

                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-start' }}>
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id="output-formats-label">Output Formats *</InputLabel>
                    <Select
                      labelId="output-formats-label"
                      id="output-formats"
                      multiple
                      value={outputFormats}
                      label="Output Formats *"
                      onChange={(e) => {
                        const value = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                        setOutputFormats(value as OutputFormats[]);
                      }}
                      renderValue={(selected) => {
                        const labels = selected.map(v => OUTPUT_FORMAT_LABELS[v] ?? v);
                        return labels.length > 2 ? `${labels.slice(0, 2).join(', ')}…` : labels.join(', ');
                      }}
                      MenuProps={{
                        PaperProps: {
                          style: {
                            maxHeight: 300,
                          },
                        },
                      }}
                    >
                      {OUTPUT_FORMAT_OPTIONS.map((format) => (
                        <MenuItem key={format} value={format}>
                          <Checkbox checked={outputFormats.includes(format)} />
                          {OUTPUT_FORMAT_LABELS[format]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              </Box>

              <Box sx={{ width: '100%', maxWidth: 700, mb: 2 }}>
                <TextField
                  placeholder={`Example: Click the "Login" button and extract the user profile data.\nExample: Navigate to the pricing page and list all plan names and prices.\nExample: Fill in the search box with "AI tools" and return the first 5 results.`}
                  variant="outlined"
                  fullWidth
                  multiline
                  minRows={3}
                  maxRows={6}
                  value={scrapePromptInstructions}
                  onChange={(e) => setScrapePromptInstructions(e.target.value)}
                  label="Smart Queries (Optional)"
                  helperText={
                    <>
                      After scraping, Smart Queries analyze the page and return results based on your instructions.{" "}
                      <a
                        href="https://docs.maxun.dev/robot/scrape#smart-queries"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: "none" }}
                      >
                        Learn more
                      </a>
                    </>
                  }
                  sx={{ mb: 2 }}
                  FormHelperTextProps={{ sx: { ml: 0.5, mb: 2 } }}
                />
                <Box>
                  <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <FormControl sx={{ flex: 1 }}>
                      <InputLabel>LLM Provider</InputLabel>
                      <Select
                        value={scrapePromptLlmProvider}
                        label="LLM Provider"
                        onChange={(e) => {
                          applyLlmProvider(
                            e.target.value as LlmProvider,
                            scrapePromptOpenAICompatiblePreset,
                            setScrapePromptLlmProvider,
                            setScrapePromptLlmModel,
                            setScrapePromptLlmBaseUrl,
                            setScrapePromptLlmApiKey
                          );
                        }}
                      >
                        <MenuItem value="ollama">Ollama (Local)</MenuItem>
                        <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
                        <MenuItem value="openai">OpenAI-compatible</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      sx={{ flex: 1 }}
                      value={scrapePromptLlmModel}
                      label="Model"
                      placeholder={getModelPlaceholder(scrapePromptLlmProvider, scrapePromptOpenAICompatiblePreset)}
                      onChange={(e) => setScrapePromptLlmModel(e.target.value)}
                      helperText={getModelHelperText(scrapePromptLlmProvider, scrapePromptOpenAICompatiblePreset)}
                      FormHelperTextProps={{ sx: { ml: 0.5, mb: 1 } }}
                    />
                  </Box>
                  {scrapePromptLlmProvider === 'openai' && (
                    <OpenAICompatiblePresetFields
                      presetId={scrapePromptOpenAICompatiblePreset}
                      onPresetChange={(presetId) => applyOpenAICompatiblePreset(
                        presetId,
                        setScrapePromptOpenAICompatiblePreset,
                        setScrapePromptLlmModel,
                        setScrapePromptLlmBaseUrl,
                        setScrapePromptLlmApiKey
                      )}
                      baseUrl={scrapePromptLlmBaseUrl}
                      onBaseUrlChange={setScrapePromptLlmBaseUrl}
                      apiKey={scrapePromptLlmApiKey}
                      onApiKeyChange={setScrapePromptLlmApiKey}
                      bottomMargin={2}
                    />
                  )}
                  {scrapePromptLlmProvider === 'anthropic' && (
                    <TextField
                      placeholder="Anthropic API key"
                      variant="outlined"
                      fullWidth
                      type="password"
                      value={scrapePromptLlmApiKey}
                      onChange={(e) => setScrapePromptLlmApiKey(e.target.value)}
                      label="API Key (Optional if set in .env)"
                      sx={{ mb: 2 }}
                    />
                  )}
                  {scrapePromptLlmProvider === 'ollama' && (
                    <TextField
                      placeholder="http://localhost:11434"
                      variant="outlined"
                      fullWidth
                      value={scrapePromptLlmBaseUrl}
                      onChange={(e) => setScrapePromptLlmBaseUrl(e.target.value)}
                      label="Ollama Base URL"
                      sx={{ mb: 2 }}
                    />
                  )}
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
                  const normalizedUrl = normalizeUrl(url);
                  setUrl(normalizedUrl);
                  setIsLoading(true);
                  try {
                    const hasPrompt = !!scrapePromptInstructions.trim();
                    const result = await createScrapeRobot(
                      normalizedUrl,
                      scrapeRobotName,
                      outputFormats,
                      hasPrompt ? scrapePromptInstructions : undefined,
                      hasPrompt ? scrapePromptLlmProvider : undefined,
                      hasPrompt ? scrapePromptLlmModel.trim() || undefined : undefined,
                      hasPrompt && scrapePromptLlmProvider !== 'ollama' ? scrapePromptLlmApiKey || undefined : undefined,
                      hasPrompt && scrapePromptLlmProvider !== 'anthropic' ? scrapePromptLlmBaseUrl || undefined : undefined,
                    );
                    setIsLoading(false);
                    if (result) {
                      setRerenderRobots(true);
                      notify('success', `${scrapeRobotName} created successfully!`);
                      navigate('/robots');
                    } else {
                      notify('error', 'Failed to create scrape robot');
                    }
                  } catch (error: any) {
                    setIsLoading(false);
                    notify('error', error.message || 'Failed to create scrape robot');
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
                  label="Name"
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
                  onBlur={() => setCrawlUrl(normalizeUrl(crawlUrl))}
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
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id="crawl-output-formats-label">Output Formats *</InputLabel>
                    <Select
                      labelId="crawl-output-formats-label"
                      multiple
                      value={crawlOutputFormats}
                      label="Output Formats *"
                      onChange={(e) => {
                        const value = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                        setCrawlOutputFormats(value as OutputFormats[]);
                      }}
                      renderValue={(selected) => {
                        const labels = selected.map(v => OUTPUT_FORMAT_LABELS[v] ?? v);
                        return labels.length > 2 ? `${labels.slice(0, 2).join(', ')}…` : labels.join(', ');
                      }}
                    >
                      {OUTPUT_FORMAT_OPTIONS.map((format) => (
                        <MenuItem key={format} value={format}>
                          <Checkbox checked={crawlOutputFormats.includes(format)} />
                          {OUTPUT_FORMAT_LABELS[format]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

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
                disabled={!crawlUrl.trim() || !crawlRobotName.trim() || crawlOutputFormats.length === 0 || isLoading}
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
                  label="Name"
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
                      onChange={(e) => {
                        const newMode = e.target.value as 'discover' | 'scrape';
                        setSearchMode(newMode);
                        if (newMode === 'discover') {
                          setSearchOutputFormats([]);
                        } else if (searchOutputFormats.length === 0) {
                          setSearchOutputFormats(DEFAULT_OUTPUT_FORMATS);
                        }
                      }}
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

                {searchMode === 'scrape' ? (
                  <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-start', mb: 2 }}>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel id="search-output-formats-label">Output Formats *</InputLabel>
                      <Select
                        labelId="search-output-formats-label"
                        multiple
                        value={searchOutputFormats}
                        label="Output Formats *"
                        onChange={(e) => {
                          const value = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                          setSearchOutputFormats(value as OutputFormats[]);
                        }}
                        renderValue={(selected) => {
                          const labels = selected.map(v => OUTPUT_FORMAT_LABELS[v] ?? v);
                          return labels.length > 2 ? `${labels.slice(0, 2).join(', ')}…` : labels.join(', ');
                        }}
                      >
                        {OUTPUT_FORMAT_OPTIONS.map((format) => (
                          <MenuItem key={format} value={format}>
                            <Checkbox checked={searchOutputFormats.includes(format)} />
                            {OUTPUT_FORMAT_LABELS[format]}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                ) : (
                  <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-start', mb: 2, alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      Output formats are only available in "Extract Data from Results" mode
                    </Typography>
                  </Box>
                )}
              </Box>

              <Button
                variant="contained"
                fullWidth
                onClick={handleCreateSearchRobot}
                disabled={!searchQuery.trim() || !searchRobotName.trim() || (searchMode === 'scrape' && searchOutputFormats.length === 0) || isLoading}
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
        {/* Document Robot Tab */}
        <TabPanel value={tabValue} index={4}>
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
                Process PDFs with AI — extract structured fields or convert to Markdown, HTML, and links.
              </Typography>

              <Box sx={{ width: '100%', maxWidth: 700 }}>
                <Typography variant="subtitle1" gutterBottom sx={{ mb: 2 }} color="text.secondary">
                  Choose Mode
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                  <Card
                    onClick={() => setDocumentMode('extract')}
                    sx={{
                      flex: 1,
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: documentMode === 'extract' ? '#ff00c3' : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': { borderColor: '#ff00c3' },
                    }}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                      <AutoAwesome sx={{ fontSize: 26, mb: 0.5 }} />
                      <Typography variant="h6" gutterBottom>Extract</Typography>
                      <Typography variant="body2">
                        Pull structured data fields from a document using AI.
                      </Typography>
                    </CardContent>
                  </Card>

                  <Card
                    onClick={() => setDocumentMode('parse')}
                    sx={{
                      flex: 1,
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: documentMode === 'parse' ? '#ff00c3' : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': { borderColor: '#ff00c3' },
                    }}
                  >
                    <CardContent sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                      <Article sx={{ fontSize: 26, mb: 0.5 }} />
                      <Typography variant="h6" gutterBottom>Parse</Typography>
                      <Typography variant="body2">
                        Convert a document to Markdown, HTML, and links.
                      </Typography>
                    </CardContent>
                  </Card>
                </Box>

                <TextField
                  label="Robot Name"
                  fullWidth
                  value={documentRobotName}
                  onChange={(e) => setDocumentRobotName(e.target.value)}
                  sx={{ mb: 3 }}
                />

                <Box
                  sx={{
                    border: '2px dashed',
                    borderColor: documentFile ? '#ff00c3' : 'divider',
                    borderRadius: 2,
                    p: 3,
                    mb: 3,
                    textAlign: 'center',
                    cursor: 'pointer',
                    '&:hover': { borderColor: '#ff00c3' },
                  }}
                  onClick={() => document.getElementById('doc-upload-input')?.click()}
                >
                  <input
                    id="doc-upload-input"
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
                  />
                  {documentFile ? (
                    <Typography variant="body1" color="#ff00c3" fontWeight={500}>
                      📄 {documentFile.name}
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="body1" fontWeight={500}>Click to upload a PDF</Typography>
                      <Typography variant="body2" color="text.secondary">Max file size: 10 MB</Typography>
                    </>
                  )}
                </Box>

                {documentMode === 'extract' && (
                  <>
                    <TextField
                      label="Extraction Prompt"
                      fullWidth
                      multiline
                      rows={3}
                      value={documentPrompt}
                      onChange={(e) => setDocumentPrompt(e.target.value)}
                      placeholder='e.g. "Extract invoice number, vendor name, total amount, and line items"'
                      sx={{ mb: 3 }}
                    />

                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>LLM Provider</InputLabel>
                      <Select
                        value={documentLlmProvider}
                        label="LLM Provider"
                        onChange={(e) => {
                          applyLlmProvider(
                            e.target.value as LlmProvider,
                            documentOpenAICompatiblePreset,
                            setDocumentLlmProvider,
                            setDocumentLlmModel,
                            setDocumentLlmBaseUrl,
                            setDocumentLlmApiKey
                          );
                        }}
                      >
                        <MenuItem value="ollama">Ollama (Local)</MenuItem>
                        <MenuItem value="openai">OpenAI-compatible</MenuItem>
                        <MenuItem value="anthropic">Anthropic</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      label="Model"
                      placeholder={getModelPlaceholder(documentLlmProvider, documentOpenAICompatiblePreset, DOCUMENT_MODEL_FIELD_TEXT)}
                      helperText={getModelHelperText(documentLlmProvider, documentOpenAICompatiblePreset, DOCUMENT_MODEL_FIELD_TEXT)}
                      fullWidth
                      value={documentLlmModel}
                      onChange={(e) => setDocumentLlmModel(e.target.value)}
                      sx={{ mb: 2 }}
                      FormHelperTextProps={{ sx: { ml: 0.5 } }}
                    />

                    {documentLlmProvider === 'openai' && (
                      <OpenAICompatiblePresetFields
                        presetId={documentOpenAICompatiblePreset}
                      onPresetChange={(presetId) => applyOpenAICompatiblePreset(
                        presetId,
                        setDocumentOpenAICompatiblePreset,
                        setDocumentLlmModel,
                        setDocumentLlmBaseUrl,
                        setDocumentLlmApiKey
                      )}
                        baseUrl={documentLlmBaseUrl}
                        onBaseUrlChange={setDocumentLlmBaseUrl}
                        apiKey={documentLlmApiKey}
                        onApiKeyChange={setDocumentLlmApiKey}
                      />
                    )}

                    {documentLlmProvider === 'anthropic' && (
                      <TextField
                        label="API Key"
                        placeholder="Anthropic API key"
                        fullWidth
                        type="password"
                        value={documentLlmApiKey}
                        onChange={(e) => setDocumentLlmApiKey(e.target.value)}
                        sx={{ mb: 2 }}
                      />
                    )}

                    {documentLlmProvider === 'ollama' && (
                      <TextField
                        label="Ollama Base URL"
                        fullWidth
                        value={documentLlmBaseUrl}
                        onChange={(e) => setDocumentLlmBaseUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        sx={{ mb: 3 }}
                      />
                    )}
                  </>
                )}

                {documentMode === 'parse' && (
                  <FormControl fullWidth sx={{ mb: 3 }}>
                    <InputLabel id="doc-parse-formats-label">Output Formats</InputLabel>
                    <Select
                      labelId="doc-parse-formats-label"
                      multiple
                      value={documentParseFormats}
                      label="Output Formats"
                      onChange={(e) => {
                        const value = (typeof e.target.value === 'string'
                          ? e.target.value.split(',')
                          : e.target.value) as OutputFormats[];
                        setDocumentParseFormats(value);
                      }}
                      renderValue={(selected) =>
                        (selected as OutputFormats[]).length === 0
                          ? <span style={{ color: '#999' }}>Select formats</span>
                          : (selected as OutputFormats[]).map((v) => OUTPUT_FORMAT_LABELS[v] ?? v).join(', ')
                      }
                      MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}
                    >
                      {DOC_PARSE_FORMAT_OPTIONS.map((format) => (
                        <MenuItem key={format} value={format}>
                          <Checkbox checked={documentParseFormats.includes(format)} />
                          {OUTPUT_FORMAT_LABELS[format]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Button
                  variant="contained"
                  fullWidth
                  onClick={documentMode === 'extract' ? handleCreateDocumentRobot : handleCreateDocumentParseRobot}
                  disabled={
                    !documentFile ||
                    !documentRobotName.trim() ||
                    (documentMode === 'extract' && !documentPrompt.trim()) ||
                    (documentMode === 'parse' && documentParseFormats.length === 0) ||
                    isLoading
                  }
                  sx={{
                    bgcolor: '#ff00c3',
                    py: 1.4,
                    fontSize: '1rem',
                    textTransform: 'none',
                    borderRadius: 2,
                    '&:hover': { bgcolor: '#d400a6' },
                  }}
                  startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
                >
                  {isLoading ? 'Creating...' : 'Create Robot'}
                </Button>
              </Box>
            </Box>
          </Card>
        </TabPanel>
      </Box>

      <Dialog
        open={isWarningModalOpen}
        onClose={() => {
          setWarningModalOpen(false);
          setIsLoading(false);
        }}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            p: 0,
            borderRadius: 2
          }
        }}
      >
        <DialogTitle>
          {t('recordingtable.warning_modal.title')}
        </DialogTitle>

        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('recordingtable.warning_modal.message')}
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setWarningModalOpen(false);
              setIsLoading(false);
            }}
            color="inherit"
          >
            {t('recordingtable.warning_modal.cancel')}
          </Button>
          <Button
            onClick={handleDiscardAndCreate}
            variant="contained"
            color="error"
          >
            {t('recordingtable.warning_modal.discard_and_create')}
          </Button>
        </DialogActions>
      </Dialog>

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
