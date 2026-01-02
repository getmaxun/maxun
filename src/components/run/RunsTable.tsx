import * as React from 'react';
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from 'react-i18next';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { Accordion, AccordionSummary, AccordionDetails, Typography, Box, TextField, Tooltip, CircularProgress } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobalInfoStore, useCachedRuns, useCacheInvalidation } from "../../context/globalInfo";
import { RunSettings } from "./RunSettings";
import { CollapsibleRow } from "./ColapsibleRow";
import { ArrowDownward, ArrowUpward, UnfoldMore } from '@mui/icons-material';
import { io, Socket } from 'socket.io-client';
import { apiUrl } from '../../apiConfig';

export const columns: readonly Column[] = [
  { id: 'runStatus', label: 'Status', minWidth: 80 },
  { id: 'name', label: 'Name', minWidth: 80 },
  { id: 'startedAt', label: 'Started At', minWidth: 80 },
  { id: 'finishedAt', label: 'Finished At', minWidth: 80 },
  { id: 'settings', label: 'Settings', minWidth: 80 },
  { id: 'delete', label: 'Delete', minWidth: 80 },
];

type SortDirection = 'asc' | 'desc' | 'none';

interface AccordionSortConfig {
  [robotMetaId: string]: {
    field: keyof Data | null;
    direction: SortDirection;
  };
}

interface Column {
  id: 'runStatus' | 'name' | 'startedAt' | 'finishedAt' | 'delete' | 'settings';
  label: string;
  minWidth?: number;
  align?: 'right';
  format?: (value: string) => string;
}

export interface Data {
  id: number;
  status: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  runByUserId?: string;
  runByScheduleId?: string;
  browserId: string;
  runByAPI?: boolean;
  runBySDK?: boolean;
  log: string;
  runId: string;
  robotId: string;
  robotMetaId: string;
  interpreterSettings: RunSettings;
  serializableOutput: any;
  binaryOutput: any;
}

interface RunsTableProps {
  currentInterpretationLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  runId: string;
  runningRecordingName: string;
}

interface PaginationState {
  [robotMetaId: string]: {
    page: number;
    rowsPerPage: number;
  };
}

export const RunsTable: React.FC<RunsTableProps> = ({
  currentInterpretationLog,
  abortRunHandler,
  runId,
  runningRecordingName
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const getUrlParams = () => {
    const match = location.pathname.match(/\/runs\/([^\/]+)(?:\/run\/([^\/]+))?/);
    return {
      robotMetaId: match?.[1] || null,
      urlRunId: match?.[2] || null
    };
  };

  const { robotMetaId: urlRobotMetaId, urlRunId } = getUrlParams();

  const isAccordionExpanded = useCallback((currentRobotMetaId: string) => {
    return currentRobotMetaId === urlRobotMetaId;
  }, [urlRobotMetaId]);

  const [accordionPage, setAccordionPage] = useState(0);
  const [accordionsPerPage, setAccordionsPerPage] = useState(10);
  const [accordionSortConfigs, setAccordionSortConfigs] = useState<AccordionSortConfig>({});

  const handleSort = useCallback((columnId: keyof Data, robotMetaId: string) => {
    setAccordionSortConfigs(prevConfigs => {
      const currentConfig = prevConfigs[robotMetaId] || { field: null, direction: 'none' };
      const newDirection: SortDirection = 
        currentConfig.field !== columnId ? 'asc' :
        currentConfig.direction === 'none' ? 'asc' :
        currentConfig.direction === 'asc' ? 'desc' : 'none';

      return {
        ...prevConfigs,
        [robotMetaId]: {
          field: newDirection === 'none' ? null : columnId,
          direction: newDirection,
        }
      };
    });
  }, []);

  const translatedColumns = useMemo(() => 
    columns.map(column => ({
      ...column,
      label: t(`runstable.${column.id}`, column.label)
    })),
    [t]
  );

  const { notify, rerenderRuns, setRerenderRuns } = useGlobalInfoStore();
  const { data: rows = [], isLoading: isFetching, error, refetch } = useCachedRuns();
  const { invalidateRuns } = useCacheInvalidation();
  
  const activeSocketsRef = useRef<Map<string, Socket>>(new Map());

  const [searchTerm, setSearchTerm] = useState('');
  const [paginationStates, setPaginationStates] = useState<PaginationState>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(new Set());

  const handleAccordionChange = useCallback((robotMetaId: string, isExpanded: boolean) => {
    setExpandedAccordions(prev => {
      const newSet = new Set(prev);
      if (isExpanded) {
        newSet.add(robotMetaId);
      } else {
        newSet.delete(robotMetaId);
      }
      return newSet;
    });
    
    navigate(isExpanded ? `/runs/${robotMetaId}` : '/runs');
  }, [navigate]);

  const handleRowExpand = useCallback((runId: string, robotMetaId: string, shouldExpand: boolean) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (shouldExpand) {
        newSet.add(runId);
      } else {
        newSet.delete(runId);
      }
      return newSet;
    });
    
    // Update URL navigation
    navigate(
      shouldExpand 
        ? `/runs/${robotMetaId}/run/${runId}`
        : `/runs/${robotMetaId}`
    );
  }, [navigate]);

  // Sync expandedRows and expandedAccordions with URL params
  useEffect(() => {
    if (urlRunId) {
      setExpandedRows(prev => {
        const newSet = new Set(prev);
        newSet.add(urlRunId);
        return newSet;
      });
    }
    
    if (urlRobotMetaId) {
      setExpandedAccordions(prev => {
        const newSet = new Set(prev);
        newSet.add(urlRobotMetaId);
        return newSet;
      });
    }
  }, [urlRunId, urlRobotMetaId]);

  // Auto-expand currently running robot (but allow manual collapse)
  useEffect(() => {
    if (runId && runningRecordingName) {
      const currentRunningRow = rows.find(row => 
        row.runId === runId && row.name === runningRecordingName
      );
      
      if (currentRunningRow) {
        setExpandedRows(prev => {
          const newSet = new Set(prev);
          newSet.add(currentRunningRow.runId);
          return newSet;
        });
      }
    }
  }, [runId, runningRecordingName, rows]);

  const handleAccordionPageChange = useCallback((event: unknown, newPage: number) => {
    setAccordionPage(newPage);
  }, []);
  
  const handleAccordionsPerPageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setAccordionsPerPage(+event.target.value);
    setAccordionPage(0); 
  }, []);

  const handleChangePage = useCallback((robotMetaId: string, newPage: number) => {
    setPaginationStates(prev => ({
      ...prev,
      [robotMetaId]: {
        ...prev[robotMetaId],
        page: newPage
      }
    }));
  }, []);

  const handleChangeRowsPerPage = useCallback((robotMetaId: string, newRowsPerPage: number) => {
    setPaginationStates(prev => ({
      ...prev,
      [robotMetaId]: {
        page: 0, // Reset to first page when changing rows per page
        rowsPerPage: newRowsPerPage
      }
    }));
  }, []);

  const getPaginationState = useCallback((robotMetaId: string) => {
    const defaultState = { page: 0, rowsPerPage: 10 };
    
    if (!paginationStates[robotMetaId]) {
      setTimeout(() => {
        setPaginationStates(prev => ({
          ...prev,
          [robotMetaId]: defaultState
        }));
      }, 0);
      return defaultState;
    }
    return paginationStates[robotMetaId];
  }, [paginationStates]);

  const debouncedSearch = useCallback((fn: Function, delay: number) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }, []);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const debouncedSetSearch = debouncedSearch((value: string) => {
      setSearchTerm(value);
      setAccordionPage(0);
      setPaginationStates(prev => {
        const reset = Object.keys(prev).reduce((acc, robotId) => ({
          ...acc,
          [robotId]: { ...prev[robotId], page: 0 }
        }), {});
        return reset;
      });
    }, 300);
    debouncedSetSearch(event.target.value);
  }, [debouncedSearch]);


  // Handle rerender requests using cache invalidation
  useEffect(() => {
    if (rerenderRuns) {
      // Invalidate cache to force refetch
      refetch();
      setRerenderRuns(false);
    }
  }, [rerenderRuns, refetch, setRerenderRuns]);

  useEffect(() => {
    if (!rows || rows.length === 0) return;

    const activeRuns = rows.filter((row: Data) => 
      row.status === 'running' && row.browserId && row.browserId.trim() !== ''
    );

    activeRuns.forEach((run: Data) => {
      const { browserId, runId: currentRunId, name } = run;
      
      if (activeSocketsRef.current.has(browserId)) {
        return;
      }

      console.log(`[RunsTable] Connecting to browser socket: ${browserId} for run: ${currentRunId}`);

      try {
        const socket = io(`${apiUrl}/${browserId}`, {
          transports: ['websocket'],
          rejectUnauthorized: false
        });

        socket.on('connect', () => {
          console.log(`[RunsTable] Connected to browser ${browserId}`);
        });

        socket.on('debugMessage', (msg: string) => {
          console.log(`[RunsTable] Debug message for ${browserId}:`, msg);
          // Optionally update logs in real-time here
        });

        socket.on('run-completed', (data: any) => {
          console.log(`[RunsTable] Run completed for ${browserId}:`, data);
          
          // Invalidate cache to show updated run status
          invalidateRuns();
          setRerenderRuns(true);
          
          // Show notification
          if (data.status === 'success') {
            notify('success', t('main_page.notifications.interpretation_success', { name: data.robotName || name }));
          } else {
            notify('error', t('main_page.notifications.interpretation_failed', { name: data.robotName || name }));
          }
          
          socket.disconnect();
          activeSocketsRef.current.delete(browserId);
        });

        socket.on('urlChanged', (url: string) => {
          console.log(`[RunsTable] URL changed for ${browserId}:`, url);
        });

        socket.on('dom-snapshot-loading', () => {
          console.log(`[RunsTable] DOM snapshot loading for ${browserId}`);
        });

        socket.on('connect_error', (error: Error) => {
          console.error(`[RunsTable] Connection error for browser ${browserId}:`, error.message);
        });

        socket.on('disconnect', (reason: string) => {
          console.log(`[RunsTable] Disconnected from browser ${browserId}:`, reason);
          activeSocketsRef.current.delete(browserId);
        });

        activeSocketsRef.current.set(browserId, socket);
      } catch (error) {
        console.error(`[RunsTable] Error connecting to browser ${browserId}:`, error);
      }
    });

    // Disconnect from sockets for runs that are no longer active
    const activeBrowserIds = new Set(activeRuns.map((run: Data) => run.browserId));
    activeSocketsRef.current.forEach((socket, browserId) => {
      if (!activeBrowserIds.has(browserId)) {
        console.log(`[RunsTable] Disconnecting from inactive browser: ${browserId}`);
        socket.disconnect();
        activeSocketsRef.current.delete(browserId);
      }
    });

    // Cleanup on unmount
    return () => {
      console.log('[RunsTable] Cleaning up all socket connections');
      activeSocketsRef.current.forEach((socket) => {
        socket.disconnect();
      });
      activeSocketsRef.current.clear();
    };
  }, [rows, notify, t, invalidateRuns, setRerenderRuns]);

  const handleDelete = useCallback(() => {
    notify('success', t('runstable.notifications.delete_success'));
    refetch();
  }, [notify, t, refetch]);

  // Filter rows based on search term
  const filteredRows = useMemo(() => {
    let result = rows.filter((row) =>
      row.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return result;
  }, [rows, searchTerm]);

  const parseDateString = (dateStr: string): Date => {
    try {
      if (dateStr.includes('PM') || dateStr.includes('AM')) {
        return new Date(dateStr);
      }
      
      return new Date(dateStr.replace(/(\d+)\/(\d+)\//, '$2/$1/'))
    } catch {
      return new Date(0);
    }
  };

  const groupedRows = useMemo(() => {
    const groupedData = filteredRows.reduce((acc, row) => {
      if (!acc[row.robotMetaId]) {
        acc[row.robotMetaId] = [];
      }
      acc[row.robotMetaId].push(row);
      return acc;
    }, {} as Record<string, Data[]>);
  
    Object.keys(groupedData).forEach(robotId => {
      groupedData[robotId].sort((a: any, b: any) => 
        parseDateString(b.startedAt).getTime() - parseDateString(a.startedAt).getTime()
      );
    });
  
    const robotEntries = Object.entries(groupedData).map(([robotId, runs]) => ({
      robotId,
      runs: runs as Data[],
      latestRunDate: parseDateString((runs as Data[])[0].startedAt).getTime()
    }));
  
    robotEntries.sort((a, b) => b.latestRunDate - a.latestRunDate);
  
    return robotEntries.reduce((acc, { robotId, runs }) => {
      acc[robotId] = runs;
      return acc;
    }, {} as Record<string, Data[]>);
  }, [filteredRows]);

  const renderTableRows = useCallback((data: Data[], robotMetaId: string) => {
    const { page, rowsPerPage } = getPaginationState(robotMetaId);
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;

    let sortedData = [...data];
    const sortConfig = accordionSortConfigs[robotMetaId];
    
    if (sortConfig?.field === 'startedAt' || sortConfig?.field === 'finishedAt') {
      if (sortConfig.direction !== 'none') {
        sortedData.sort((a, b) => {
          const dateA = parseDateString(a[sortConfig.field!]);
          const dateB = parseDateString(b[sortConfig.field!]);
          
          return sortConfig.direction === 'asc' 
            ? dateA.getTime() - dateB.getTime() 
            : dateB.getTime() - dateA.getTime();
        });
      }
    }
    
    return sortedData
      .slice(start, end)
      .map((row) => (
        <CollapsibleRow
          key={`row-${row.id}`}
          row={row}
          handleDelete={handleDelete}
          isOpen={expandedRows.has(row.runId)}
          onToggleExpanded={(shouldExpand) => handleRowExpand(row.runId, row.robotMetaId, shouldExpand)}
          currentLog={currentInterpretationLog}
          abortRunHandler={abortRunHandler}
          runningRecordingName={runningRecordingName}
          urlRunId={urlRunId}
        />
      ));
  }, [paginationStates, runId, runningRecordingName, currentInterpretationLog, abortRunHandler, handleDelete, accordionSortConfigs]);

  const renderSortIcon = useCallback((column: Column, robotMetaId: string) => {
    const sortConfig = accordionSortConfigs[robotMetaId];
    if (column.id !== 'startedAt' && column.id !== 'finishedAt') return null;

    if (sortConfig?.field !== column.id) {
      return (
        <UnfoldMore 
          fontSize="small" 
          sx={{ 
            opacity: 0.3,
            transition: 'opacity 0.2s',
            '.MuiTableCell-root:hover &': {
              opacity: 1
            }
          }} 
        />
      );
    }

    return sortConfig.direction === 'asc' 
      ? <ArrowUpward fontSize="small" />
      : sortConfig.direction === 'desc'
        ? <ArrowDownward fontSize="small" />
        : <UnfoldMore fontSize="small" />;
  }, [accordionSortConfigs]);

  return (
    <React.Fragment>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" component="h2">
          {t('runstable.runs', 'Runs')}
        </Typography>
        <TextField
          size="small"
          placeholder={t('runstable.search', 'Search runs...')}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />
          }}
          sx={{ width: '250px' }}
        />
      </Box>

      {isFetching ? (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          sx={{ 
            minHeight: '60vh',
            width: '100%'
          }}
        >
          <CircularProgress size={60} />
        </Box>
      ) : Object.keys(groupedRows).length === 0 ? (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          sx={{ 
            minHeight: 300, 
            textAlign: 'center',
            color: 'text.secondary' 
          }}
        >
          <Typography variant="h6" gutterBottom>
            {searchTerm ? t('runstable.placeholder.search') : t('runstable.placeholder.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {searchTerm 
              ? t('recordingtable.search_criteria')
              : t('runstable.placeholder.body')
            }
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden' }}>
            {Object.entries(groupedRows)
              .slice(
                accordionPage * accordionsPerPage,
                accordionPage * accordionsPerPage + accordionsPerPage
              )
              .map(([robotMetaId, data]) => (
                <Accordion 
                  key={robotMetaId}
                  expanded={expandedAccordions.has(robotMetaId)}
                  onChange={(event, isExpanded) => handleAccordionChange(robotMetaId, isExpanded)}
                  TransitionProps={{ unmountOnExit: true }} // Optimize accordion rendering
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">{data[data.length - 1].name}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table stickyHeader aria-label="sticky table">
                      <TableHead>
                        <TableRow>
                          <TableCell />
                          {translatedColumns.map((column) => (
                            <TableCell
                              key={column.id}
                              align={column.align}
                              style={{ 
                                minWidth: column.minWidth,
                                cursor: column.id === 'startedAt' || column.id === 'finishedAt' ? 'pointer' : 'default'
                              }}
                              onClick={() => {
                                if (column.id === 'startedAt' || column.id === 'finishedAt') {
                                  handleSort(column.id, robotMetaId);
                                }
                              }}
                            >
                              <Tooltip 
                                title={
                                  (column.id === 'startedAt' || column.id === 'finishedAt')
                                    ? t('runstable.sort_tooltip')
                                    : ''
                                }
                              >
                                <Box sx={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: 1,
                                  '&:hover': {
                                    '& .sort-icon': {
                                      opacity: 1
                                    }
                                  }
                                }}>
                                  {column.label}
                                  <Box className="sort-icon" sx={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: accordionSortConfigs[robotMetaId]?.field === column.id ? 1 : 0.3,
                                    transition: 'opacity 0.2s'
                                  }}>
                                    {renderSortIcon(column, robotMetaId)}
                                  </Box>
                                </Box>
                              </Tooltip>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {renderTableRows(data, robotMetaId)}
                      </TableBody>
                    </Table>

                    <TablePagination
                      component="div"
                      count={data.length}
                      rowsPerPage={getPaginationState(robotMetaId).rowsPerPage}
                      page={getPaginationState(robotMetaId).page}
                      onPageChange={(_, newPage) => handleChangePage(robotMetaId, newPage)}
                      onRowsPerPageChange={(event) => 
                        handleChangeRowsPerPage(robotMetaId, +event.target.value)
                      }
                      rowsPerPageOptions={[10, 25, 50, 100]}
                    />
                  </AccordionDetails>
                </Accordion>
              ))}
          </TableContainer>

          <TablePagination
            component="div"
            count={Object.keys(groupedRows).length}
            page={accordionPage}
            rowsPerPage={accordionsPerPage}
            onPageChange={handleAccordionPageChange}
            onRowsPerPageChange={handleAccordionsPerPageChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </>
      )}
    </React.Fragment>
  );
};