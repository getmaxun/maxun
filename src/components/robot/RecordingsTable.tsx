import * as React from 'react';
import { useTranslation } from 'react-i18next';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { memo, useCallback, useEffect, useMemo } from "react";
import { WorkflowFile } from "maxun-core";
import SearchIcon from '@mui/icons-material/Search';
import {
  IconButton,
  Button,
  Box,
  Typography,
  TextField,
  MenuItem,
  Menu,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
} from "@mui/material";
import {
  Schedule,
  DeleteForever,
  Edit,
  PlayCircle,
  Settings,
  Power,
  ContentCopy,
  MoreHoriz
} from "@mui/icons-material";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { checkRunsForRecording, deleteRecordingFromStorage, getStoredRecordings } from "../../api/storage";
import { Add } from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
import { stopRecording } from "../../api/recording";
import { GenericModal } from '../ui/GenericModal';


/** TODO:
 *  1. allow editing existing robot after persisting browser steps
*/

interface Column {
  id: 'interpret' | 'name' | 'options' | 'schedule' | 'integrate' | 'settings';
  label: string;
  minWidth?: number;
  align?: 'right';
  format?: (value: string) => string;
}

interface Data {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  content: WorkflowFile;
  params: string[];
}

interface RecordingsTableProps {
  handleEditRecording: (id: string, fileName: string) => void;
  handleRunRecording: (id: string, fileName: string, params: string[]) => void;
  handleScheduleRecording: (id: string, fileName: string, params: string[]) => void;
  handleIntegrateRecording: (id: string, fileName: string, params: string[]) => void;
  handleSettingsRecording: (id: string, fileName: string, params: string[]) => void;
  handleEditRobot: (id: string, name: string, params: string[]) => void;
  handleDuplicateRobot: (id: string, name: string, params: string[]) => void;
}

// Virtualized row component for efficient rendering
const TableRowMemoized = memo(({ row, columns, handlers }: any) => {
  return (
    <TableRow hover role="checkbox" tabIndex={-1}>
      {columns.map((column: Column) => {
        const value: any = row[column.id];
        if (value !== undefined) {
          return (
            <MemoizedTableCell key={column.id} align={column.align}>
              {value}
            </MemoizedTableCell>
          );
        } else {
          switch (column.id) {
            case 'interpret':
              return (
                <MemoizedTableCell key={column.id} align={column.align}>
                  <MemoizedInterpretButton handleInterpret={() => handlers.handleRunRecording(row.id, row.name, row.params || [])} />
                </MemoizedTableCell>
              );
            case 'schedule':
              return (
                <MemoizedTableCell key={column.id} align={column.align}>
                  <MemoizedScheduleButton handleSchedule={() => handlers.handleScheduleRecording(row.id, row.name, row.params || [])} />
                </MemoizedTableCell>
              );
            case 'integrate':
              return (
                <MemoizedTableCell key={column.id} align={column.align}>
                  <MemoizedIntegrateButton handleIntegrate={() => handlers.handleIntegrateRecording(row.id, row.name, row.params || [])} />
                </MemoizedTableCell>
              );
            case 'options':
              return (
                <MemoizedTableCell key={column.id} align={column.align}>
                  <MemoizedOptionsButton
                    handleEdit={() => handlers.handleEditRobot(row.id, row.name, row.params || [])}
                    handleDuplicate={() => handlers.handleDuplicateRobot(row.id, row.name, row.params || [])}
                    handleDelete={() => handlers.handleDelete(row.id)}
                  />
                </MemoizedTableCell>
              );
            case 'settings':
              return (
                <MemoizedTableCell key={column.id} align={column.align}>
                  <MemoizedSettingsButton handleSettings={() => handlers.handleSettingsRecording(row.id, row.name, row.params || [])} />
                </MemoizedTableCell>
              );
            default:
              return null;
          }
        }
      })}
    </TableRow>
  );
});


export const RecordingsTable = ({
  handleEditRecording,
  handleRunRecording,
  handleScheduleRecording,
  handleIntegrateRecording,
  handleSettingsRecording,
  handleEditRobot,
  handleDuplicateRobot }: RecordingsTableProps) => {
  const { t } = useTranslation();
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [rows, setRows] = React.useState<Data[]>([]);
  const [isModalOpen, setModalOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);

  const columns = useMemo(() => [
    { id: 'interpret', label: t('recordingtable.run'), minWidth: 80 },
    { id: 'name', label: t('recordingtable.name'), minWidth: 80 },
    { id: 'schedule', label: t('recordingtable.schedule'), minWidth: 80 },
    { id: 'integrate', label: t('recordingtable.integrate'), minWidth: 80 },
    { id: 'settings', label: t('recordingtable.settings'), minWidth: 80 },
    { id: 'options', label: t('recordingtable.options'), minWidth: 80 },
  ], [t]);

  const {
    notify,
    setRecordings,
    browserId,
    setBrowserId,
    setInitialUrl,
    recordingUrl,
    setRecordingUrl,
    isLogin,
    setIsLogin,
    recordingName,
    setRecordingName,
    recordingId,
    setRecordingId } = useGlobalInfoStore();
  const navigate = useNavigate();

  const handleChangePage = useCallback((event: unknown, newPage: number) => {
    setPage(newPage);
  }, []);

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  };

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setPage(0);
  }, []);

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

  const fetchRecordings = useCallback(async () => {
    setIsLoading(true);
    try {
      const recordings = await getStoredRecordings();
      if (recordings) {
        const parsedRows = recordings
        .map((recording: any, index: number) => {
          if (recording?.recording_meta) {
            const parsedDate = parseDateString(recording.recording_meta.createdAt);
            
            return {
              id: index,
              ...recording.recording_meta,
              content: recording.recording,
              parsedDate
            };
          }
          return null;
        })
        .filter(Boolean) 
        .sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());

        setRecordings(parsedRows.map((recording) => recording.name));
        setRows(parsedRows);
      }
    } catch (error) {
      console.error('Error fetching recordings:', error);
      notify('error', t('recordingtable.notifications.fetch_error'));
    } finally {
      setIsLoading(false);
    }
  }, [setRecordings, notify, t]);

  const handleNewRecording = useCallback(async () => {
    if (browserId) {
      setBrowserId(null);
      await stopRecording(browserId);
    }
    setModalOpen(true);
  }, [browserId]);

  const handleStartRecording = useCallback(() => {
    setBrowserId('new-recording');
    setRecordingName('');
    setRecordingId('');
    navigate('/recording');
  }, [navigate]);

  const startRecording = () => {
    setModalOpen(false);
    handleStartRecording();
  };

  const setBrowserRecordingUrl = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInitialUrl(event.target.value);
    setRecordingUrl(event.target.value);
  }

  useEffect(() => {
    if (rows.length === 0) {
      fetchRecordings();
    }
  }, [fetchRecordings]);

  function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = React.useState<T>(value);
  
    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
  
      return () => {
        clearTimeout(handler);
      };
    }, [value, delay]);
  
    return debouncedValue;
  }

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Filter rows based on search term
  const filteredRows = useMemo(() => {
    const searchLower = debouncedSearchTerm.toLowerCase();
    return debouncedSearchTerm
      ? rows.filter(row => row.name.toLowerCase().includes(searchLower))
      : rows;
  }, [rows, debouncedSearchTerm]);

  const visibleRows = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredRows.slice(start, start + rowsPerPage);
  }, [filteredRows, page, rowsPerPage]);

  const handlers = useMemo(() => ({
    handleRunRecording,
    handleScheduleRecording,
    handleIntegrateRecording,
    handleSettingsRecording,
    handleEditRobot,
    handleDuplicateRobot,
    handleDelete: async (id: string) => {
      const hasRuns = await checkRunsForRecording(id);
      if (hasRuns) {
        notify('warning', t('recordingtable.notifications.delete_warning'));
        return;
      }

      const success = await deleteRecordingFromStorage(id);
      if (success) {
        setRows([]);
        notify('success', t('recordingtable.notifications.delete_success'));
        fetchRecordings();
      }
    }
  }), [handleRunRecording, handleScheduleRecording, handleIntegrateRecording, handleSettingsRecording, handleEditRobot, handleDuplicateRobot, notify, t]);

  return (
    <React.Fragment>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" gutterBottom>
          {t('recordingtable.heading')}
        </Typography>
        <Box display="flex" alignItems="center" gap={2}>
          <TextField
            size="small"
            placeholder={t('recordingtable.search')}
            value={searchTerm}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: 'action.active', mr: 1 }} />
            }}
            sx={{ width: '250px' }}
          />
          <IconButton
            aria-label="new"
            size={"small"}
            onClick={handleNewRecording}
            sx={{
              width: '140px',
              borderRadius: '5px',
              padding: '8px',
              background: '#ff00c3',
              color: 'white',
              marginRight: '10px',
              fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
              fontWeight: '500',
              fontSize: '0.875rem',
              lineHeight: '1.75',
              letterSpacing: '0.02857em',
              '&:hover': { color: 'white', backgroundColor: '#ff00c3' }
            }}
          >
            <Add sx={{ marginRight: '5px' }} /> {t('recordingtable.new')}
          </IconButton>
        </Box>
      </Box>
      {isLoading ? (
        <Box display="flex" justifyContent="center" alignItems="center" height="50%">
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden', marginTop: '15px' }}>
          <Table stickyHeader aria-label="sticky table">
            <TableHead>
              <TableRow>
                {columns.map((column) => (
                  <MemoizedTableCell
                    key={column.id}
                    // align={column.align}
                    style={{ minWidth: column.minWidth }}
                  >
                    {column.label}
                  </MemoizedTableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRowMemoized
                  key={row.id}
                  row={row}
                  columns={columns}
                  handlers={handlers}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TablePagination
        rowsPerPageOptions={[10, 25, 50, 100]}
        component="div"
        count={filteredRows.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
      <GenericModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} modalStyle={modalStyle}>
        <div style={{ padding: '10px' }}>
          <Typography variant="h6" gutterBottom>{t('recordingtable.modal.title')}</Typography>
          <TextField
            label={t('recordingtable.modal.label')}
            variant="outlined"
            fullWidth
            value={recordingUrl}
            onChange={setBrowserRecordingUrl}
            style={{ marginBottom: '10px', marginTop: '20px' }}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={isLogin}
                onChange={(e) => setIsLogin(e.target.checked)}
                color="primary"
              />
            }
            label={t('recordingtable.modal.login_title')}
            style={{ marginBottom: '10px' }}
          />

          <br />
          <Button
            variant="contained"
            color="primary"
            onClick={startRecording}
            disabled={!recordingUrl}
          >
            {t('recordingtable.modal.button')}
          </Button>
        </div>
      </GenericModal>
    </React.Fragment>
  );
}

interface InterpretButtonProps {
  handleInterpret: () => void;
}

const InterpretButton = ({ handleInterpret }: InterpretButtonProps) => {
  return (
    <IconButton aria-label="add" size="small" onClick={() => {
      handleInterpret();
    }}
    >
      <PlayCircle />
    </IconButton>
  )
}

interface ScheduleButtonProps {
  handleSchedule: () => void;
}

const ScheduleButton = ({ handleSchedule }: ScheduleButtonProps) => {
  return (
    <IconButton aria-label="add" size="small" onClick={() => {
      handleSchedule();
    }}
    >
      <Schedule />
    </IconButton>
  )
}

interface IntegrateButtonProps {
  handleIntegrate: () => void;
}

const IntegrateButton = ({ handleIntegrate }: IntegrateButtonProps) => {
  return (
    <IconButton aria-label="add" size="small" onClick={() => {
      handleIntegrate();
    }}
    >
      <Power />
    </IconButton>
  )
}

interface SettingsButtonProps {
  handleSettings: () => void;
}

const SettingsButton = ({ handleSettings }: SettingsButtonProps) => {
  return (
    <IconButton aria-label="add" size="small" onClick={() => {
      handleSettings();
    }}
    >
      <Settings />
    </IconButton>
  )
}

interface OptionsButtonProps {
  handleEdit: () => void;
  handleDelete: () => void;
  handleDuplicate: () => void;
}

const OptionsButton = ({ handleEdit, handleDelete, handleDuplicate }: OptionsButtonProps) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const { t } = useTranslation();

  return (
    <>
      <IconButton
        aria-label="options"
        size="small"
        onClick={handleClick}
      >
        <MoreHoriz />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
      >
        <MenuItem onClick={() => { handleEdit(); handleClose(); }}>
          <ListItemIcon>
            <Edit fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.edit')}</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => { handleDelete(); handleClose(); }}>
          <ListItemIcon>
            <DeleteForever fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.delete')}</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => { handleDuplicate(); handleClose(); }}>
          <ListItemIcon>
            <ContentCopy fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.duplicate')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

const MemoizedTableCell = memo(TableCell);

// Memoized action buttons
const MemoizedInterpretButton = memo(InterpretButton);
const MemoizedScheduleButton = memo(ScheduleButton);
const MemoizedIntegrateButton = memo(IntegrateButton);
const MemoizedSettingsButton = memo(SettingsButton);
const MemoizedOptionsButton = memo(OptionsButton);

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