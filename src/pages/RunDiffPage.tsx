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
    diffParts, hasDiff, diffOptions,
    capturedGroups, capturedTableRows, capturedListGroups, capturedListRows, capturedListColumns,
  } = useRunDiff(runId);

  return (
    <Box sx={{ minHeight: '100vh', width: '100%', minWidth: 0, overflowX: 'hidden', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 3, py: 2 }}>
        <IconButton onClick={() => navigate(-1)} aria-label="back" sx={{
          color: theme.palette.text.primary,
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
        }}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6">
          {t('runs_table.run_diff.title', { defaultValue: 'Monitoring' })}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', px: 3, py: 3, minHeight: 0 }}>
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
              value={selectedDiffFormat}
              onChange={(_, value) => setSelectedDiffFormat(value)}
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
              {diffOptions.map((option) => (
                <Tab key={option.key} value={option.key} label={option.label} />
              ))}
            </Tabs>

            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
              ) : !hasDiff ? (
                <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
                  <Typography color="text.secondary">
                    {t('runs_table.run_diff.no_changes', { defaultValue: 'No differences found between these runs.' })}
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', gap: 2, flex: 1, minWidth: 0, minHeight: 0 }}>
                  <Box sx={{ flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="subtitle2" align="center" gutterBottom>
                      {t('runs_table.run_diff.previous_run', { defaultValue: 'Previous Run' })}
                    </Typography>
                    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                      <Box component="pre" sx={{ whiteSpace: 'pre', fontFamily: 'monospace', fontSize: 13, m: 0 }}>
                        {diffParts.map((part, i) => part.added ? null : (
                          <Box key={i} component="span" sx={{ display: 'block', backgroundColor: part.removed ? alpha(theme.palette.error.main, 0.12) : 'transparent' }}>
                            {part.value}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="subtitle2" align="center" gutterBottom>
                      {t('runs_table.run_diff.current_run', { defaultValue: 'Current Run' })}
                    </Typography>
                    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                      <Box component="pre" sx={{ whiteSpace: 'pre', fontFamily: 'monospace', fontSize: 13, m: 0 }}>
                        {diffParts.map((part, i) => part.removed ? null : (
                          <Box key={i} component="span" sx={{ display: 'block', backgroundColor: part.added ? alpha(theme.palette.success.main, 0.12) : 'transparent' }}>
                            {part.value}
                          </Box>
                        ))}
                      </Box>
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
