import * as React from 'react';
import { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { Accordion, AccordionSummary, AccordionDetails, Typography, Box, TextField } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { getStoredRuns } from "../../api/storage";
import { RunSettings } from "./RunSettings";
import { CollapsibleRow } from "./ColapsibleRow";

export const columns: readonly Column[] = [
  { id: 'runStatus', label: 'Status', minWidth: 80 },
  { id: 'name', label: 'Name', minWidth: 80 },
  { id: 'startedAt', label: 'Started At', minWidth: 80 },
  { id: 'finishedAt', label: 'Finished At', minWidth: 80 },
  { id: 'settings', label: 'Settings', minWidth: 80 },
  { id: 'delete', label: 'Delete', minWidth: 80 },
];

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

  const translatedColumns = columns.map(column => ({
    ...column,
    label: t(`runstable.${column.id}`, column.label)
  }));

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [rows, setRows] = useState<Data[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const { notify, rerenderRuns, setRerenderRuns } = useGlobalInfoStore();

  const handleAccordionChange = (robotMetaId: string, isExpanded: boolean) => {
    if (isExpanded) {
      navigate(`/runs/${robotMetaId}`);
    } else {
      navigate(`/runs`);
    }
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setPage(0);
  };

  const fetchRuns = async () => {
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
  };

  useEffect(() => {
    if (rows.length === 0 || rerenderRuns) {
      fetchRuns();
      setRerenderRuns(false);
    }
  }, [rerenderRuns, rows.length, setRerenderRuns]);

  const handleDelete = () => {
    setRows([]);
    notify('success', t('runstable.notifications.delete_success'));
    fetchRuns();
  };

  // Filter rows based on search term
  const filteredRows = rows.filter((row) =>
    row.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group filtered rows by robot meta id
  const groupedRows = filteredRows.reduce((acc, row) => {
    if (!acc[row.robotMetaId]) {
      acc[row.robotMetaId] = [];
    }
    acc[row.robotMetaId].push(row);
    return acc;
  }, {} as Record<string, Data[]>);

  return (
    <React.Fragment>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" gutterBottom>
          {t('runstable.runs', 'Runs')}
        </Typography>
        <TextField
          size="small"
          placeholder={t('runstable.search', 'Search runs...')}
          value={searchTerm}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />
          }}
          sx={{ width: '250px' }}
        />
      </Box>
      {rows.length === 0 ? (
        <Box display="flex" justifyContent="center" alignItems="center" height="100%">
          <CircularProgress />
        </Box>
      ) : (
      <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden' }}>
        {Object.entries(groupedRows).map(([id, data]) => (
          <Accordion key={id} onChange={(event, isExpanded) => handleAccordionChange(id, isExpanded)}>
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
                        style={{ minWidth: column.minWidth }}
                      >
                        {column.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data
                    .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                    .map((row) => (
                      <CollapsibleRow
                        row={row}
                        handleDelete={handleDelete}
                        key={`row-${row.id}`}
                        isOpen={runId === row.runId && runningRecordingName === row.name}
                        currentLog={currentInterpretationLog}
                        abortRunHandler={abortRunHandler}
                        runningRecordingName={runningRecordingName}
                      />
                    ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ))}
      </TableContainer>
      )}
      <TablePagination
        rowsPerPageOptions={[10, 25, 50]}
        component="div"
        count={filteredRows.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </React.Fragment>
  );
};