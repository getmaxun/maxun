import { useEffect, useRef, useState, useMemo } from "react";
import * as React from "react";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import {
  Box, Collapse, IconButton, Typography, Chip, TextField, Dialog, DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
  Tab,
  Tabs,
  Paper,
  Table,
  TableBody,
  TableContainer,
  TableHead,
} from "@mui/material";
import { Button } from "@mui/material";
import { DeleteForever, KeyboardArrowDown, KeyboardArrowUp, Settings } from "@mui/icons-material";
import { deleteRunFromStorage, getStoredRun, getRunDiff, RunDiffResponse } from "../../api/storage";
import { columns, Data } from "./RunsTable";
import { RunContent } from "./RunContent";
import { getUserById } from "../../api/auth";
import { useTranslation } from "react-i18next";
import { useTheme, alpha } from "@mui/material/styles";
import { getOrCreateBrowserSocket, releaseBrowserSocket } from "../../utils/browserSocket";
import { diffLines, Change } from "diff";

type TextDiffFormat = 'text' | 'markdown' | 'html';

const TEXT_DIFF_FORMATS: TextDiffFormat[] = [
  'text',
  'markdown',
  'html',
];

const DIFF_FORMAT_LABELS: Record<string, string> = {
  text: 'Text Content',
  markdown: 'Markdown',
  html: 'HTML',
  'screenshot-visible': 'Visible Screenshot',
  'screenshot-fullpage': 'Full-page Screenshot',
};

interface RunTypeChipProps {
  runByUserId?: string;
  runByScheduledId?: string;
  runByAPI: boolean;
  runBySDK?: boolean;
  runByMCP?: boolean;
  runByCLI?: boolean;
}

const RunTypeChip: React.FC<RunTypeChipProps> = ({ runByUserId, runByScheduledId, runByAPI, runBySDK, runByMCP, runByCLI }) => {
  const { t } = useTranslation();

  if (runByScheduledId) return <Chip label={t('runs_table.run_type_chips.scheduled_run')} color="primary" variant="outlined" />;
  if (runByCLI) return <Chip label={t('runs_table.run_type_chips.cli')} color="primary" variant="outlined" />;
  if (runByMCP) return <Chip label={t('runs_table.run_type_chips.mcp')} color="primary" variant="outlined" />;
  if (runBySDK) return <Chip label={t('runs_table.run_type_chips.sdk')} color="primary" variant="outlined" />;
  if (runByAPI) return <Chip label={t('runs_table.run_type_chips.api')} color="primary" variant="outlined" />;
  if (runByUserId) return <Chip label={t('runs_table.run_type_chips.manual_run')} color="primary" variant="outlined" />;
  return <Chip label={t('runs_table.run_type_chips.unknown_run_type')} color="primary" variant="outlined" />;
};

interface CollapsibleRowProps {
  row: Data;
  handleDelete: () => void;
  isOpen: boolean;
  onToggleExpanded: (shouldExpand: boolean) => void;
  currentLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runningRecordingName: string;
  urlRunId: string | null;
}
export const CollapsibleRow = ({ row, handleDelete, isOpen, onToggleExpanded, currentLog, abortRunHandler, runningRecordingName, urlRunId }: CollapsibleRowProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [openSettingsModal, setOpenSettingsModal] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Data>(row);
  const [isLoadingRunDetails, setIsLoadingRunDetails] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<RunDiffResponse | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [selectedDiffFormat, setSelectedDiffFormat] = useState('text');
  const [selectedCapturedGroup, setSelectedCapturedGroup] = useState('');

  const handleOpenDiff = async () => {
    setDiffOpen(true);
    setIsDiffLoading(true);
    const data = await getRunDiff(row.runId);
    setDiffData(data);
    const availableFormats = data ? [
      ...TEXT_DIFF_FORMATS.filter((format) => data.formats?.[format]),
      ...(data.capturedText ? ['captured-text'] : []),
      ...Object.keys(data.screenshots || {}).map((name) => `screenshot:${name}`),
    ] : [];
    const firstChangedFormat = availableFormats.find((format) => {
      const changedKey = format.startsWith('screenshot:') ? format.slice('screenshot:'.length) : format;
      return data?.changedFormats?.includes(format) || data?.changedFormats?.includes(changedKey);
    });
    const initialFormat = firstChangedFormat || availableFormats[0];
    if (initialFormat) setSelectedDiffFormat(initialFormat);
    if (data?.capturedText) {
      try {
        const currentGroups = JSON.parse(data.capturedText.current || '{}');
        const previousGroups = JSON.parse(data.capturedText.previous || '{}');
        setSelectedCapturedGroup(Object.keys(currentGroups)[0] || Object.keys(previousGroups)[0] || '');
      } catch {
        setSelectedCapturedGroup('');
      }
    }
    setIsDiffLoading(false);
  };

  const handleCloseDiff = () => {
    setDiffOpen(false);
    setDiffData(null);
  };

  const diffParts = useMemo<Change[]>(() => {
    if (!diffData || selectedDiffFormat.startsWith('screenshot:')) return [];
    const selectedOutput = selectedDiffFormat === 'captured-text'
      ? diffData.capturedText
      : diffData.formats?.[selectedDiffFormat as TextDiffFormat];
    const previous = selectedOutput?.previous ?? (selectedDiffFormat === 'text' ? diffData.previousText : '');
    const current = selectedOutput?.current ?? (selectedDiffFormat === 'text' ? diffData.currentText : '');
    return diffLines(previous, current, { ignoreWhitespace: true });
  }, [diffData, selectedDiffFormat]);

  const hasDiff = diffParts.some((part) => part.added || part.removed);
  const selectedScreenshotName = selectedDiffFormat.startsWith('screenshot:')
    ? selectedDiffFormat.slice('screenshot:'.length)
    : undefined;
  const selectedScreenshot = selectedScreenshotName ? diffData?.screenshots?.[selectedScreenshotName] : undefined;
  const getDiffImageSrc = (entry: string | { data?: string } | null | undefined) => {
    const value = typeof entry === 'object' && entry !== null ? entry.data : entry;
    if (!value) return '';
    if (value.startsWith('http') || value.startsWith('data:')) return value;
    return `data:image/png;base64,${value}`;
  };
  const diffOptions = useMemo(() => {
    if (!diffData) return [];
    return [
      ...TEXT_DIFF_FORMATS.filter((format) => diffData.formats?.[format]).map((format) => ({ key: format, label: DIFF_FORMAT_LABELS[format] })),
      ...(diffData.capturedText ? [{ key: 'captured-text', label: 'Captured Text' }] : []),
      ...Object.keys(diffData.screenshots || {}).map((name) => ({
        key: `screenshot:${name}`,
        label: DIFF_FORMAT_LABELS[name] || name,
      })),
    ];
  }, [diffData]);
  const capturedGroups = useMemo(() => {
    if (!diffData?.capturedText) return {} as Record<string, { previous: any[]; current: any[] }>;
    try {
      const previous = JSON.parse(diffData.capturedText.previous || '{}');
      const current = JSON.parse(diffData.capturedText.current || '{}');
      return Array.from(new Set([...Object.keys(previous), ...Object.keys(current)])).reduce((groups, name) => {
        groups[name] = {
          previous: Array.isArray(previous[name]) ? previous[name] : previous[name] == null ? [] : [previous[name]],
          current: Array.isArray(current[name]) ? current[name] : current[name] == null ? [] : [current[name]],
        };
        return groups;
      }, {} as Record<string, { previous: any[]; current: any[] }>);
    } catch {
      return {} as Record<string, { previous: any[]; current: any[] }>;
    }
  }, [diffData]);
  const capturedTableRows = useMemo(() => {
    const group = capturedGroups[selectedCapturedGroup];
    if (!group) return [];
    const rowCount = Math.max(group.previous.length, group.current.length);
    const rows: Array<{ key: string; label: string; previous: any; current: any; changed: boolean }> = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const previousRow = group.previous[rowIndex] || {};
      const currentRow = group.current[rowIndex] || {};
      Array.from(new Set([...Object.keys(previousRow), ...Object.keys(currentRow)])).forEach((label) => {
        const previous = previousRow[label];
        const current = currentRow[label];
        rows.push({
          key: `${rowIndex}-${label}`,
          label: rowCount > 1 ? `${label} (row ${rowIndex + 1})` : label,
          previous,
          current,
          changed: JSON.stringify(previous) !== JSON.stringify(current),
        });
      });
    }
    return rows;
  }, [capturedGroups, selectedCapturedGroup]);
  const displayCapturedValue = (value: any) => value == null
    ? '—'
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const runByLabel = row.runByScheduleId
    ? `${row.runByScheduleId}`
    : row.runByUserId
      ? `${userEmail}`
      : row.runByCLI
        ? 'CLI'
        : row.runByMCP
          ? 'MCP'
          : row.runBySDK
            ? 'SDK'
            : row.runByAPI
              ? 'API'
              : 'Unknown';

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const [workflowProgress, setWorkflowProgress] = useState<{
    current: number;
    total: number;
    percentage: number;
  } | null>(null);

  useEffect(() => {
    if (!row.browserId || row.status !== 'running') return;

    const socket = getOrCreateBrowserSocket(row.browserId);
    const callback = (data: any) => {
      setWorkflowProgress(data);
    };

    socket.on('workflowProgress', callback);

    return () => {
      socket.off('workflowProgress', callback);
      releaseBrowserSocket(row.browserId);
    };
  }, [row.browserId, row.status]);

  useEffect(() => {
    if (row.status !== 'running' && row.status !== 'queued') {
      setWorkflowProgress(null);
    }
  }, [row.status]);

  const handleAbort = () => {
    abortRunHandler(row.runId, row.name, row.browserId);
  }

  const handleRowExpand = () => {
    const newOpen = !isOpen;
    onToggleExpanded(newOpen);
  };

  useEffect(() => {
    setRunDetails(prev => {
      if (prev.runId !== row.runId) return row;
      return {
        ...row,
        serializableOutput: prev.serializableOutput ?? row.serializableOutput,
        binaryOutput: prev.binaryOutput ?? row.binaryOutput,
      };
    });
  }, [row]);

  useEffect(() => {
    const hasOutputLoaded =
      runDetails.serializableOutput !== undefined &&
      runDetails.binaryOutput !== undefined;

    if (!isOpen || row.status === 'running' || row.status === 'queued' || hasOutputLoaded) return;

    let isCancelled = false;
    setIsLoadingRunDetails(true);

    getStoredRun(row.runId)
      .then((run) => {
        if (!run || isCancelled) return;
        setRunDetails(prev => ({ ...prev, ...run }));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingRunDetails(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, row.runId, row.status, runDetails.serializableOutput, runDetails.binaryOutput]);

  useEffect(() => {
    const fetchUserEmail = async () => {
      if (row.runByUserId) {
        const userData = await getUserById(row.runByUserId);
        if (userData && userData.user) {
          setUserEmail(userData.user.email);
        }
      }
    };
    fetchUserEmail();
  }, [row.runByUserId]);

  const handleConfirmDelete = async () => {
    try {
      const res = await deleteRunFromStorage(`${row.runId}`);
      if (res) {
        handleDelete();
      }
    } finally {
      setDeleteOpen(false);
    }
  };

  return (
    <React.Fragment>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }} hover role="checkbox" tabIndex={-1} key={row.id}>
        <TableCell>
          <IconButton
            aria-label="expand row"
            size="small"
            onClick={handleRowExpand}
          >
            {isOpen ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        {columns.map((column) => {
          // @ts-ignore
          const value: any = row[column.id];
          if (value !== undefined) {
            return (
              <TableCell key={column.id} align={column.align}>
                {value}
              </TableCell>
            );
          } else {
            switch (column.id) {
              case 'runStatus':
                return (
                  <TableCell key={column.id} align={column.align}>
                    {row.status === 'success' && <Chip label={t('runs_table.run_status_chips.success')} color="success" variant="outlined" />}
                    {row.status === 'success' && row.hasChanges && (
                      <Chip
                        label={t('runs_table.run_diff.changed_chip', { defaultValue: 'Changed' })}
                        color="info"
                        variant="outlined"
                        onClick={handleOpenDiff}
                        sx={{ ml: 1, cursor: 'pointer' }}
                      />
                    )}
                    {row.status === 'running' && <Chip label={t('runs_table.run_status_chips.running')} color="warning" variant="outlined" />}
                    {row.status === 'scheduled' && <Chip label={t('runs_table.run_status_chips.scheduled')} variant="outlined" />}
                    {row.status === 'queued' && <Chip label={t('runs_table.run_status_chips.queued')} variant="outlined" />}
                    {row.status === 'failed' && <Chip label={t('runs_table.run_status_chips.failed')} color="error" variant="outlined" />}
                    {row.status === 'aborted' && <Chip label={t('runs_table.run_status_chips.aborted')} color="error" variant="outlined" />}
                  </TableCell>
                )
              case 'delete':
                return (
                  <TableCell key={column.id} align={column.align}>
                    <IconButton aria-label="delete" size="small" onClick={() => setDeleteOpen(true)}>
                      <DeleteForever />
                    </IconButton>
                  </TableCell>
                );
              case 'settings':
                return (
                  <TableCell key={column.id} align={column.align}>
                    <IconButton aria-label="settings" size="small" onClick={() => setOpenSettingsModal(true)}>
                      <Settings />
                    </IconButton>
                    <Dialog
                      open={openSettingsModal}
                      onClose={() => setOpenSettingsModal(false)}
                      maxWidth="sm"
                      fullWidth
                      PaperProps={{
                        sx: {
                          borderRadius: 2
                        }
                      }}
                    >
                      <DialogTitle>
                        {t('runs_table.run_settings_modal.title')}
                      </DialogTitle>

                      <DialogContent>
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2.5,
                            mt: 1
                          }}
                        >
                          <TextField
                            label={t('runs_table.run_settings_modal.labels.run_id')}
                            value={row.runId}
                            InputProps={{ readOnly: true }}
                            fullWidth
                          />

                          <TextField
                            label={
                              row.runByScheduleId
                                ? t('runs_table.run_settings_modal.labels.run_by_schedule')
                                : row.runByUserId
                                  ? t('runs_table.run_settings_modal.labels.run_by_user')
                                  : row.runByCLI
                                    ? t('runs_table.run_settings_modal.labels.run_by_cli')
                                    : row.runByMCP
                                      ? t('runs_table.run_settings_modal.labels.run_by_mcp')
                                      : row.runBySDK
                                        ? t('runs_table.run_settings_modal.labels.run_by_sdk')
                                        : row.runByAPI
                                          ? t('runs_table.run_settings_modal.labels.run_by_api')
                                          : t('runs_table.run_settings_modal.labels.run_by_unknown')
                            }
                            value={runByLabel}
                            InputProps={{ readOnly: true }}
                            fullWidth
                          />

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Typography variant="body1">
                              {t('runs_table.run_settings_modal.labels.run_type')}:
                            </Typography>

                            <RunTypeChip
                              runByUserId={row.runByUserId}
                              runByScheduledId={row.runByScheduleId}
                              runByAPI={row.runByAPI ?? false}
                              runBySDK={row.runBySDK}
                              runByMCP={row.runByMCP}
                              runByCLI={row.runByCLI}
                            />
                          </Box>
                        </Box>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                )
              default:
                return null;
            }
          }
        })}
      </TableRow>
      <TableRow>
        <TableCell sx={{ p: 0 }} colSpan={8}>
          <Collapse in={isOpen} timeout="auto" unmountOnExit>
            {isLoadingRunDetails ? (
              <Box display="flex" justifyContent="center" py={3}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <RunContent row={runDetails} abortRunHandler={handleAbort} currentLog={currentLog}
                logEndRef={logEndRef} interpretationInProgress={runningRecordingName === row.name}
                workflowProgress={workflowProgress} />
            )}
          </Collapse>
        </TableCell>
      </TableRow>

      <Dialog
        open={isDeleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            p: 0,
            backgroundColor: theme.palette.mode === 'dark'
              ? theme.palette.grey[900]
              : theme.palette.background.paper,
            borderRadius: 2,
            width: { xs: '90vw', sm: '460px', md: '420px' },
            maxWidth: '90vw',
            boxSizing: 'border-box'
          }
        }}
      >
        <DialogTitle>
          {t('runs_table.delete_confirm.title', {
            name: row.name,
            defaultValue: 'Delete run "{{name}}"?'
          })}
        </DialogTitle>

        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            {t('runs_table.delete_confirm.message', {
              name: row.name,
              defaultValue: 'Are you sure you want to delete the run "{{name}}"?'
            })}
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeleteOpen(false)}
            color='inherit'
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>

          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
          >
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={diffOpen} onClose={handleCloseDiff} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ textAlign: 'center' }}>
          {t('runs_table.run_diff.title', { defaultValue: 'Changes vs Previous Run' })}
        </DialogTitle>
        <DialogContent>
          {isDiffLoading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress size={24} />
            </Box>
          ) : !diffData ? (
            <DialogContentText>
              {t('runs_table.run_diff.no_previous_run', { defaultValue: 'No previous run found to compare against.' })}
            </DialogContentText>
          ) : (
            <>
              <Tabs
                value={selectedDiffFormat}
                onChange={(_, value) => setSelectedDiffFormat(value)}
                centered
                sx={{ mb: 2 }}
              >
                {diffOptions.map((option) => (
                  <Tab key={option.key} value={option.key} label={option.label} />
                ))}
              </Tabs>
              {selectedDiffFormat === 'captured-text' ? (
                <Box>
                  {Object.keys(capturedGroups).length > 1 && (
                    <Tabs value={selectedCapturedGroup} onChange={(_, value) => setSelectedCapturedGroup(value)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, minHeight: 36 }}>
                      {Object.keys(capturedGroups).map((name) => <Tab key={name} value={name} label={name} sx={{ minHeight: 36 }} />)}
                    </Tabs>
                  )}
                  <TableContainer component={Paper} sx={{ maxHeight: '60vh' }}>
                    <Table
                      stickyHeader
                      sx={{
                        '& .MuiTableCell-root': {
                          px: 3,
                          py: 2.25,
                          fontSize: '1rem',
                          lineHeight: 1.5,
                        },
                        '& .MuiTableCell-head': {
                          py: 2.5,
                        },
                      }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600, width: '22%' }}>Label</TableCell>
                          <TableCell sx={{ fontWeight: 600, width: '39%' }}>Previous Run</TableCell>
                          <TableCell sx={{ fontWeight: 600, width: '39%' }}>Current Run</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {capturedTableRows.map((item) => (
                          <TableRow key={item.key} hover>
                            <TableCell sx={{ fontWeight: 500 }}>{item.label}</TableCell>
                            <TableCell sx={{ wordBreak: 'break-word', backgroundColor: item.changed ? alpha(theme.palette.error.main, 0.12) : 'transparent' }}>{displayCapturedValue(item.previous)}</TableCell>
                            <TableCell sx={{ wordBreak: 'break-word', backgroundColor: item.changed ? alpha(theme.palette.success.main, 0.12) : 'transparent' }}>{displayCapturedValue(item.current)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : selectedScreenshot ? (
                <Box>
                  {selectedScreenshot.metadata && (
                    <Typography variant="body2" align="center" sx={{ mb: 2 }}>
                      {selectedScreenshot.metadata.changedPercentage.toFixed(2)}% of compared pixels changed
                      {' · '}
                      Previous {selectedScreenshot.metadata.previousWidth}×{selectedScreenshot.metadata.previousHeight}
                      {' · '}
                      Current {selectedScreenshot.metadata.currentWidth}×{selectedScreenshot.metadata.currentHeight}
                    </Typography>
                  )}
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2, maxHeight: '60vh', overflow: 'auto' }}>
                    {[
                      { label: 'Previous Run', source: selectedScreenshot.previous },
                      { label: 'Current Run', source: selectedScreenshot.current },
                    ].map((image) => (
                      <Box key={image.label}>
                        <Typography variant="subtitle2" align="center" gutterBottom>{image.label}</Typography>
                        {getDiffImageSrc(image.source) ? (
                          <Box component="img" src={getDiffImageSrc(image.source)} alt={image.label} sx={{ display: 'block', width: '100%', height: 'auto', border: `1px solid ${theme.palette.divider}` }} />
                        ) : (
                          <DialogContentText align="center">Screenshot unavailable</DialogContentText>
                        )}
                      </Box>
                    ))}
                    <Box>
                      <Typography variant="subtitle2" align="center" gutterBottom>
                        Changes Highlighted
                      </Typography>
                      {selectedScreenshot.diff ? (
                        <>
                          <Box
                            component="img"
                            src={getDiffImageSrc(selectedScreenshot.diff)}
                            alt="Current screenshot with changes highlighted"
                            sx={{ display: 'block', width: '100%', height: 'auto', border: `1px solid ${theme.palette.divider}` }}
                          />
                          <Typography variant="caption" display="flex" alignItems="center" justifyContent="center" gap={0.75} sx={{ mt: 1, color: 'text.secondary' }}>
                            <Box component="span" sx={{ width: 12, height: 12, bgcolor: '#ff00c3', borderRadius: '2px' }} />
                            Magenta highlights show changed areas on the current screenshot.
                          </Typography>
                        </>
                      ) : (
                        <DialogContentText align="center" sx={{ mt: 4 }}>
                          A highlighted visual diff was not generated for this run. Run the robot again to create one with the updated comparison.
                        </DialogContentText>
                      )}
                    </Box>
                  </Box>
                </Box>
              ) : !hasDiff ? (
                <DialogContentText>
                  {t('runs_table.run_diff.no_changes', { defaultValue: 'No differences found between these runs.' })}
                </DialogContentText>
              ) : (
                <Box sx={{ display: 'flex', gap: 2, maxHeight: '60vh' }}>
                  <Box sx={{ flex: 1, overflow: 'auto' }}>
                    <Typography variant="subtitle2" align="center" gutterBottom>
                      {t('runs_table.run_diff.previous_run', { defaultValue: 'Previous Run' })}
                    </Typography>
                    <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, m: 0 }}>
                      {diffParts.map((part, i) => part.added ? null : (
                        <Box key={i} component="span" sx={{ display: 'block', backgroundColor: part.removed ? alpha(theme.palette.error.main, 0.12) : 'transparent' }}>
                          {part.value}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1, overflow: 'auto' }}>
                    <Typography variant="subtitle2" align="center" gutterBottom>
                      {t('runs_table.run_diff.current_run', { defaultValue: 'Current Run' })}
                    </Typography>
                    <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, m: 0 }}>
                      {diffParts.map((part, i) => part.removed ? null : (
                        <Box key={i} component="span" sx={{ display: 'block', backgroundColor: part.added ? alpha(theme.palette.success.main, 0.12) : 'transparent' }}>
                          {part.value}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDiff}>
            {t('runs_table.run_diff.close', { defaultValue: 'Close' })}
          </Button>
        </DialogActions>
      </Dialog>
    </React.Fragment>
  );
}

export const modalStyle = {
  top: '45%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};
