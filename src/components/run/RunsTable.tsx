import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from 'react-i18next';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { Accordion, AccordionSummary, AccordionDetails, Typography, Box, TextField, CircularProgress, Tooltip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { getStoredRuns } from "../../api/storage";
import { RunSettings } from "./RunSettings";
import { CollapsibleRow } from "./ColapsibleRow";
import { ArrowDownward, ArrowUpward, UnfoldMore } from '@mui/icons-material';

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
  runByAPI?: boolean;
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
  abortRunHandler: () => void;
  runId: string;
  runningRecordingName: string;
}

export const RunsTable: React.FC<RunsTableProps> = ({
  currentInterpretationLog,
  abortRunHandler,
  runId,
  runningRecordingName
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [rows, setRows] = useState<Data[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const { notify, rerenderRuns, setRerenderRuns } = useGlobalInfoStore();

  const handleAccordionChange = useCallback((robotMetaId: string, isExpanded: boolean) => {
    navigate(isExpanded ? `/runs/${robotMetaId}` : '/runs');
  }, [navigate]);

  const handleChangePage = useCallback((event: unknown, newPage: number) => {
    setPage(newPage);
  }, []);

  const handleChangeRowsPerPage = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  }, []);

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
      setPage(0);
    }, 300);
    debouncedSetSearch(event.target.value);
  }, [debouncedSearch]);

  const fetchRuns = useCallback(async () => {
    try {
      setIsLoading(true);
      const runs = await getStoredRuns();
      if (runs) {
        const parsedRows: Data[] = runs.map((run: any, index: number) => ({
          id: index,
          ...run,
        }));
        setRows(parsedRows);
      } else {
        notify('error', t('runstable.notifications.no_runs'));
      }
    } catch (error) {
      notify('error', t('runstable.notifications.fetch_error'));
    } finally {
      setIsLoading(false);
    }
  }, [notify, t]);

  useEffect(() => {
    let mounted = true;

    if (rows.length === 0 || rerenderRuns) {
      fetchRuns().then(() => {
        if (mounted) {
          setRerenderRuns(false);
        }
      });
    }

    return () => {
      mounted = false;
    };
  }, [rerenderRuns, rows.length, setRerenderRuns, fetchRuns]);

  const handleDelete = useCallback(() => {
    setRows([]);
    notify('success', t('runstable.notifications.delete_success'));
    fetchRuns();
  }, [notify, t, fetchRuns]);

  // Filter rows based on search term
  const filteredRows = useMemo(() => {
    let result = rows.filter((row) =>
      row.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return result;
  }, [rows, searchTerm]);

  // Group filtered rows by robot meta id
  const groupedRows = useMemo(() => 
    filteredRows.reduce((acc, row) => {
      if (!acc[row.robotMetaId]) {
        acc[row.robotMetaId] = [];
      }
      acc[row.robotMetaId].push(row);
      return acc;
    }, {} as Record<string, Data[]>),
    [filteredRows]
  );

  const renderTableRows = useCallback((data: Data[], robotMetaId: string) => {
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;

    let sortedData = [...data];
    const sortConfig = accordionSortConfigs[robotMetaId];
    
    if (sortConfig?.field === 'startedAt' || sortConfig?.field === 'finishedAt') {
      if (sortConfig.direction !== 'none') {
        sortedData.sort((a, b) => {
          const dateA = new Date(a[sortConfig.field!].replace(/(\d+)\/(\d+)\//, '$2/$1/'));
          const dateB = new Date(b[sortConfig.field!].replace(/(\d+)\/(\d+)\//, '$2/$1/'));
          
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
          isOpen={runId === row.runId && runningRecordingName === row.name}
          currentLog={currentInterpretationLog}
          abortRunHandler={abortRunHandler}
          runningRecordingName={runningRecordingName}
        />
      ));
  }, [page, rowsPerPage, runId, runningRecordingName, currentInterpretationLog, abortRunHandler, handleDelete, accordionSortConfigs]);

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

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="50vh">
        <CircularProgress />
      </Box>
    );
  }

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

      <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden' }}>
        {Object.entries(groupedRows).map(([robotMetaId, data]) => (
          <Accordion 
            key={robotMetaId} 
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
            </AccordionDetails>
          </Accordion>
        ))}
      </TableContainer>

      <TablePagination
        component="div"
        count={filteredRows.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </React.Fragment>
  );
};