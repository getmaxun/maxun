/**
 * Building blocks shared by every "Create robot" tab, so they read as one
 * system: a heading, one request box holding the main input with its action
 * on the bottom edge, a hint line, the robot name and a collapsible Options
 * section.
 */
import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Collapse,
  InputBase,
  Link,
  MenuItem,
  Select,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { ExpandMore, InsertDriveFileOutlined, UploadFileOutlined } from '@mui/icons-material';
import { OUTPUT_FORMAT_LABELS, OutputFormats } from '../../../constants/outputFormats';

export const BRAND = '#ff00c3';

export const MONITORING_DESCRIPTION = 'Compare each run with the previous one and flag what changed.';
export const MONITORING_DOCS = 'https://docs.maxun.dev/monitoring';
const BRAND_HOVER = '#e000ab';

/** The gray card every tab sits on, with the content column inside it. */
export const CreatePanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Card sx={{ mb: 4, p: 2 }}>
    <Box sx={{ maxWidth: 700, mx: 'auto', px: { xs: 0.5, sm: 1 }, pt: { xs: 1, sm: 2 }, pb: { xs: 1, sm: 2 } }}>{children}</Box>
  </Card>
);

/** Centered tab header as in the original layout: the Maxun logo above a one-line description. */
export const PanelHeading: React.FC<{ description?: React.ReactNode }> = ({ description }) => (
  <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
    <img
      src="https://ik.imagekit.io/ys1blv5kv/maxunlogo.png"
      width={70}
      height={63}
      style={{
        borderRadius: '5px',
        marginTop: '-30px',
      }}
      alt="Maxun Logo"
    />
    {description && (
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    )}
  </Box>
);

/**
 * The bordered request box. `children` is the main input; `footer` holds small
 * settings on the left and `action` sits at the right of the bottom edge.
 */
export const RequestBox: React.FC<{
  children: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
  invalid?: boolean;
}> = ({ children, footer, action, invalid }) => {
  const theme = useTheme();
  const ring = invalid ? theme.palette.error.main : BRAND;
  return (
    <Box
      sx={{
        borderColor: invalid ? 'error.main' : 'divider',
        borderRadius: '14px',
        bgcolor: 'background.paper',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {children}
      {(footer || action) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
            px: 1.5,
            py: 1,
            flexWrap: { xs: 'wrap', sm: 'nowrap' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>{footer}</Box>
          {action}
        </Box>
      )}
    </Box>
  );
};

export const PrimaryAction: React.FC<{
  children: React.ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}> = ({ children, loading, loadingLabel, disabled, onClick, type = 'button' }) => (
  <Button
    type={type}
    variant="contained"
    onClick={onClick}
    disabled={disabled || loading}
    startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
    sx={{
      backgroundColor: '#ff00c3',
      color: '#ffffff',
      borderRadius: '5px',
      padding: '6px 16px',
      textTransform: 'none',
      '&:hover': {
        backgroundColor: '#ff00c3',
      },
    }}
  >
    {loading ? loadingLabel || children : children}
  </Button>
);

/** One line under the request box: what to fix, or a tip. */
export const HintLine: React.FC<{ tone?: 'muted' | 'warning' | 'error'; children: React.ReactNode; sx?: any }> = ({ tone = 'muted', children, sx }) => (
  <Typography
    role={tone === 'muted' ? undefined : 'alert'}
    sx={{
      fontSize: 13,
      minHeight: 20,
      lineHeight: 1.5,
      color: tone === 'error' ? 'error.main' : tone === 'warning' ? 'warning.main' : 'text.secondary',
      ...sx
    }}
  >
    {children}
  </Typography>
);

/** The robot's name. */
export const RobotNameField: React.FC<{ value: string; onChange: (value: string) => void; placeholder?: string; error?: string }> = ({
  value,
  onChange,
  placeholder,
  error,
}) => (
  <Box sx={{ mt: 2 }}>
    <TextField
      label="Name"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
      size="small"
      fullWidth
      error={!!error}
      InputLabelProps={{ shrink: true }}
      helperText={error || ' '}
      FormHelperTextProps={{ sx: { ml: 0 } }}
      inputProps={{ maxLength: 120 }}
    />
  </Box>
);

/** Collapsible section for settings most people don't need. */
export const OptionsSection: React.FC<{ defaultOpen?: boolean; label?: string; children: React.ReactNode }> = ({
  defaultOpen,
  label = 'Options',
  children,
}) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Box>
      <Button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        endIcon={<ExpandMore sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
        sx={{ textTransform: 'none', color: 'text.primary', fontWeight: 500, fontSize: 14, px: 0, '&:hover': { bgcolor: 'transparent' } }}
      >
        {label}
      </Button>
      <Collapse in={open} timeout={150}>
        <Box sx={{ pb: 1 }}>{children}</Box>
      </Collapse>
    </Box>
  );
};

/** A setting with a switch, a one-line description and an optional docs link. */
export const OptionRow: React.FC<{
  title: string;
  description: string;
  href?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}> = ({ title, description, href, checked, onChange, children }) => {
  const id = `option-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <Box sx={{ py: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography component="label" htmlFor={id} sx={{ fontSize: 15, fontWeight: 500, cursor: 'pointer' }}>
            {title}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.5, mt: 0.25 }}>
            {description}
            {href && (
              <>
                {' '}
                <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ color: 'text.secondary', textDecorationColor: 'currentColor' }}>
                  Learn more
                </Link>
              </>
            )}
          </Typography>
        </Box>
        <Switch
          id={id}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          sx={{
            mt: -0.5,
            flexShrink: 0,
            '& .MuiSwitch-switchBase.Mui-checked': { color: BRAND },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: BRAND },
          }}
        />
      </Box>
      {children && <Box sx={{ mt: 1.5 }}>{children}</Box>}
    </Box>
  );
};

/** Labelled field group inside Options (selects, numbers, paths). */
export const OptionField: React.FC<{ children: React.ReactNode }> = ({ children }) => <Box sx={{ py: 1 }}>{children}</Box>;

/** Borderless select that fits in the request box's bottom edge. */
const inlineSelectSx = {
  fontSize: 14,
  borderRadius: '8px',
  '& .MuiSelect-select': { py: 0.6, pl: 1.25, pr: '28px !important' },
  '& fieldset': { border: 'none' },
  bgcolor: (theme: any) => alpha(theme.palette.text.primary, 0.05),
  '&:hover': { bgcolor: (theme: any) => alpha(theme.palette.text.primary, 0.08) },
};

export const InlineSelect = <T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
}) => (
  <Select
    size="small"
    value={value}
    onChange={(e) => onChange(e.target.value as T)}
    inputProps={{ 'aria-label': ariaLabel }}
    displayEmpty
    renderValue={(selected) => options.find((option) => option.value === selected)?.label ?? String(selected)}
    sx={inlineSelectSx}
  >
    {options.map((option) => (
      <MenuItem key={option.value || 'empty'} value={option.value}>
        {option.label}
      </MenuItem>
    ))}
  </Select>
);

/** Multi-select of output formats, sized for the request box's bottom edge. */
export const OutputFormatsSelect: React.FC<{
  value: OutputFormats[];
  onChange: (value: OutputFormats[]) => void;
  options: readonly OutputFormats[];
}> = ({ value, onChange, options }) => (
  <Select
    size="small"
    multiple
    displayEmpty
    value={value}
    onChange={(e) => {
      const next = (typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value) as OutputFormats[];
      onChange(next);
    }}
    inputProps={{ 'aria-label': 'Output formats' }}
    renderValue={(selected) => {
      const list = selected as OutputFormats[];
      if (!list.length) return <span style={{ opacity: 0.6 }}>Choose formats</span>;
      const labels = list.map((format) => OUTPUT_FORMAT_LABELS[format] ?? format);
      return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
    }}
    MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}
    sx={{ ...inlineSelectSx, maxWidth: 240 }}
  >
    {options.map((format) => (
      <MenuItem key={format} value={format} dense>
        <Checkbox checked={value.includes(format)} size="small" sx={{ p: 0.5, mr: 1, '&.Mui-checked': { color: BRAND } }} />
        {OUTPUT_FORMAT_LABELS[format]}
      </MenuItem>
    ))}
  </Select>
);

/**
 * Small number field for the request box's bottom edge ("Up to [50] pages").
 * A digits-only text field rather than type="number": no spinner arrows, and
 * scrolling over it doesn't change the value. The number is applied on blur or
 * Enter, so the field can be cleared and retyped.
 */
export const InlineNumber: React.FC<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  before?: string;
  after?: string;
  ariaLabel: string;
}> = ({ value, onChange, min = 1, max, before, after, ariaLabel }) => {
  const [draft, setDraft] = useState(String(value));

  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseInt(draft, 10);
    const next = Number.isNaN(parsed) ? value : Math.max(min, max ? Math.min(max, parsed) : parsed);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 14, color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {before && <span>{before}</span>}
      <Box
        component="input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={draft}
        aria-label={ariaLabel}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
        onBlur={commit}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        sx={{
          // As wide as its digits (plus padding), so "50" has no empty space after it.
          width: `calc(${Math.max(draft.length, 1)}ch + 16px)`,
          minWidth: 'calc(2ch + 16px)',
          boxSizing: 'border-box',
          font: 'inherit',
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
          color: 'text.primary',
          border: 'none',
          borderRadius: '8px',
          py: 0.6,
          px: 1,
          bgcolor: (theme: any) => alpha(theme.palette.text.primary, 0.05),
          outline: 'none',
        }}
      />
      {after && <span>{after}</span>}
    </Box>
  );
};

/** Two or three mutually exclusive choices, each with a short explanation. */
export const ChoiceToggle = <T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; description: string; icon?: React.ReactNode }>;
  ariaLabel: string;
}) => (
  <ToggleButtonGroup
    exclusive
    value={value}
    onChange={(_, next) => next && onChange(next)}
    aria-label={ariaLabel}
    sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${options.length}, 1fr)` }, gap: 1, mb: 2 }}
  >
    {options.map((option) => (
      <ToggleButton
        key={option.value}
        value={option.value}
        sx={{
          textTransform: 'none',
          justifyContent: 'flex-start',
          textAlign: 'left',
          alignItems: 'flex-start',
          flexDirection: 'column',
          gap: 0.25,
          px: 2,
          py: 1.25,
          color: 'text.secondary',
          border: '1px solid !important',
          borderColor: (theme: any) => `${theme.palette.divider} !important`,
          borderRadius: '12px !important',
          '&.Mui-selected': {
            color: 'text.primary',
            borderColor: `${BRAND} !important`,
            backgroundColor: 'inherit !important',
          },
          '&:hover': {
            backgroundColor: 'inherit',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 15, fontWeight: 500, color: 'text.primary' }}>
          {option.icon}
          {option.label}
        </Box>
        <Typography variant="caption" sx={{ mt: 0.25 }}>
          {option.description}
        </Typography>
      </ToggleButton>
    ))}
  </ToggleButtonGroup>
);

/** Large single-line input for the request box (URL or query) with a leading icon. */
export const RequestInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder: string;
  icon: React.ReactNode;
  ariaLabel: string;
  inputMode?: 'url' | 'search' | 'text';
  autoFocus?: boolean;
}> = ({ value, onChange, onBlur, placeholder, icon, ariaLabel, inputMode = 'text', autoFocus }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2.25, py: 1.75 }}>
    <Box sx={{ display: 'flex', color: 'text.secondary', '& svg': { fontSize: 20 } }} aria-hidden>
      {icon}
    </Box>
    <InputBase
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      autoFocus={autoFocus}
      fullWidth
      inputProps={{ 'aria-label': ariaLabel, inputMode, spellCheck: inputMode === 'url' ? false : undefined }}
      sx={{ fontSize: 17 }}
    />
  </Box>
);

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Click-or-drop file picker that fills the top of the request box. */
export const FileDropZone: React.FC<{
  file: File | null;
  onFile: (file: File | null) => void;
  accept: string;
  description: string;
}> = ({ file, onFile, accept, description }) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={file ? `Selected file ${file.name}. Choose a different file` : 'Choose a file'}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2.25,
        py: 2,
        cursor: 'pointer',
        borderTopLeftRadius: '14px',
        borderTopRightRadius: '14px',
        bgcolor: (theme: any) => (dragging ? alpha(BRAND, theme.palette.mode === 'dark' ? 0.12 : 0.05) : 'transparent'),
        outline: 'none',
        '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${BRAND}` },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: file ? BRAND : 'text.secondary',
          bgcolor: (theme: any) => alpha(file ? BRAND : theme.palette.text.primary, file ? 0.1 : 0.05),
        }}
      >
        {file ? <InsertDriveFileOutlined /> : <UploadFileOutlined />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file ? file.name : dragging ? 'Drop the file here' : 'Choose a file or drop it here'}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          {file ? `${formatBytes(file.size)}. Click to choose a different file.` : description}
        </Typography>
      </Box>
    </Box>
  );
};
