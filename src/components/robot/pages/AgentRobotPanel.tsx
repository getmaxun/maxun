import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Fade, InputBase, Link, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Check, ErrorOutline, Language } from '@mui/icons-material';
import {
  BRAND,
  MONITORING_DESCRIPTION,
  MONITORING_DOCS,
  CreatePanel,
  HintLine,
  OptionRow,
  OptionsSection,
  PanelHeading,
  PrimaryAction,
  RequestBox,
  RobotNameField,
} from './createRobotUI';

/** The server rejects shorter requests; the hint asks for more detail before that happens. */
export const MIN_AGENT_PROMPT_LENGTH = 15;

export type AgentCreationPhase = 'building' | 'running' | 'opening' | 'failed';

export interface AgentCreationState {
  phase: AgentCreationPhase;
  startedAt: number;
  robotName: string;
  prompt: string;
  url?: string;
  error?: string;
  /** Set when the robot exists but its first run couldn't start. */
  robotCreated?: boolean;
}

interface AgentExample {
  label: string;
  prompt: string;
  url: string;
}

const hostnameOf = (url?: string): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

interface AgentRobotPanelProps {
  name: string;
  onNameChange: (value: string) => void;
  /** Shown under the name field, e.g. when the name is already taken. */
  nameError?: string;
  prompt: string;
  onPromptChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  onUrlBlur: () => void;
  urlError: string;
  /** Shown under the heading, e.g. a switch between recorder and AI mode. */
  modeToggle?: React.ReactNode;
  monitoring: boolean;
  onMonitoringChange: (enabled: boolean) => void;
  /** LLM provider and model fields, shown under Model settings. */
  llmSettings: React.ReactNode;
  creation: AgentCreationState | null;
  onSubmit: () => void;
  onEditRequest: () => void;
  onRetry: () => void;
  onGoToRobots: () => void;
}

export const AgentRobotPanel: React.FC<AgentRobotPanelProps> = (props) => {
  const { creation } = props;
  const showProgress = !!creation;

  return (
    <CreatePanel>
      <Fade in={!showProgress} timeout={180} unmountOnExit>
        <div>
          <AgentComposer {...props} />
        </div>
      </Fade>
      <Fade in={showProgress} timeout={180} unmountOnExit>
        <div>{creation && <AgentCreationProgress {...props} creation={creation} />}</div>
      </Fade>
    </CreatePanel>
  );
};

/* ------------------------------------------------------------------ */
/* Request form                                                        */
/* ------------------------------------------------------------------ */

const AgentComposer: React.FC<AgentRobotPanelProps> = ({
  name,
  onNameChange,
  nameError,
  prompt,
  onPromptChange,
  url,
  onUrlChange,
  onUrlBlur,
  urlError,
  modeToggle,
  monitoring,
  onMonitoringChange,
  llmSettings,
  onSubmit,
}) => {
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const trimmedPrompt = prompt.trim();
  const promptTooShort = trimmedPrompt.length > 0 && trimmedPrompt.length < MIN_AGENT_PROMPT_LENGTH;
  // AI Extract reads only the page the user enters, so the website is required.
  const urlMissing = !url.trim();
  const canSubmit = trimmedPrompt.length >= MIN_AGENT_PROMPT_LENGTH && !urlMissing && !!name.trim() && !nameError && !urlError;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  const applyExample = (example: AgentExample) => {
    onPromptChange(example.prompt);
    onUrlChange(example.url);
    requestAnimationFrame(() => promptRef.current?.focus());
  };

  return (
    <Box component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); if (canSubmit) onSubmit(); }}>
      <PanelHeading description="Describe what you need in natural language and extract it with AI." />
      {modeToggle}

      <RequestBox
        invalid={!!urlError}
        footer={
          <>
            <Language sx={{ fontSize: 18, color: urlError ? 'error.main' : 'text.secondary', ml: 0.5 }} aria-hidden />
            <InputBase
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              onBlur={onUrlBlur}
              onKeyDown={handleKeyDown}
              placeholder="Website URL, e.g. https://example.com/products"
              required
              inputProps={{ 'aria-label': 'Website URL', 'aria-required': true, 'aria-invalid': !!urlError, inputMode: 'url' }}
              sx={{ flex: 1, minWidth: 180, fontSize: 14 }}
            />
          </>
        }
        action={<PrimaryAction type="submit" disabled={!canSubmit}>Create and run</PrimaryAction>}
      >
        <InputBase
          inputRef={promptRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Example: Extract the top 10 company names and descriptions"
          multiline
          minRows={4}
          maxRows={12}
          fullWidth
          autoFocus
          inputProps={{ 'aria-label': 'What the agent should collect' }}
          sx={{ px: 2.25, pt: 2, pb: 1.5, fontSize: 17, lineHeight: 1.5, alignItems: 'flex-start' }}
        />
      </RequestBox>

      <HintLine tone={urlError ? 'error' : promptTooShort ? 'warning' : 'muted'} sx={{ mt: 1.5, mb: 2 }}>
        {urlError
          ? urlError
          : promptTooShort
            ? `Describe what to collect in a bit more detail (at least ${MIN_AGENT_PROMPT_LENGTH} characters).`
            : urlMissing && trimmedPrompt
              ? 'Add the website to extract from. AI Extract only reads that page.'
              : ''}
      </HintLine>

      <RobotNameField value={name} onChange={onNameChange} error={nameError} placeholder="Example: YC Companies" />

      <OptionsSection defaultOpen={monitoring}>
        <OptionRow
          title="Monitoring"
          description={MONITORING_DESCRIPTION}
          href={MONITORING_DOCS}
          checked={monitoring}
          onChange={onMonitoringChange}
        />
      </OptionsSection>

      <OptionsSection label="Model settings">
        <Box sx={{ pt: 1 }}>{llmSettings}</Box>
      </OptionsSection>
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/* Creation progress                                                   */
/* ------------------------------------------------------------------ */

type StepState = 'done' | 'active' | 'pending' | 'failed';

const STEPS = [
  {
    title: 'Build the robot',
    detail: 'Opens the page you entered and works out how to collect your data from it. Other pages are not visited. This can take a minute or two.',
  },
  { title: 'Run it for the first time', detail: 'Collects the data with the steps it just built.' },
  { title: 'Open the results', detail: 'Takes you to the run so you can see the data.' },
];

const stepStates = (creation: AgentCreationState): StepState[] => {
  switch (creation.phase) {
    case 'building':
      return ['active', 'pending', 'pending'];
    case 'running':
      return ['done', 'active', 'pending'];
    case 'opening':
      return ['done', 'done', 'active'];
    case 'failed':
      return creation.robotCreated ? ['done', 'failed', 'pending'] : ['failed', 'pending', 'pending'];
  }
};

const AgentCreationProgress: React.FC<AgentRobotPanelProps & { creation: AgentCreationState }> = ({
  creation,
  onEditRequest,
  onRetry,
  onGoToRobots,
}) => {
  const theme = useTheme();
  const failed = creation.phase === 'failed';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (failed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [failed]);

  const states = stepStates(creation);
  const host = hostnameOf(creation.url);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Typography component="h2" sx={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em', minWidth: 0, overflowWrap: 'anywhere' }}>
          {failed ? (creation.robotCreated ? `“${creation.robotName}” is saved` : "Couldn't build this robot") : `Building “${creation.robotName}”`}
        </Typography>
        {!failed && (
          <Typography
            aria-label="Time elapsed"
            sx={{ fontSize: 15, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
          >
            {formatElapsed(now - creation.startedAt)}
          </Typography>
        )}
      </Box>

      {/* The request stays in view while the agent works on it. */}
      <Box
        component="blockquote"
        sx={{
          m: 0,
          mt: 2,
          pl: 2,
          borderLeft: '3px solid',
          borderColor: failed && !creation.robotCreated ? 'error.main' : BRAND,
        }}
      >
        <Typography sx={{ fontSize: 16, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{creation.prompt}</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75 }}>
          {host ? `On ${host}` : creation.url}
        </Typography>
      </Box>

      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, mt: 4 }} aria-live="polite">
        {STEPS.map((step, index) => {
          const state = states[index];
          const isLast = index === STEPS.length - 1;
          return (
            <Box component="li" key={step.title} sx={{ display: 'flex', gap: 2 }} aria-current={state === 'active' ? 'step' : undefined}>
              {/* Marker column with a connecting line */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28, flexShrink: 0 }}>
                <StepMarker state={state} number={index + 1} />
                {!isLast && (
                  <Box
                    sx={{
                      width: '2px',
                      flex: 1,
                      minHeight: 20,
                      my: 0.5,
                      bgcolor: state === 'done' ? 'success.main' : 'divider',
                      borderRadius: 1,
                    }}
                  />
                )}
              </Box>
              <Box sx={{ pb: isLast ? 0 : 2.5, pt: 0.25, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 15,
                    fontWeight: state === 'active' || state === 'failed' ? 600 : 500,
                    color: state === 'pending' ? 'text.secondary' : state === 'failed' ? 'error.main' : 'text.primary',
                  }}
                >
                  {step.title}
                </Typography>
                {(state === 'active' || state === 'failed') && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.5, mt: 0.25 }}>
                    {state === 'failed' ? creation.error || 'Something went wrong.' : step.detail}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          mt: 4,
          pt: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {failed ? (
          creation.robotCreated ? (
            <>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', maxWidth: 420 }}>
                You can run it from your robot list.
              </Typography>
              <Button onClick={onGoToRobots} variant="contained" sx={{ bgcolor: BRAND, '&:hover': { bgcolor: '#e000ab' }, textTransform: 'none', borderRadius: '10px', boxShadow: 'none' }}>
                Go to robots
              </Button>
            </>
          ) : (
            <>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', maxWidth: 420 }}>
                Your request is kept. Change it and try again, or retry as is.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button onClick={onEditRequest} variant="outlined" sx={{ textTransform: 'none', borderRadius: '10px', color: 'text.primary', borderColor: 'divider' }}>
                  Edit request
                </Button>
                <Button onClick={onRetry} variant="contained" sx={{ bgcolor: BRAND, '&:hover': { bgcolor: '#e000ab' }, textTransform: 'none', borderRadius: '10px', boxShadow: 'none' }}>
                  Try again
                </Button>
              </Box>
            </>
          )
        ) : (
          <>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', maxWidth: 440 }}>
              You can leave this page. The robot keeps building, shows up in your robot list, and you'll be notified when its run starts.
            </Typography>
            <Button
              onClick={onGoToRobots}
              variant="outlined"
              sx={{
                textTransform: 'none',
                borderRadius: '10px',
                color: 'text.primary',
                borderColor: theme.palette.divider,
                '&:hover': { borderColor: theme.palette.text.secondary, bgcolor: 'transparent' },
              }}
            >
              Go to robots
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
};

const StepMarker: React.FC<{ state: StepState; number: number }> = ({ state, number }) => {
  const base = {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  } as const;

  if (state === 'done') {
    return (
      <Box sx={{ ...base, bgcolor: BRAND, color: 'common.white' }} aria-label="Done">
        <Check sx={{ fontSize: 17 }} />
      </Box>
    );
  }
  if (state === 'active') {
    return (
      <Box sx={{ ...base, position: 'relative', color: BRAND }} aria-label="In progress">
        <CircularProgress size={28} thickness={3.5} sx={{ color: BRAND, position: 'absolute', inset: 0 }} />
        <span>{number}</span>
      </Box>
    );
  }
  if (state === 'failed') {
    return (
      <Box sx={{ ...base, color: 'error.main' }} aria-label="Failed">
        <ErrorOutline sx={{ fontSize: 28 }} />
      </Box>
    );
  }
  return (
    <Box sx={{ ...base, border: '2px solid', borderColor: 'divider', color: 'text.secondary' }} aria-label="Not started">
      {number}
    </Box>
  );
};

export default AgentRobotPanel;
