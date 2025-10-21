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
  FormControlLabel,
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
  MoreHoriz,
  Refresh
} from "@mui/icons-material";
import { useGlobalInfoStore, useCachedRecordings } from "../../context/globalInfo";
import { checkRunsForRecording, deleteRecordingFromStorage } from "../../api/storage";
import { Add } from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
import { canCreateBrowserInState, getActiveBrowserId, stopRecording } from "../../api/recording";
import { GenericModal } from '../ui/GenericModal';

declare global {
  interface Window {
    openedRecordingWindow?: Window | null;
  }
}

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
                    handleRetrain={() =>handlers.handleRetrainRobot(row.id, row.name)}
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
  const { data: recordingsData = [], isLoading: isFetching, error, refetch } = useCachedRecordings();
  const [isModalOpen, setModalOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [isWarningModalOpen, setWarningModalOpen] = React.useState(false);
  const [activeBrowserId, setActiveBrowserId] = React.useState('');

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
    rerenderRobots,
    setRerenderRobots,
    recordingName,
    setRecordingName,
    recordingId,
    setRecordingId } = useGlobalInfoStore();
  const navigate = useNavigate();

  useEffect(() => {
    const handleMessage = (event: any) => {
      if (event.origin === window.location.origin && event.data && event.data.type === 'recording-notification') {
        const notificationData = event.data.notification;
        if (notificationData) {
          notify(notificationData.type, notificationData.message);
          
          if ((notificationData.type === 'success' && 
               (notificationData.message.includes('saved') || notificationData.message.includes('retrained'))) ||
              (notificationData.type === 'warning' && 
               notificationData.message.includes('terminated'))) {
            setRerenderRobots(true);
          }
        }
      }

      if (event.origin === window.location.origin && event.data && event.data.type === 'session-data-clear') {
        window.sessionStorage.removeItem('browserId');
        window.sessionStorage.removeItem('robotToRetrain');
        window.sessionStorage.removeItem('robotName');
        window.sessionStorage.removeItem('recordingUrl');
        window.sessionStorage.removeItem('recordingSessionId');
        window.sessionStorage.removeItem('pendingSessionData');
        window.sessionStorage.removeItem('nextTabIsRecording');
        window.sessionStorage.removeItem('initialUrl');
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [notify, setRerenderRobots]);

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

  const rows = useMemo(() => {
    if (!recordingsData) return [];

    const parsedRows = recordingsData
      .map((recording: any, index: number) => {
        if (recording?.recording_meta) {
          const parsedDate = parseDateString(recording.recording_meta.updatedAt);

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

    return parsedRows;
  }, [recordingsData]);

  useEffect(() => {
    if (rows.length > 0) {
      setRecordings(rows.map((recording) => recording.name));
    }
  }, [rows, setRecordings]);


  const handleNewRecording = useCallback(async () => {
    navigate('/robots/create');
  }, [navigate]);

  const notifyRecordingTabsToClose = (browserId: string) => {
    const closeMessage = {
      action: 'close-recording-tab',
      browserId: browserId,
      timestamp: Date.now()
    };
    window.sessionStorage.setItem('recordingTabCloseMessage', JSON.stringify(closeMessage));
    
    if (window.openedRecordingWindow && !window.openedRecordingWindow.closed) {
      try {
        window.openedRecordingWindow.close();
      } catch (e) {
        console.log('Could not directly close recording window:', e);
      }
    }
  };

  const handleDiscardAndCreate = async () => {
    if (activeBrowserId) {
      await stopRecording(activeBrowserId);
      notify('warning', t('browser_recording.notifications.terminated'));
      
      notifyRecordingTabsToClose(activeBrowserId);
    }
    
    setWarningModalOpen(false);
    setModalOpen(true);
  };

  const handleRetrainRobot = useCallback(async (id: string, name: string) => {
    const robot = rows.find(row => row.id === id);
    let targetUrl;
    
    if (robot?.content?.workflow && robot.content.workflow.length > 0) {
      const lastPair = robot.content.workflow[robot.content.workflow.length - 1];
      
      if (lastPair?.what) {
        if (Array.isArray(lastPair.what)) {
          const gotoAction = lastPair.what.find((action: any) => 
            action && typeof action === 'object' && 'action' in action && action.action === "goto"
          ) as any;
          
          if (gotoAction?.args?.[0]) {
            targetUrl = gotoAction.args[0];
          }
        }
      }
    }
    
    if (targetUrl) {
      setInitialUrl(targetUrl);
      setRecordingUrl(targetUrl);
      window.sessionStorage.setItem('initialUrl', targetUrl);
    }
    
    const canCreateRecording = await canCreateBrowserInState("recording");
    
    if (!canCreateRecording) {
      const activeBrowserId = await getActiveBrowserId();
      if (activeBrowserId) {
        setActiveBrowserId(activeBrowserId);
        setWarningModalOpen(true);
      } else {
        notify('warning', t('recordingtable.notifications.browser_limit_warning'));
      }
    } else {
        startRetrainRecording(id, name, targetUrl);
    }
  }, [rows, setInitialUrl, setRecordingUrl]);

  const startRetrainRecording = (id: string, name: string, url?: string) => {
    setBrowserId('new-recording');
    setRecordingName(name);  
    setRecordingId(id);      
    
    window.sessionStorage.setItem('browserId', 'new-recording');
    window.sessionStorage.setItem('robotToRetrain', id);
    window.sessionStorage.setItem('robotName', name);
    
    window.sessionStorage.setItem('recordingUrl', url || recordingUrl);
    
    const sessionId = Date.now().toString();
    window.sessionStorage.setItem('recordingSessionId', sessionId);
    
    window.openedRecordingWindow = window.open(`/recording-setup?session=${sessionId}`, '_blank');
    
    window.sessionStorage.setItem('nextTabIsRecording', 'true');
  };

  const startRecording = () => {
    setModalOpen(false);
    
    // Set local state
    setBrowserId('new-recording');
    setRecordingName('');
    setRecordingId('');
    
    window.sessionStorage.setItem('browserId', 'new-recording');
    
    const sessionId = Date.now().toString();
    window.sessionStorage.setItem('recordingSessionId', sessionId);
    window.sessionStorage.setItem('recordingUrl', recordingUrl);
    
    window.openedRecordingWindow = window.open(`/recording-setup?session=${sessionId}`, '_blank');
    
    window.sessionStorage.setItem('nextTabIsRecording', 'true');
  };

  const setBrowserRecordingUrl = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInitialUrl(event.target.value);
    setRecordingUrl(event.target.value);

    window.sessionStorage.setItem('initialUrl', event.target.value);
  }

  useEffect(() => {
    if (rerenderRobots) {
      refetch();
      setRerenderRobots(false);
    }
  }, [rerenderRobots, setRerenderRobots, refetch]);

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
    handleRetrainRobot,
    handleDelete: async (id: string) => {
      const hasRuns = await checkRunsForRecording(id);
      if (hasRuns) {
        notify('warning', t('recordingtable.notifications.delete_warning'));
        return;
      }

      const success = await deleteRecordingFromStorage(id);
      if (success) {
        notify('success', t('recordingtable.notifications.delete_success'));
        refetch();
      }
    }
  }), [handleRunRecording, handleScheduleRecording, handleIntegrateRecording, handleSettingsRecording, handleEditRobot, handleDuplicateRobot, handleRetrainRobot, notify, t, refetch]);

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
      ) : filteredRows.length === 0 ? (
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
            {debouncedSearchTerm ? t('recordingtable.placeholder.search') : t('recordingtable.placeholder.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {debouncedSearchTerm 
              ? t('recordingtable.search_criteria')
              : t('recordingtable.placeholder.body')
            }
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden', marginTop: '15px' }}>
            <Table stickyHeader aria-label="sticky table">
              {/* <TableHead> */}
                <TableRow>
                  {columns.map((column) => (
                    <MemoizedTableCell
                      key={column.id}
                      style={{ minWidth: column.minWidth }}
                    >
                      {column.label}
                    </MemoizedTableCell>
                  ))}
                </TableRow>
              {/* </TableHead> */}
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

          <TablePagination
            rowsPerPageOptions={[10, 25, 50, 100]}
            component="div"
            count={filteredRows.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        </>
      )}
      <GenericModal isOpen={isWarningModalOpen} onClose={() => setWarningModalOpen(false)} modalStyle={modalStyle}>
        <div style={{ padding: '10px' }}>
          <Typography variant="h6" gutterBottom>{t('recordingtable.warning_modal.title')}</Typography>
          <Typography variant="body1" style={{ marginBottom: '20px' }}>
            {t('recordingtable.warning_modal.message')}
          </Typography>
          
          <Box display="flex" justifyContent="space-between" mt={2}>
            <Button
              onClick={handleDiscardAndCreate}
              variant="contained"
              color="error"
            >
              {t('recordingtable.warning_modal.discard_and_create')}
            </Button>
            <Button
              onClick={() => setWarningModalOpen(false)}
              variant="outlined"
            >
              {t('recordingtable.warning_modal.cancel')}
            </Button>
          </Box>
        </div>
      </GenericModal>
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
  handleRetrain: () => void;
  handleEdit: () => void;
  handleDelete: () => void;
  handleDuplicate: () => void;
}

const OptionsButton = ({ handleRetrain, handleEdit, handleDelete, handleDuplicate }: OptionsButtonProps) => {
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
        <MenuItem onClick={() => { handleRetrain(); handleClose(); }}>
          <ListItemIcon>
            <Refresh fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('recordingtable.retrain')}</ListItemText>
        </MenuItem>

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
