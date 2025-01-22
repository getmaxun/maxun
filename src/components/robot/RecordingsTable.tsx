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
import { useEffect } from "react";
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

export const RecordingsTable = ({ handleEditRecording, handleRunRecording, handleScheduleRecording, handleIntegrateRecording, handleSettingsRecording, handleEditRobot, handleDuplicateRobot }: RecordingsTableProps) => {
  const { t } = useTranslation();
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [rows, setRows] = React.useState<Data[]>([]);
  const [isModalOpen, setModalOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');

  const columns: readonly Column[] = [
    { id: 'interpret', label: t('recordingtable.run'), minWidth: 80 },
    { id: 'name', label: t('recordingtable.name'), minWidth: 80 },
    {
      id: 'schedule',
      label: t('recordingtable.schedule'),
      minWidth: 80,
    },
    {
      id: 'integrate',
      label: t('recordingtable.integrate'),
      minWidth: 80,
    },
    {
      id: 'settings',
      label: t('recordingtable.settings'),
      minWidth: 80,
    },
    {
      id: 'options',
      label: t('recordingtable.options'),
      minWidth: 80,
    },
  ];

  const { notify, setRecordings, browserId, setBrowserId, setInitialUrl, recordingUrl, setRecordingUrl, isLogin, setIsLogin, recordingName, setRecordingName, recordingId, setRecordingId } = useGlobalInfoStore();
  const navigate = useNavigate();

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

  const fetchRecordings = async () => {
    const recordings = await getStoredRecordings();
    if (recordings) {
      const parsedRows: Data[] = [];
      recordings.map((recording: any, index: number) => {
        if (recording && recording.recording_meta) {
          parsedRows.push({
            id: index,
            ...recording.recording_meta,
            content: recording.recording
          });
        }
      });
      setRecordings(parsedRows.map((recording) => recording.name));
      setRows(parsedRows);
    } else {
      console.log('No recordings found.');
    }
  }

  const handleNewRecording = async () => {
    if (browserId) {
      setBrowserId(null);
      await stopRecording(browserId);
    }
    setModalOpen(true);
  };

  const handleStartRecording = () => {
    setBrowserId('new-recording');
    setRecordingName('');
    setRecordingId('');
    navigate('/recording');
  }

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
  }, []);


  // Filter rows based on search term
  const filteredRows = rows.filter((row) =>
    row.name.toLowerCase().includes(searchTerm.toLowerCase())
  );


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
      {rows.length === 0 ? (
        <Box display="flex" justifyContent="center" alignItems="center" height="50%">
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden', marginTop: '15px' }}>
          <Table stickyHeader aria-label="sticky table">
            <TableHead>
              <TableRow>
                {columns.map((column) => (
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
              {filteredRows.length !== 0 ? filteredRows
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((row) => {
                  return (
                    <TableRow hover role="checkbox" tabIndex={-1} key={row.id}>
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
                            case 'interpret':
                              return (
                                <TableCell key={column.id} align={column.align}>
                                  <InterpretButton handleInterpret={() => handleRunRecording(row.id, row.name, row.params || [])} />
                                </TableCell>
                              );
                            case 'schedule':
                              return (
                                <TableCell key={column.id} align={column.align}>
                                  <ScheduleButton handleSchedule={() => handleScheduleRecording(row.id, row.name, row.params || [])} />
                                </TableCell>
                              );
                            case 'integrate':
                              return (
                                <TableCell key={column.id} align={column.align}>
                                  <IntegrateButton handleIntegrate={() => handleIntegrateRecording(row.id, row.name, row.params || [])} />
                                </TableCell>
                              );
                            case 'options':
                              return (
                                <TableCell key={column.id} align={column.align}>
                                  <OptionsButton
                                    handleEdit={() => handleEditRobot(row.id, row.name, row.params || [])}
                                    handleDuplicate={() => {
                                      handleDuplicateRobot(row.id, row.name, row.params || []);
                                    }}
                                    handleDelete={() => {

                                      checkRunsForRecording(row.id).then((result: boolean) => {
                                        if (result) {
                                          notify('warning', t('recordingtable.notifications.delete_warning'));
                                        }
                                      })

                                      deleteRecordingFromStorage(row.id).then((result: boolean) => {
                                        if (result) {
                                          setRows([]);
                                          notify('success', t('recordingtable.notifications.delete_success'));
                                          fetchRecordings();
                                        }
                                      })
                                    }}
                                  />
                                </TableCell>
                              );
                            case 'settings':
                              return (
                                <TableCell key={column.id} align={column.align}>
                                  <SettingsButton handleSettings={() => handleSettingsRecording(row.id, row.name, row.params || [])} />
                                </TableCell>
                              );
                            default:
                              return null;
                          }
                        }
                      })}
                    </TableRow>
                  );
                })
                : null}
            </TableBody>
          </Table>
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