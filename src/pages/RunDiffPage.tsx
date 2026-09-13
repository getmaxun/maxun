import * as React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, CircularProgress, Tab, Tabs, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography, IconButton,
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useTheme, alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useRunDiff, displayCapturedValue, valuesEqual } from '../hooks/useRunDiff';

export const RunDiffPage: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { t } = useTranslation();

  const {
    diffData, isDiffLoading, selectedDiffFormat, setSelectedDiffFormat,
    selectedCapturedGroup, setSelectedCapturedGroup,
    selectedCapturedList, setSelectedCapturedList,
    diffParts, hasDiff, selectedScreenshot, diffOptions,
    capturedGroups, capturedTableRows, capturedListGroups, capturedListRows, capturedListColumns,
    getDiffImageSrc,
  } = useRunDiff(runId);

  // Group all individual "screenshot:<name>" entries the hook produces into one
  // top-level "Screenshots" tab, with the individual names becoming a sub-tab row —
  // same pattern as the captured-list groups below.
  const screenshotOptions = diffOptions.filter((option) => option.key.startsWith('screenshot:'));
  const nonScreenshotOptions = diffOptions.filter((option) => !option.key.startsWith('screenshot:'));
  const topLevelOptions = [
    ...nonScreenshotOptions,
    ...(screenshotOptions.length > 0 ? [{ key: 'screenshots', label: 'Screenshots' }] : []),
  ];
  const isScreenshotsActive = selectedDiffFormat.startsWith('screenshot:');
  const topLevelValue = isScreenshotsActive ? 'screenshots' : selectedDiffFormat;

  const handleTopLevelChange = (_: React.SyntheticEvent, value: string) => {
    if (value === 'screenshots') {
      // Only switch format if we weren't already showing a screenshot; otherwise
      // keep whichever one was selected.
      if (!isScreenshotsActive && screenshotOptions.length > 0) {
        setSelectedDiffFormat(screenshotOptions[0].key);
      }
      return;
    }
    setSelectedDiffFormat(value);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 3, py: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <IconButton onClick={() => navigate(-1)} aria-label="back">
          <ArrowBack />
        </IconButton>
        <Typography variant="h6">
          {t('runs_table.run_diff.title', { defaultValue: 'Run Comparison' })}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', px: 3, py: 3, minHeight: 0 }}>
        {isDiffLoading ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
            <CircularProgress size={28} />
          </Box>
        ) : !diffData ? (
          <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
            <Typography color="text.secondary">
              {t('runs_table.run_diff.no_previous_run', { defaultValue: 'No previous run found to compare against.' })}
            </Typography>
          </Box>
        ) : (
          <>
            <Tabs
              value={topLevelValue}
              onChange={handleTopLevelChange}
              centered
              sx={{
                minHeight: 36,
                mb: 3,
                flexShrink: 0,
                '& .MuiTab-root': {
                  minHeight: 36, paddingX: 2, paddingY: 1.5, minWidth: 0,
                  color: theme => `${theme.palette.mode === 'dark' ? '#fff' : '#000'} !important`,
                },
                '& .MuiTabs-indicator': { height: 2 },
              }}
            >
              {topLevelOptions.map((option) => (
                <Tab key={option.key} value={option.key} label={option.label} />
              ))}
            </Tabs>

            {isScreenshotsActive && screenshotOptions.length > 1 && (
              <Tabs
                value={selectedDiffFormat}
                onChange={(_, value) => setSelectedDiffFormat(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  minHeight: 36,
                  mb: 3,
                  flexShrink: 0,
                  '& .MuiTab-root': {
                    minHeight: 36, paddingX: 2, paddingY: 1.5, minWidth: 0,
                    color: theme => `${theme.palette.mode === 'dark' ? '#fff' : '#000'} !important`,
                  },
                  '& .MuiTabs-indicator': { height: 2 },
                }}
              >
                {screenshotOptions.map((option) => (
                  <Tab key={option.key} value={option.key} label={option.label} sx={{ minHeight: 36 }} />
                ))}
              </Tabs>
            )}

            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {selectedDiffFormat === 'captured-text' ? (
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {Object.keys(capturedGroups).length > 1 && (
                    <Tabs
                      value={selectedCapturedGroup}
                      onChange={(_, value) => setSelectedCapturedGroup(value)}
                      variant="scrollable"
                      scrollButtons="auto"
                      sx={{
                        minHeight: 36,
                        mb: 3,
                        flexShrink: 0,
                        '& .MuiTab-root': {
                          minHeight: 36, paddingX: 2, paddingY: 1.5, minWidth: 0,
                          color: theme => `${theme.palette.mode === 'dark' ? '#fff' : '#000'} !important`,
                        },
                        '& .MuiTabs-indicator': { height: 2 },
                      }}
                    >
                      {Object.keys(capturedGroups).map((name) => (
                        <Tab key={name} value={name} label={name} sx={{ minHeight: 36 }} />
                      ))}
                    </Tabs>
                  )}
                  {capturedTableRows.length === 0 ? (
                    <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
                      <Typography color="text.secondary" align="center">
                        No captured text data is available for these runs.
                      </Typography>
                    </Box>
                  ) : (
                    <TableContainer
                      component={Paper}
                      elevation={0}
                      sx={{ maxHeight: '100%', overflow: 'auto', bgcolor: 'background.paper', backgroundImage: 'none' }}
                    >
                      <Table
                        stickyHeader
                        sx={{
                          '& .MuiTableCell-root': { px: 3, py: 2.25, fontSize: '1rem', lineHeight: 1.5 },
                          '& .MuiTableCell-head': { py: 2.5, bgcolor: 'background.paper' },
                          '& .MuiTableCell-body': { bgcolor: 'background.paper' },
                        }}
                      >
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600, width: '30%' }}>Label</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '70%' }}>Value</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {capturedTableRows.map((item) => (
                            <TableRow key={item.key} hover>
                              <TableCell sx={{ fontWeight: 500 }}>{item.label}</TableCell>
                              <TableCell
                                sx={{
                                  wordBreak: 'break-word',
                                  verticalAlign: 'middle',
                                  bgcolor: item.changed
                                    ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.16 : 0.2)
                                    : 'background.paper',
                                }}
                              >
                                {!item.changed ? (
                                  displayCapturedValue(item.current)
                                ) : (
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75 }}>
                                    {item.previous && (
                                      <Typography component="span" sx={{ color: 'error.main', textDecoration: 'line-through', fontSize: 'inherit' }}>
                                        {displayCapturedValue(item.previous)}
                                      </Typography>
                                    )}
                                    {item.current && (
                                      <Typography component="span" sx={{ color: 'success.main', fontWeight: 600, fontSize: 'inherit' }}>
                                        {displayCapturedValue(item.current)}
                                      </Typography>
                                    )}
                                  </Box>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Box>
              ) : selectedDiffFormat === 'captured-list' ? (
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {Object.keys(capturedListGroups).length > 1 && (
                    <Tabs
                      value={selectedCapturedList}
                      onChange={(_, value) => setSelectedCapturedList(value)}
                      variant="scrollable"
                      scrollButtons="auto"
                      sx={{
                        minHeight: 36,
                        mb: 3,
                        flexShrink: 0,
                        '& .MuiTab-root': {
                          minHeight: 36, paddingX: 2, paddingY: 1.5, minWidth: 0,
                          color: theme => `${theme.palette.mode === 'dark' ? '#fff' : '#000'} !important`,
                        },
                        '& .MuiTabs-indicator': { height: 2 },
                      }}
                    >
                      {Object.keys(capturedListGroups).map((name) => (
                        <Tab key={name} value={name} label={name} sx={{ minHeight: 36 }} />
                      ))}
                    </Tabs>
                  )}
                  {capturedListColumns.length === 0 ? (
                    <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
                      <Typography color="text.secondary" align="center">
                        No captured list data is available for these runs.
                      </Typography>
                    </Box>
                  ) : (
                    <TableContainer
                      component={Paper}
                      elevation={0}
                      sx={{ maxHeight: '100%', overflow: 'auto', bgcolor: 'background.paper', backgroundImage: 'none' }}
                    >
                      <Table
                        stickyHeader
                        sx={{
                          width: 'max-content',
                          minWidth: '100%',
                          '& .MuiTableCell-root': { px: 3, py: 2, fontSize: '1rem', lineHeight: 1.5 },
                          '& .MuiTableCell-head': { py: 2.5, whiteSpace: 'nowrap', bgcolor: 'background.paper' },
                          '& .MuiTableCell-body': { bgcolor: 'background.paper' },
                        }}
                      >
                        <TableHead>
                          <TableRow>
                            {capturedListColumns.map((column) => (
                              <TableCell key={column} sx={{ fontWeight: 600, minWidth: 190 }}>{column}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {capturedListRows.map((item) => (
                            <TableRow key={item.key} hover>
                              {capturedListColumns.map((column) => {
                                const previous = item.previous?.[column];
                                const current = item.current?.[column];
                                const changed = !valuesEqual(previous, current);
                                return (
                                  <TableCell
                                    key={column}
                                    sx={{
                                      minWidth: 190,
                                      maxWidth: 360,
                                      verticalAlign: 'middle',
                                      bgcolor: changed
                                        ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.16 : 0.2)
                                        : 'background.paper',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {!changed ? displayCapturedValue(current) : (
                                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75 }}>
                                        {item.previous && (
                                          <Typography component="span" sx={{ color: 'error.main', textDecoration: 'line-through', fontSize: 'inherit' }}>
                                            {displayCapturedValue(previous)}
                                          </Typography>
                                        )}
                                        {item.current && (
                                          <Typography component="span" sx={{ color: 'success.main', fontWeight: 600, fontSize: 'inherit' }}>
                                            {displayCapturedValue(current)}
                                          </Typography>
                                        )}
                                      </Box>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Box>
              ) : selectedScreenshot ? (
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {selectedScreenshot.metadata && (
                    <Typography variant="body2" align="center" sx={{ mb: 2 }}>
                      {selectedScreenshot.metadata.changedPercentage.toFixed(2)}% of compared pixels changed
                      {' · '}
                      Previous {selectedScreenshot.metadata.previousWidth}×{selectedScreenshot.metadata.previousHeight}
                      {' · '}
                      Current {selectedScreenshot.metadata.currentWidth}×{selectedScreenshot.metadata.currentHeight}
                    </Typography>
                  )}
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                    {[
                      { label: 'Previous Run', source: selectedScreenshot.previous },
                      { label: 'Current Run', source: selectedScreenshot.current },
                    ].map((image) => (
                      <Box key={image.label}>
                        <Typography variant="subtitle2" align="center" gutterBottom>{image.label}</Typography>
                        {getDiffImageSrc(image.source) ? (
                          <Box component="img" src={getDiffImageSrc(image.source)} alt={image.label} sx={{ display: 'block', width: '100%', height: 'auto', border: `1px solid ${theme.palette.divider}` }} />
                        ) : (
                          <Typography align="center" color="text.secondary">Screenshot unavailable</Typography>
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
                        <Typography align="center" color="text.secondary" sx={{ mt: 4 }}>
                          A highlighted visual diff was not generated for this run. Run the robot again to create one with the updated comparison.
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </Box>
              ) : !hasDiff ? (
                <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
                  <Typography color="text.secondary">
                    {t('runs_table.run_diff.no_changes', { defaultValue: 'No differences found between these runs.' })}
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
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
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default RunDiffPage;