import * as React from 'react';
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
import { IconButton, Button, Box, Typography, TextField } from "@mui/material";
import { Schedule, DeleteForever, PlayCircle, Settings, Power, Add } from "@mui/icons-material";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { deleteRecordingFromStorage, getStoredRecordings } from "../../api/storage";
import { useNavigate } from 'react-router-dom';
import { stopRecording } from "../../api/recording";
import { GenericModal } from '../atoms/GenericModal';

interface Column {
  id: 'interpret' | 'name' | 'delete' | 'schedule' | 'integrate' | 'settings';
  label: string;
  minWidth?: number;
  align?: 'right';
  format?: (value: string) => string;
}

const columns: readonly Column[] = [
  { id: 'interpret', label: 'Run', minWidth: 80 },
  { id: 'name', label: 'Name', minWidth: 80 },
  {
    id: 'schedule',
    label: 'Schedule',
    minWidth: 80,
  },
  {
    id: 'integrate',
    label: 'Integrate',
    minWidth: 80,
  },
  {
    id: 'settings',
    label: 'Settings',
    minWidth: 80,
  },
  {
    id: 'delete',
    label: 'Delete',
    minWidth: 80,
  },
];

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
}

export const RecordingsTable = ({ handleEditRecording, handleRunRecording, handleScheduleRecording, handleIntegrateRecording, handleSettingsRecording }: RecordingsTableProps) => {
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [rows, setRows] = React.useState<Data[]>([]);
  const [isModalOpen, setModalOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState(''); // State for search query

  const { notify, setRecordings, browserId, setBrowserId, recordingUrl, setRecordingUrl, recordingName, setRecordingName, recordingId, setRecordingId } = useGlobalInfoStore();
  const navigate = useNavigate();

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
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

  useEffect(() => {
    if (rows.length === 0) {
      fetchRecordings();
    }
  }, []);

  // Filtered rows based on search query
  const filteredRows = rows.filter((row) =>
    row.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <React.Fragment>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6" gutterBottom>
          My Robots
        </Typography>
        <TextField
            label="Search Robots"
            variant="outlined"
            size="small"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            
          />
        
        <IconButton
          aria-label="new"
          size="small"
          onClick={handleNewRecording}
          sx={{
            width: '140px',
            borderRadius: '5px',
            padding: '8px',
            background: '#ff00c3',
            color: 'white',
            fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
            fontWeight: '500',
            fontSize: '0.875rem',
            lineHeight: '1.75',
            letterSpacing: '0.02857em',
            '&:hover': { color: 'white', backgroundColor: '#ff00c3' }
          }}
        >
          <Add sx={{ marginRight: '5px' }} /> Create Robot
        </IconButton>
      </Box>
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
                          case 'delete':
                            return (
                              <TableCell key={column.id} align={column.align}>
                                <IconButton aria-label="delete" size="small" onClick={() => {
                                  deleteRecordingFromStorage(row.id).then((result: boolean) => {
                                    if (result) {
                                      setRows([]);
                                      notify('success', 'Recording deleted successfully');
                                      fetchRecordings();
                                    }
                                  })
                                }}>
                                  <DeleteForever />
                                </IconButton>
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
              : (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    No robots found.
                  </TableCell>
                </TableRow>
              )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[10, 25, 100]}
        component="div"
        count={filteredRows.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
      <GenericModal
  isOpen={isModalOpen} onClose={() => setModalOpen(false)} modalStyle={modalStyle}
  
>
  <Box display="flex" flexDirection="column" alignItems="center">
    {/* URL Input Field */}
    <TextField
      label="Enter Robot URL"
      variant="outlined"
      value={recordingUrl}
      onChange={(e) => setRecordingUrl(e.target.value)}
      fullWidth
      sx={{ marginBottom: '20px' }}
      autoFocus
    />
    
    {/* Start Recording Button */}
    <Button
      onClick={startRecording}
      sx={{
        backgroundColor: '#ff00c3',
        color: '#fff',
        '&:hover': {
          backgroundColor: '#ff00c3',
          color: '#fff',
        },
        borderRadius: '5px',
        padding: '10px 20px',
      }}
    >
      Start New Recording
    </Button>
  </Box>
</GenericModal>

    </React.Fragment>
  );
}

const InterpretButton = ({ handleInterpret }: { handleInterpret: () => void }) => {
  return (
    <IconButton aria-label="interpret" size="small" onClick={handleInterpret}>
      <PlayCircle />
    </IconButton>
  );
};

const ScheduleButton = ({ handleSchedule }: { handleSchedule: () => void }) => {
  return (
    <IconButton aria-label="schedule" size="small" onClick={handleSchedule}>
      <Schedule />
    </IconButton>
  );
};

const IntegrateButton = ({ handleIntegrate }: { handleIntegrate: () => void }) => {
  return (
    <IconButton aria-label="integrate" size="small" onClick={handleIntegrate}>
      <Power />
    </IconButton>
  );
};

const SettingsButton = ({ handleSettings }: { handleSettings: () => void }) => {
  return (
    <IconButton aria-label="settings" size="small" onClick={handleSettings}>
      <Settings />
    </IconButton>
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