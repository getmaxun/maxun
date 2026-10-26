import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Container,
  Tabs,
  Tab,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputBase,
  Link,
} from '@mui/material';
import { ArrowBack, AutoAwesome, HighlightAlt, Language, Search as SearchIcon } from '@mui/icons-material';
import { useGlobalInfoStore, useCacheInvalidation } from '../../../context/globalInfo';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from '../../../api/recording';
import {
  createScrapeRobot, createLLMRobot, createAndRunRecording, updateRecording,
  createCrawlRobot, createSearchRobot, createDocumentExtractRobot, createDocumentParseRobot
} from "../../../api/storage";
import { DEFAULT_OUTPUT_FORMATS, DOC_PARSE_FORMAT_OPTIONS, OUTPUT_FORMAT_OPTIONS, OutputFormats } from '../../../constants/outputFormats';
import { AgentRobotPanel, AgentCreationState } from './AgentRobotPanel';
import {
  ChoiceToggle,
  CreatePanel,
  FileDropZone,
  HintLine,
  InlineNumber,
  InlineSelect,
  MONITORING_DESCRIPTION,
  MONITORING_DOCS,
  OptionField,
  OptionRow,
  OptionsSection,
  OutputFormatsSelect,
  PanelHeading,
  PrimaryAction,
  RequestBox,
  RequestInput,
  RobotNameField,
} from './createRobotUI';

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
  if (provider === 'anthropic') return options.anthropicHelperText || "Use an Anthropic model, or leave blank to use Maxun's default.";
  return getOpenAICompatiblePreset(presetId).modelHelperText;
};

const DOCUMENT_MODEL_FIELD_TEXT: ModelFieldTextOptions = {
  ollamaPlaceholder: 'e.g. llama3.2:latest',
  ollamaHelperText: 'Leave blank to use default: llama3.2:latest',
  anthropicPlaceholder: 'e.g. claude-sonnet-5',
};


/** One LLM configuration: provider, OpenAI-compatible preset, model, API key and base URL. */
const useLlmConfig = () => {
  const [provider, setProviderState] = useState<LlmProvider>('ollama');
  const [presetId, setPresetIdState] = useState<OpenAICompatiblePresetId>(DEFAULT_OPENAI_COMPATIBLE_PRESET_ID);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  // Switching provider or preset clears the fields that belonged to the previous one.
  const setProvider = (next: LlmProvider) => {
    setProviderState(next);
    setModel('');
    setBaseUrl(next === 'openai' ? getOpenAICompatiblePreset(presetId).baseUrl : '');
    setApiKey('');
  };

  const setPresetId = (next: OpenAICompatiblePresetId) => {
    setPresetIdState(next);
    setModel('');
    setBaseUrl(getOpenAICompatiblePreset(next).baseUrl);
    setApiKey('');
  };

  return { provider, setProvider, presetId, setPresetId, model, setModel, apiKey, setApiKey, baseUrl, setBaseUrl };
};

type LlmConfig = ReturnType<typeof useLlmConfig>;

const SUMMARY_API_KEY_HELPER = 'Required for summary output. Alternatively, set ANTHROPIC_API_KEY in your server .env.';
const OLLAMA_BASE_URL_HELPER = 'Defaults to http://localhost:11434. Use http://host.docker.internal:11434 if running via Docker';

const smallFieldProps = {
  size: 'small' as const,
  fullWidth: true,
  InputLabelProps: { shrink: true },
  FormHelperTextProps: { sx: { ml: 0 } },
};

interface LlmSettingsProps {
  config: LlmConfig;
  providerLabel?: string;
  modelText?: ModelFieldTextOptions;
  anthropicApiKeyLabel?: string;
  anthropicApiKeyHelperText?: string;
}

/** Provider, model and connection fields for one LLM configuration, laid out for an Options section. */
const LlmSettings: React.FC<LlmSettingsProps> = ({
  config,
  providerLabel = 'LLM provider',
  modelText,
  anthropicApiKeyLabel = 'API key',
  anthropicApiKeyHelperText,
}) => {
  const preset = getOpenAICompatiblePreset(config.presetId);

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
        <OptionField>
          <TextField
            select
            label={providerLabel}
            value={config.provider}
            onChange={(e) => config.setProvider(e.target.value as LlmProvider)}
            {...smallFieldProps}
          >
            <MenuItem value="ollama">Ollama (Local)</MenuItem>
            <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
            <MenuItem value="openai">OpenAI-compatible</MenuItem>
          </TextField>
        </OptionField>
        <OptionField>
          <TextField
            label="Model"
            value={config.model}
            placeholder={getModelPlaceholder(config.provider, config.presetId, modelText)}
            helperText={getModelHelperText(config.provider, config.presetId, modelText)}
            onChange={(e) => config.setModel(e.target.value)}
            {...smallFieldProps}
          />
        </OptionField>
      </Box>

      {config.provider === 'openai' && (
        <>
          <OptionField>
            <TextField
              select
              label="OpenAI-compatible preset"
              value={config.presetId}
              onChange={(e) => config.setPresetId(e.target.value as OpenAICompatiblePresetId)}
              {...smallFieldProps}
            >
              {OPENAI_COMPATIBLE_PRESET_IDS.map((id) => (
                <MenuItem key={id} value={id}>
                  {OPENAI_COMPATIBLE_PRESETS[id].label}
                </MenuItem>
              ))}
            </TextField>
          </OptionField>
          <OptionField>
            <TextField
              label="Base URL"
              placeholder={preset.baseUrlPlaceholder}
              value={config.baseUrl}
              onChange={(e) => config.setBaseUrl(e.target.value)}
              helperText={preset.baseUrlHelperText}
              {...smallFieldProps}
            />
          </OptionField>
          <OptionField>
            <TextField
              label="API key"
              type="password"
              placeholder={preset.apiKeyPlaceholder}
              value={config.apiKey}
              onChange={(e) => config.setApiKey(e.target.value)}
              helperText={preset.apiKeyHelperText}
              {...smallFieldProps}
            />
          </OptionField>
        </>
      )}

      {config.provider === 'anthropic' && (
        <OptionField>
          <TextField
            label={anthropicApiKeyLabel}
            type="password"
            placeholder="Anthropic API key"
            value={config.apiKey}
            onChange={(e) => config.setApiKey(e.target.value)}
            helperText={anthropicApiKeyHelperText}
            {...smallFieldProps}
          />
        </OptionField>
      )}

      {config.provider === 'ollama' && (
        <OptionField>
          <TextField
            label="Ollama base URL (optional)"
            placeholder={OLLAMA_DEFAULT_BASE_URL}
            value={config.baseUrl}
            onChange={(e) => config.setBaseUrl(e.target.value)}
            helperText={OLLAMA_BASE_URL_HELPER}
            {...smallFieldProps}
          />
        </OptionField>
      )}
    </Box>
  );
};

const INVALID_URL_MESSAGE = 'Please enter a valid URL (e.g. https://example.com)';

const RobotCreate: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setBrowserId, setRecordingUrl, notify, setRerenderRobots, recordings } = useGlobalInfoStore();

  const [tabValue, setTabValue] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isWarningModalOpen, setWarningModalOpen] = useState(false);
  const [activeBrowserId, setActiveBrowserId] = useState('');
  const [needsLogin] = useState(false);
  const [generationMode, setGenerationMode] = useState<'agent' | 'recorder'>('recorder');

  // Each tab keeps its own website field, so typing in one tab (or picking an
  // agent example) never fills another.
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [extractCompareRuns, setExtractCompareRuns] = useState(false);

  const [aiPrompt, setAiPrompt] = useState('');
  const [agentUrl, setAgentUrl] = useState('');
  const [agentUrlError, setAgentUrlError] = useState('');
  const [extractRobotName, setExtractRobotName] = useState('');
  const [agentCompareRuns, setAgentCompareRuns] = useState(false);
  const agentLlm = useLlmConfig();
  /** Progress of an agent robot being built; null shows the request form. */
  const [agentCreation, setAgentCreation] = useState<AgentCreationState | null>(null);
  /** Whether this page is still open, so a finished build doesn't pull the user back from elsewhere. */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeUrlError, setScrapeUrlError] = useState('');
  const [scrapeRobotName, setScrapeRobotName] = useState('');
  const [outputFormats, setOutputFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);
  const [scrapePromptInstructions, setScrapePromptInstructions] = useState('');
  const [scrapeCompareRuns, setScrapeCompareRuns] = useState(false);
  const scrapePromptLlm = useLlmConfig();

  const [crawlRobotName, setCrawlRobotName] = useState('');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlUrlError, setCrawlUrlError] = useState('');
  const [crawlMode, setCrawlMode] = useState<'domain' | 'subdomain' | 'path'>('domain');
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(3);
  const [crawlIncludePaths, setCrawlIncludePaths] = useState<string>('');
  const [crawlExcludePaths, setCrawlExcludePaths] = useState<string>('');
  const [crawlUseSitemap, setCrawlUseSitemap] = useState(true);
  const [crawlFollowLinks, setCrawlFollowLinks] = useState(true);
  const [crawlRespectRobots, setCrawlRespectRobots] = useState(true);
  const [crawlOutputFormats, setCrawlOutputFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);
  const crawlSummaryLlm = useLlmConfig();

  const [searchRobotName, setSearchRobotName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLimit, setSearchLimit] = useState(10);
  const [searchProvider] = useState<'duckduckgo'>('duckduckgo');
  const [searchMode, setSearchMode] = useState<'discover' | 'scrape'>('discover');
  const [searchTimeRange, setSearchTimeRange] = useState<'day' | 'week' | 'month' | 'year' | ''>('');
  const [searchOutputFormats, setSearchOutputFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);
  const searchSummaryLlm = useLlmConfig();

  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState('');
  const [documentRobotName, setDocumentRobotName] = useState('');
  const [documentMode, setDocumentMode] = useState<'extract' | 'parse'>('extract');
  const [documentParseFormats, setDocumentParseFormats] = useState<OutputFormats[]>(DEFAULT_OUTPUT_FORMATS);
  const documentLlm = useLlmConfig();
  const docParseSummaryLlm = useLlmConfig();

  const { addOptimisticRobot, removeOptimisticRobot, invalidateRecordings, invalidateRuns, updateOptimisticRun } = useCacheInvalidation();

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const normalizeUrl = (rawUrl: string): string => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*\/\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const isValidUrl = (rawUrl: string): boolean => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (!parsed.hostname) return false;
      const isPlausibleHost = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(parsed.hostname)
        || parsed.hostname === 'localhost'
        || /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)
        || /^\[[0-9a-f:]+\]$/i.test(parsed.hostname);
      return isPlausibleHost;
    } catch {
      return false;
    }
  };

  /** Normalizes a website field when it loses focus and shows an inline error for an invalid address. */
  const urlBlurHandler = (value: string, setValue: (value: string) => void, setError: (error: string) => void) => () => {
    if (!value) { setError(''); return; }
    const normalized = normalizeUrl(value);
    setValue(normalized);
    setError(isValidUrl(normalized) ? '' : INVALID_URL_MESSAGE);
  };

  /** Turns on monitoring for a robot that was just created; robots can only get it through an update. */
  const enableMonitoring = async (robotId: string, robotName: string) => {
    try {
      const updated = await updateRecording(robotId, { compareRuns: true });
      if (!updated) throw new Error('update failed');
    } catch {
      notify('warning', `${robotName} was created, but monitoring couldn't be turned on. You can turn it on in the robot's settings.`);
    }
  };

  const agentNameTaken = !!extractRobotName.trim() &&
    recordings.some((r) => r.trim().toLowerCase() === extractRobotName.trim().toLowerCase());

  const handleStartRecording = async () => {
    if (!url.trim()) {
      setUrlError(INVALID_URL_MESSAGE);
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    setUrl(normalizedUrl);

    if (!isValidUrl(normalizedUrl)) {
      setUrlError(INVALID_URL_MESSAGE);
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
      setRecordingUrl(normalizedUrl);

      window.sessionStorage.setItem('browserId', 'new-recording');
      window.sessionStorage.setItem('recordingUrl', normalizedUrl);
      window.sessionStorage.setItem('initialUrl', normalizedUrl);
      window.sessionStorage.setItem('needsLogin', needsLogin.toString());
      window.sessionStorage.setItem('compareRuns', extractCompareRuns.toString());

      const sessionId = Date.now().toString();
      window.sessionStorage.setItem('recordingSessionId', sessionId);
      window.sessionStorage.setItem('recordingOriginPage', window.location.pathname + window.location.search);

      window.open(`/recording-setup?session=${sessionId}`, '_blank');
      window.sessionStorage.setItem('nextTabIsRecording', 'true');

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

    setBrowserId('new-recording');
    setRecordingUrl(url);

    window.sessionStorage.setItem('browserId', 'new-recording');
    window.sessionStorage.setItem('recordingUrl', url);
    window.sessionStorage.setItem('initialUrl', url);
    window.sessionStorage.setItem('needsLogin', needsLogin.toString());
    window.sessionStorage.setItem('compareRuns', extractCompareRuns.toString());

    const sessionId = Date.now().toString();
    window.sessionStorage.setItem('recordingSessionId', sessionId);
    window.sessionStorage.setItem('recordingOriginPage', window.location.pathname + window.location.search);

    window.open(`/recording-setup?session=${sessionId}`, '_blank');
    window.sessionStorage.setItem('nextTabIsRecording', 'true');

    navigate('/robots');
  };

  /**
   * Builds an AI mode robot, then runs it once and opens the run. Progress is
   * shown in place; if the user leaves the page, the build keeps going and
   * they get a notification instead of being navigated back.
   */
  const handleCreateAgentRobot = async () => {
    const prompt = aiPrompt.trim();
    const robotName = extractRobotName.trim();

    if (!robotName) {
      notify('error', 'Please enter a robot name');
      return;
    }
    if (!prompt) {
      notify('error', 'Please describe what the agent should collect');
      return;
    }
    if (agentNameTaken) {
      notify('error', `A robot with the name "${robotName}" already exists.`);
      return;
    }

    // AI Extract reads only this page, so it is required.
    if (!agentUrl.trim()) {
      setAgentUrlError('Enter the website to extract from (e.g. https://example.com)');
      return;
    }
    const targetUrl = normalizeUrl(agentUrl);
    setAgentUrl(targetUrl);
    if (!isValidUrl(targetUrl)) {
      setAgentUrlError(INVALID_URL_MESSAGE);
      return;
    }

    const startedAt = Date.now();
    const baseState = { startedAt, robotName, prompt, url: targetUrl };
    setAgentCreation({ ...baseState, phase: 'building' });

    // Keep the robot visible in the list while it builds, in case the user goes there.
    const tempRobotId = `temp-${startedAt}`;
    addOptimisticRobot({
      id: tempRobotId,
      recording_meta: {
        id: tempRobotId,
        name: robotName,
        createdAt: new Date(startedAt).toISOString(),
        updatedAt: new Date(startedAt).toISOString(),
        pairs: 0,
        params: [],
        type: 'extract',
        url: targetUrl,
      },
      recording: { workflow: [] },
      isLoading: true,
      isOptimistic: true,
    });

    const fail = (error: string, robotCreated = false) => {
      if (isMountedRef.current) {
        setAgentCreation({ ...baseState, phase: 'failed', error, robotCreated });
      } else {
        notify(
          robotCreated ? 'warning' : 'error',
          robotCreated ? `${robotName} was created, but its first run didn't start.` : `Couldn't build ${robotName}: ${error}`
        );
      }
    };

    try {
      const result = await createLLMRobot(
        targetUrl,
        prompt,
        agentLlm.provider,
        agentLlm.model.trim() || undefined,
        agentLlm.apiKey || undefined,
        agentLlm.baseUrl || undefined,
        robotName
      );

      removeOptimisticRobot(tempRobotId);
      invalidateRecordings();

      if (!result || !result.robot) {
        fail('Could not create this robot. Please check your LLM configuration, or try describing the data as it appears on the page.');
        return;
      }

      const robotMetaId = result.robot.recording_meta.id;
      const createdName = result.robot.recording_meta.name;

      if (agentCompareRuns) await enableMonitoring(robotMetaId, createdName);

      if (isMountedRef.current) {
        setAgentCreation({ ...baseState, robotName: createdName, phase: 'running' });
      }

      updateOptimisticRun({
        id: robotMetaId,
        runId: `temp-${Date.now()}`,
        status: 'running',
        name: createdName,
        startedAt: new Date().toISOString(),
        finishedAt: '',
        robotMetaId,
        log: 'Starting...',
        isOptimistic: true,
      });

      const runResponse = await createAndRunRecording(robotMetaId, {
        maxConcurrency: 1,
        maxRepeats: 1,
        debug: false,
      });

      invalidateRuns();

      if (!runResponse || !runResponse.runId) {
        fail("The robot's first run didn't start.", true);
        return;
      }

      if (isMountedRef.current) {
        setAgentCreation({ ...baseState, robotName: createdName, phase: 'opening' });
        navigate(`/runs/${robotMetaId}/run/${runResponse.runId}`);
      } else {
        notify('success', `${createdName} is ready. Its first run has started.`);
      }
    } catch (error: any) {
      console.error('Error in AI robot creation:', error);
      removeOptimisticRobot(tempRobotId);
      invalidateRecordings();
      fail(error?.message || 'Failed to create the robot.');
    }
  };

  const handleCreateScrapeRobot = async () => {
    if (!scrapeUrl.trim()) {
      setScrapeUrlError(INVALID_URL_MESSAGE);
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
    const normalizedUrl = normalizeUrl(scrapeUrl);
    setScrapeUrl(normalizedUrl);
    if (!isValidUrl(normalizedUrl)) {
      setScrapeUrlError(INVALID_URL_MESSAGE);
      return;
    }
    setIsLoading(true);
    try {
      const hasPrompt = !!scrapePromptInstructions.trim();
      const needsLlm = hasPrompt || outputFormats.includes('summary');
      const result = await createScrapeRobot(
        normalizedUrl,
        scrapeRobotName,
        outputFormats,
        hasPrompt ? scrapePromptInstructions : undefined,
        needsLlm ? scrapePromptLlm.provider : undefined,
        needsLlm ? scrapePromptLlm.model.trim() || undefined : undefined,
        needsLlm && scrapePromptLlm.provider !== 'ollama' ? scrapePromptLlm.apiKey || undefined : undefined,
        needsLlm && scrapePromptLlm.provider !== 'anthropic' ? scrapePromptLlm.baseUrl || undefined : undefined,
      );
      if (result && scrapeCompareRuns && result.robot?.recording_meta?.id) {
        await enableMonitoring(result.robot.recording_meta.id, scrapeRobotName);
      }
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
  };

  const handleCreateCrawlRobot = async () => {
    if (!crawlUrl.trim()) {
      setCrawlUrlError(INVALID_URL_MESSAGE);
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
    const wantsSummary = crawlOutputFormats.includes('summary' as OutputFormats);
    if (wantsSummary && crawlSummaryLlm.provider !== 'ollama' && !crawlSummaryLlm.apiKey.trim()) {
      notify('error', `An API key is required when using ${crawlSummaryLlm.provider === 'anthropic' ? 'Anthropic' : 'an OpenAI-compatible'} provider for summaries`);
      return;
    }

    const normalizedCrawlUrl = normalizeUrl(crawlUrl);
    setCrawlUrl(normalizedCrawlUrl);

    if (!isValidUrl(normalizedCrawlUrl)) {
      setCrawlUrlError(INVALID_URL_MESSAGE);
      return;
    }

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
        crawlOutputFormats,
        wantsSummary ? crawlSummaryLlm.provider : undefined,
        wantsSummary ? crawlSummaryLlm.model.trim() || undefined : undefined,
        wantsSummary && crawlSummaryLlm.provider !== 'ollama' ? crawlSummaryLlm.apiKey || undefined : undefined,
        wantsSummary ? crawlSummaryLlm.baseUrl.trim() || undefined : undefined
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
    const wantsSummary = searchMode === 'scrape' && searchOutputFormats.includes('summary' as OutputFormats);
    if (wantsSummary && searchSummaryLlm.provider !== 'ollama' && !searchSummaryLlm.apiKey.trim()) {
      notify('error', `An API key is required when using ${searchSummaryLlm.provider === 'anthropic' ? 'Anthropic' : 'an OpenAI-compatible'} provider for summaries`);
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
        formatsForRequest,
        wantsSummary ? searchSummaryLlm.provider : undefined,
        wantsSummary ? searchSummaryLlm.model.trim() || undefined : undefined,
        wantsSummary && searchSummaryLlm.provider !== 'ollama' ? searchSummaryLlm.apiKey || undefined : undefined,
        wantsSummary ? searchSummaryLlm.baseUrl.trim() || undefined : undefined
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

  const handleSearchModeChange = (newMode: 'discover' | 'scrape') => {
    setSearchMode(newMode);
    if (newMode === 'discover') {
      setSearchOutputFormats([]);
    } else if (searchOutputFormats.length === 0) {
      setSearchOutputFormats(DEFAULT_OUTPUT_FORMATS);
    }
  };

  const handleCreateDocumentRobot = async () => {
    if (!documentFile) { notify('error', 'Please upload a PDF, DOCX, XLSX, CSV, JPG, or PNG file'); return; }
    if (!documentPrompt.trim()) { notify('error', 'Please enter an extraction prompt'); return; }
    if (!documentRobotName.trim()) { notify('error', 'Please enter a robot name'); return; }

    setIsLoading(true);
    try {
      const result = await createDocumentExtractRobot(
        documentFile,
        documentPrompt.trim(),
        documentRobotName.trim(),
        documentLlm.provider,
        documentLlm.model || undefined,
        documentLlm.apiKey || undefined,
        documentLlm.baseUrl || undefined
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
    if (!documentFile) { notify('error', 'Please upload a PDF, DOCX, XLSX, CSV, JPG, or PNG file'); return; }
    if (!documentRobotName.trim()) { notify('error', 'Please enter a robot name'); return; }
    if (documentParseFormats.length === 0) { notify('error', 'Please select at least one output format'); return; }

    const wantsSummary = documentParseFormats.includes('summary' as OutputFormats);
    if (wantsSummary && docParseSummaryLlm.provider !== 'ollama' && !docParseSummaryLlm.apiKey.trim()) {
      notify('error', `An API key is required when using ${docParseSummaryLlm.provider === 'anthropic' ? 'Anthropic' : 'an OpenAI-compatible'} provider for summaries`);
      return;
    }

    setIsLoading(true);
    try {
      const result = await createDocumentParseRobot(
        documentFile,
        documentRobotName.trim(),
        documentParseFormats,
        wantsSummary ? docParseSummaryLlm.provider : undefined,
        wantsSummary ? docParseSummaryLlm.model.trim() || undefined : undefined,
        wantsSummary && docParseSummaryLlm.provider !== 'ollama' ? docParseSummaryLlm.apiKey || undefined : undefined,
        wantsSummary ? docParseSummaryLlm.baseUrl.trim() || undefined : undefined
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

  const extractModeToggle = (
    <ChoiceToggle
      ariaLabel="How to build the robot"
      value={generationMode}
      onChange={setGenerationMode}
      options={[
        { value: 'recorder', label: 'Recorder Mode', description: 'Record your actions on websites into workflows.', icon: <HighlightAlt sx={{ fontSize: 17 }} /> },
        { value: 'agent', label: 'AI Mode (Beta)', description: 'Describe the task to extract data from websites.', icon: <AutoAwesome sx={{ fontSize: 17 }} /> },
      ]}
    />
  );

  const crawlWantsSummary = crawlOutputFormats.includes('summary' as OutputFormats);
  const searchWantsSummary = searchMode === 'scrape' && searchOutputFormats.includes('summary' as OutputFormats);
  const docParseWantsSummary = documentParseFormats.includes('summary' as OutputFormats);

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
            aria-label="Go back"
          >
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="h1">
            Create New Robot
          </Typography>
        </Box>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, mt: "-20px" }}>
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
                color: theme => `${theme.palette.mode === 'dark' ? '#fff' : '#000'} !important`,
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
          {generationMode === 'agent' ? (
            <AgentRobotPanel
              name={extractRobotName}
              onNameChange={setExtractRobotName}
              nameError={agentNameTaken ? 'A robot with this name already exists.' : undefined}
              prompt={aiPrompt}
              onPromptChange={setAiPrompt}
              url={agentUrl}
              onUrlChange={(value) => {
                setAgentUrl(value);
                setAgentUrlError('');
              }}
              onUrlBlur={urlBlurHandler(agentUrl, setAgentUrl, setAgentUrlError)}
              urlError={agentUrlError}
              modeToggle={extractModeToggle}
              monitoring={agentCompareRuns}
              onMonitoringChange={setAgentCompareRuns}
              llmSettings={<LlmSettings config={agentLlm} anthropicApiKeyLabel="API key (optional if set in .env)" />}
              creation={agentCreation}
              onSubmit={handleCreateAgentRobot}
              onEditRequest={() => setAgentCreation(null)}
              onRetry={handleCreateAgentRobot}
              onGoToRobots={() => navigate('/robots')}
            />
          ) : (
            <CreatePanel>
              <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (url.trim() && !isLoading) handleStartRecording(); }}>
                <PanelHeading
                  description="Extract structured data from any website by emulating real user behavior and recording browser actions."
                />
                {extractModeToggle}
                <RequestBox
                  invalid={!!urlError}
                  footer={<Typography sx={{ fontSize: 13, color: 'text.secondary', pl: 0.5 }}>Paste the full website address</Typography>}
                  action={
                    <PrimaryAction type="submit" loading={isLoading} loadingLabel="Starting..." disabled={!url.trim()}>
                      Start recording
                    </PrimaryAction>
                  }
                >
                  <RequestInput
                    value={url}
                    onChange={(value) => { setUrl(value); setUrlError(''); }}
                    onBlur={urlBlurHandler(url, setUrl, setUrlError)}
                    placeholder="https://www.ycombinator.com/companies"
                    icon={<Language />}
                    ariaLabel="Website address"
                    inputMode="url"
                    autoFocus
                  />
                </RequestBox>
                <HintLine tone={urlError ? 'error' : 'muted'} sx={{ mt: 1.5 }}>
                  {urlError || ''}
                </HintLine>

                <OptionsSection defaultOpen={extractCompareRuns}>
                  <OptionRow
                    title="Monitoring"
                    description={MONITORING_DESCRIPTION}
                    href={MONITORING_DOCS}
                    checked={extractCompareRuns}
                    onChange={setExtractCompareRuns}
                  />
                </OptionsSection>
              </Box>
            </CreatePanel>
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <CreatePanel>
            <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (scrapeUrl.trim() && scrapeRobotName.trim() && outputFormats.length > 0 && !isLoading) handleCreateScrapeRobot(); }}>
              <PanelHeading
                description="Turn websites into markdown, html, screenshots, summaries and more."
              />
              <RequestBox
                invalid={!!scrapeUrlError}
                footer={<OutputFormatsSelect value={outputFormats} onChange={setOutputFormats} options={OUTPUT_FORMAT_OPTIONS} />}
                action={
                  <PrimaryAction type="submit" loading={isLoading} loadingLabel="Creating..." disabled={!scrapeUrl.trim() || !scrapeRobotName.trim() || outputFormats.length === 0}>
                    Create robot
                  </PrimaryAction>
                }
              >
                <RequestInput
                  value={scrapeUrl}
                  onChange={(value) => { setScrapeUrl(value); setScrapeUrlError(''); }}
                  onBlur={urlBlurHandler(scrapeUrl, setScrapeUrl, setScrapeUrlError)}
                  placeholder="https://www.ycombinator.com/companies"
                  icon={<Language />}
                  ariaLabel="Page address"
                  inputMode="url"
                  autoFocus
                />
              </RequestBox>
              <HintLine tone={scrapeUrlError ? 'error' : 'muted'} sx={{ mt: 1.5 }}>
                {scrapeUrlError || (outputFormats.length === 0 ? 'Choose at least one output format.' : '')}
              </HintLine>

              <Box sx={{ mt: 3 }}>
                <TextField
                  label="Smart query (optional)"
                  placeholder="Example: Navigate to the pricing page and list all plan names and prices."
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  value={scrapePromptInstructions}
                  onChange={(e) => setScrapePromptInstructions(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText={
                    <>
                      After scraping, Smart Queries analyze the page and return results based on your instructions.{' '}
                      <Link href="https://docs.maxun.dev/robot/scrape#smart-queries" target="_blank" rel="noopener noreferrer" underline="hover" sx={{ color: 'text.secondary', textDecorationColor: 'currentColor' }}>
                        Learn more
                      </Link>
                    </>
                  }
                  FormHelperTextProps={{ sx: { ml: 0 } }}
                />
              </Box>

              <RobotNameField value={scrapeRobotName} onChange={setScrapeRobotName} placeholder="Example: YC Companies Scraper" />

              <OptionsSection defaultOpen={scrapeCompareRuns}>
                <OptionRow
                  title="Monitoring"
                  description={MONITORING_DESCRIPTION}
                  href={MONITORING_DOCS}
                  checked={scrapeCompareRuns}
                  onChange={setScrapeCompareRuns}
                />
              </OptionsSection>

              <OptionsSection label="Model settings">
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 2, mb: 2 }}>
                  Used for Smart Queries and summary output.
                </Typography>
                <LlmSettings config={scrapePromptLlm} anthropicApiKeyHelperText={SUMMARY_API_KEY_HELPER} />
              </OptionsSection>
            </Box>
          </CreatePanel>
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <CreatePanel>
            <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (crawlUrl.trim() && crawlRobotName.trim() && crawlOutputFormats.length > 0 && !isLoading) handleCreateCrawlRobot(); }}>
              <PanelHeading
                description="Crawl entire websites and gather data from multiple pages automatically."
              />
              <RequestBox
                invalid={!!crawlUrlError}
                footer={
                  <>
                    <InlineNumber before="Up to" after="pages" value={crawlLimit} onChange={setCrawlLimit} min={1} ariaLabel="Maximum pages to crawl" />
                    <OutputFormatsSelect value={crawlOutputFormats} onChange={setCrawlOutputFormats} options={OUTPUT_FORMAT_OPTIONS} />
                  </>
                }
                action={
                  <PrimaryAction type="submit" loading={isLoading} loadingLabel="Creating..." disabled={!crawlUrl.trim() || !crawlRobotName.trim() || crawlOutputFormats.length === 0}>
                    Create robot
                  </PrimaryAction>
                }
              >
                <RequestInput
                  value={crawlUrl}
                  onChange={(value) => { setCrawlUrl(value); setCrawlUrlError(''); }}
                  onBlur={urlBlurHandler(crawlUrl, setCrawlUrl, setCrawlUrlError)}
                  placeholder="https://www.ycombinator.com/companies"
                  icon={<Language />}
                  ariaLabel="Starting page address"
                  inputMode="url"
                  autoFocus
                />
              </RequestBox>
              <HintLine tone={crawlUrlError ? 'error' : 'muted'} sx={{ mt: 1.5 }}>
                {crawlUrlError || (crawlOutputFormats.length === 0 ? 'Choose at least one output format.' : '')}
              </HintLine>

              <RobotNameField value={crawlRobotName} onChange={setCrawlRobotName} placeholder="Example: YC Companies Crawler" />

              {crawlWantsSummary && (
                <OptionsSection label="Summary model settings" defaultOpen>
                  <Box sx={{ pt: 1 }}>
                    <LlmSettings config={crawlSummaryLlm} providerLabel="Summary LLM provider" anthropicApiKeyHelperText={SUMMARY_API_KEY_HELPER} />
                  </Box>
                </OptionsSection>
              )}

              <OptionsSection label="Crawl options">
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2, pt: 1 }}>
                  <OptionField>
                    <TextField
                      select
                      label="Scope"
                      value={crawlMode}
                      onChange={(e) => setCrawlMode(e.target.value as any)}
                      {...smallFieldProps}
                    >
                      <MenuItem value="domain">Same domain only</MenuItem>
                      <MenuItem value="subdomain">Include subdomains</MenuItem>
                      <MenuItem value="path">Specific path only</MenuItem>
                    </TextField>
                  </OptionField>
                  <OptionField>
                    <TextField
                      label="Link depth"
                      type="number"
                      value={crawlMaxDepth}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        setCrawlMaxDepth(isNaN(value) || value < 1 ? 1 : value);
                      }}
                      inputProps={{ min: 1 }}
                      helperText="How many links away from the start page"
                      {...smallFieldProps}
                    />
                  </OptionField>
                  <OptionField>
                    <TextField
                      label="Only these paths"
                      placeholder="/products, /blog"
                      value={crawlIncludePaths}
                      onChange={(e) => setCrawlIncludePaths(e.target.value)}
                      helperText="Comma-separated. Leave blank for all."
                      {...smallFieldProps}
                    />
                  </OptionField>
                  <OptionField>
                    <TextField
                      label="Skip these paths"
                      placeholder="/admin, /login"
                      value={crawlExcludePaths}
                      onChange={(e) => setCrawlExcludePaths(e.target.value)}
                      helperText="Comma-separated."
                      {...smallFieldProps}
                    />
                  </OptionField>
                </Box>
                <OptionRow title="Use the sitemap" description="Find pages listed in the site's sitemap.xml." checked={crawlUseSitemap} onChange={setCrawlUseSitemap} />
                <OptionRow title="Follow links" description="Discover more pages through the links on each page." checked={crawlFollowLinks} onChange={setCrawlFollowLinks} />
                <OptionRow title="Respect robots.txt" description="Skip pages the site asks crawlers not to visit." checked={crawlRespectRobots} onChange={setCrawlRespectRobots} />
              </OptionsSection>
            </Box>
          </CreatePanel>
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <CreatePanel>
            <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (searchQuery.trim() && searchRobotName.trim() && !(searchMode === 'scrape' && searchOutputFormats.length === 0) && !isLoading) handleCreateSearchRobot(); }}>
              <PanelHeading
                description="Search the web and gather data from relevant results."
              />
              <ChoiceToggle
                ariaLabel="What to collect"
                value={searchMode}
                onChange={handleSearchModeChange}
                options={[
                  { value: 'discover', label: 'Discover URLs Only', description: 'The title, link and snippet of each result.' },
                  { value: 'scrape', label: 'Extract Data From Results', description: 'Also opens each result and collects its content.' },
                ]}
              />
              <RequestBox
                footer={
                  <>
                    <InlineNumber before="No. of results" after="Time range" value={searchLimit} onChange={setSearchLimit} min={1} ariaLabel="Number of results" />
                    <InlineSelect
                      ariaLabel="Time range"
                      value={searchTimeRange}
                      onChange={setSearchTimeRange}
                      options={[
                        { value: '', label: 'All Time' },
                        { value: 'day', label: 'Past 24 Hours' },
                        { value: 'week', label: 'Past Week' },
                        { value: 'month', label: 'Past Month' },
                        { value: 'year', label: 'Past Year' },
                      ]}
                    />
                    {searchMode === 'scrape' && (
                      <OutputFormatsSelect value={searchOutputFormats} onChange={setSearchOutputFormats} options={OUTPUT_FORMAT_OPTIONS} />
                    )}
                  </>
                }
                action={
                  <PrimaryAction
                    type="submit"
                    loading={isLoading}
                    loadingLabel="Creating..."
                    disabled={!searchQuery.trim() || !searchRobotName.trim() || (searchMode === 'scrape' && searchOutputFormats.length === 0)}
                  >
                    Create robot
                  </PrimaryAction>
                }
              >
                <RequestInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="latest AI breakthroughs 2025"
                  icon={<SearchIcon />}
                  ariaLabel="Search query"
                  inputMode="search"
                  autoFocus
                />
              </RequestBox>
              <HintLine tone="muted" sx={{ mt: 1.5 }}>
                {searchMode === 'scrape' && searchOutputFormats.length === 0
                  ? 'Choose at least one output format.'
                  : ''}
              </HintLine>

              <RobotNameField value={searchRobotName} onChange={setSearchRobotName} placeholder="Example: AI News Monitor" />

              {searchWantsSummary && (
                <OptionsSection label="Summary model settings" defaultOpen>
                  <Box sx={{ pt: 1 }}>
                    <LlmSettings config={searchSummaryLlm} providerLabel="Summary LLM provider" anthropicApiKeyHelperText={SUMMARY_API_KEY_HELPER} />
                  </Box>
                </OptionsSection>
              )}
            </Box>
          </CreatePanel>
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <CreatePanel>
            <Box
              component="form"
              onSubmit={(e: React.FormEvent) => {
                e.preventDefault();
                if (!documentFile || !documentRobotName.trim() || isLoading) return;
                if (documentMode === 'extract' ? documentPrompt.trim() : documentParseFormats.length > 0) {
                  documentMode === 'extract' ? handleCreateDocumentRobot() : handleCreateDocumentParseRobot();
                }
              }}
            >
              <PanelHeading description="Extract and parse structured data from documents." />
              <ChoiceToggle
                ariaLabel="What to do with the document"
                value={documentMode}
                onChange={setDocumentMode}
                options={[
                  { value: 'extract', label: 'Extract', description: 'Extract structured data from docs with AI prompts.' },
                  { value: 'parse', label: 'Parse', description: 'Parse docs to Markdown, HTML, links & summaries.' },
                ]}
              />
              <RequestBox
                footer={
                  documentMode === 'parse' ? (
                    <OutputFormatsSelect value={documentParseFormats} onChange={setDocumentParseFormats} options={DOC_PARSE_FORMAT_OPTIONS} />
                  ) : undefined
                }
                action={
                  <PrimaryAction
                    type="submit"
                    loading={isLoading}
                    loadingLabel="Creating..."
                    disabled={
                      !documentFile ||
                      !documentRobotName.trim() ||
                      (documentMode === 'extract' && !documentPrompt.trim()) ||
                      (documentMode === 'parse' && documentParseFormats.length === 0)
                    }
                  >
                    Create robot
                  </PrimaryAction>
                }
              >
                <FileDropZone
                  file={documentFile}
                  onFile={setDocumentFile}
                  accept=".pdf,.docx,.csv,.xlsx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png"
                  description="PDF, DOCX, XLSX, CSV, JPG or PNG, up to 10 MB"
                />
                {documentMode === 'extract' && (
                  <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                    <InputBase
                      value={documentPrompt}
                      onChange={(e) => setDocumentPrompt(e.target.value)}
                      placeholder="What should be extracted? For example: invoice number, vendor name, total amount and line items"
                      multiline
                      minRows={3}
                      maxRows={10}
                      fullWidth
                      inputProps={{ 'aria-label': 'What to extract' }}
                      sx={{ px: 2.25, pt: 1.75, pb: 1.5, fontSize: 16, lineHeight: 1.5, alignItems: 'flex-start' }}
                    />
                  </Box>
                )}
              </RequestBox>
              <HintLine tone="muted" sx={{ mt: 1.5 }}>
                {documentMode === 'parse' && documentParseFormats.length === 0
                  ? 'Choose at least one output format.'
                  : ''}
              </HintLine>

              <RobotNameField value={documentRobotName} onChange={setDocumentRobotName} placeholder="Example: Invoice Extractor" />

              {documentMode === 'extract' && (
                <OptionsSection label="Model settings">
                  <Box sx={{ pt: 1 }}>
                    <LlmSettings config={documentLlm} modelText={DOCUMENT_MODEL_FIELD_TEXT} />
                  </Box>
                </OptionsSection>
              )}

              {documentMode === 'parse' && docParseWantsSummary && (
                <OptionsSection label="Summary model settings" defaultOpen>
                  <Box sx={{ pt: 1 }}>
                    <LlmSettings config={docParseSummaryLlm} providerLabel="Summary LLM provider" anthropicApiKeyHelperText={SUMMARY_API_KEY_HELPER} />
                  </Box>
                </OptionsSection>
              )}
            </Box>
          </CreatePanel>
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
