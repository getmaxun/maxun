import { useEffect, useRef, useState } from "react";
import * as React from "react";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import { Box, Collapse, IconButton, Typography, Chip, TextField } from "@mui/material";
import { Button } from "@mui/material";
import { DeleteForever, KeyboardArrowDown, KeyboardArrowUp, Settings } from "@mui/icons-material";
import { deleteRunFromStorage } from "../../api/storage";
import { columns, Data } from "./RunsTable";
import { RunContent } from "./RunContent";
import { GenericModal } from "../ui/GenericModal";
import { getUserById } from "../../api/auth";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import { io, Socket } from "socket.io-client";
import { remoteBrowserApiUrl } from "../../apiConfig";

const socketCache = new Map<string, Socket>();
const progressCallbacks = new Map<string, Set<(data: any) => void>>();

function getOrCreateSocket(browserId: string): Socket {
  if (socketCache.has(browserId)) {
    return socketCache.get(browserId)!;
  }

  const socket = io(`${remoteBrowserApiUrl}/${browserId}`, {
    transports: ["websocket"],
    rejectUnauthorized: false
  });

  socket.on('workflowProgress', (data: any) => {
    const callbacks = progressCallbacks.get(browserId);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  });

  socketCache.set(browserId, socket);
  return socket;
}

function cleanupSocketIfUnused(browserId: string) {
  const callbacks = progressCallbacks.get(browserId);

  if (!callbacks || callbacks.size === 0) {
    const socket = socketCache.get(browserId);
    if (socket) {
      socket.disconnect();
      socketCache.delete(browserId);
      progressCallbacks.delete(browserId);
    }
  }
}

interface RunTypeChipProps {
  runByUserId?: string;
  runByScheduledId?: string;
  runByAPI: boolean;
}

const RunTypeChip: React.FC<RunTypeChipProps> = ({ runByUserId, runByScheduledId, runByAPI }) => {
  const { t } = useTranslation();

  if (runByScheduledId) return <Chip label={t('runs_table.run_type_chips.scheduled_run')} color="primary" variant="outlined" />;
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
  const runByLabel = row.runByScheduleId
    ?  `${row.runByScheduleId}` 
    : row.runByUserId
      ? `${userEmail}`
      : row.runByAPI
        ? 'API'
        : 'Unknown';
  
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const [workflowProgress, setWorkflowProgress] = useState<{
    current: number;
    total: number;
    percentage: number;
  } | null>(null);

  // Subscribe to progress updates using module-level socket cache
  useEffect(() => {
    if (!row.browserId) return;

    // Get or create socket (from module cache)
    getOrCreateSocket(row.browserId);

    // Register callback
    if (!progressCallbacks.has(row.browserId)) {
      progressCallbacks.set(row.browserId, new Set());
    }

    const callback = (data: any) => {
      setWorkflowProgress(data);
    };

    progressCallbacks.get(row.browserId)!.add(callback);

    // Cleanup: remove callback and cleanup socket if no callbacks remain
    return () => {
      const callbacks = progressCallbacks.get(row.browserId);
      if (callbacks) {
        callbacks.delete(callback);
        // Cleanup socket if this was the last callback
        cleanupSocketIfUnused(row.browserId);
      }
    };
  }, [row.browserId]);

  // Clear progress UI when run completes and trigger socket cleanup
  useEffect(() => {
    if (row.status !== 'running' && row.status !== 'queued') {
      setWorkflowProgress(null);
      // Attempt to cleanup socket when run completes
      // (will only cleanup if no other callbacks exist)
      if (row.browserId) {
        cleanupSocketIfUnused(row.browserId);
      }
    }
  }, [row.status, row.browserId]);

  const handleAbort = () => {
    abortRunHandler(row.runId, row.name, row.browserId);
  }

  const handleRowExpand = () => {
    const newOpen = !isOpen;
    onToggleExpanded(newOpen);
  };

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
                    <GenericModal
                      isOpen={openSettingsModal}
                      onClose={() => setOpenSettingsModal(false)}
                      modalStyle={modalStyle}
                    >
                      <>
                        <Typography variant="h5" style={{ marginBottom: '20px' }}>
                          {t('runs_table.run_settings_modal.title')}
                        </Typography>
                        <Box style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                          <TextField
                            label={t('runs_table.run_settings_modal.labels.run_id')}
                            value={row.runId}
                            InputProps={{ readOnly: true }}
                          />
                          <TextField
                            label={
                              row.runByScheduleId
                                ? t('runs_table.run_settings_modal.labels.run_by_schedule') 
                                : row.runByUserId
                                  ? t('runs_table.run_settings_modal.labels.run_by_user')
                                  : t('runs_table.run_settings_modal.labels.run_by_api')
                            }
                            value={runByLabel}
                            InputProps={{ readOnly: true }}
                          />
                          <Box style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Typography variant="body1">
                              {t('runs_table.run_settings_modal.labels.run_type')}:
                            </Typography>
                            <RunTypeChip
                              runByUserId={row.runByUserId}
                              runByScheduledId={row.runByScheduleId}
                              runByAPI={row.runByAPI ?? false}
                            />
                          </Box>
                        </Box>
                      </>
                    </GenericModal>
                  </TableCell>
                )
              default:
                return null;
            }
          }
        })}
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
          <Collapse in={isOpen} timeout="auto" unmountOnExit>
            <RunContent row={row} abortRunHandler={handleAbort} currentLog={currentLog}
              logEndRef={logEndRef} interpretationInProgress={runningRecordingName === row.name}
              workflowProgress={workflowProgress} />
          </Collapse>
        </TableCell>
      </TableRow>

      <GenericModal isOpen={isDeleteOpen} onClose={() => setDeleteOpen(false)} modalStyle={{ ...modalStyle, padding: 0, backgroundColor: 'transparent', width: 'auto', maxWidth: '520px' }}>
        <Box sx={{ padding: theme.spacing(3), borderRadius: 2, backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.background.paper, color: theme.palette.text.primary, width: { xs: '90vw', sm: '460px', md: '420px' }, maxWidth: '90vw', boxSizing: 'border-box', mx: 'auto' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('runs_table.delete_confirm.title', {
              name: row.name,
              defaultValue: 'Delete run "{{name}}"?'
            })}
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('runs_table.delete_confirm.message', {
              name: row.name,
              defaultValue: 'Are you sure you want to delete the run "{{name}}"?'
            })}
          </Typography>
          <Box display="flex" justifyContent="flex-end" gap={1}>
            <Button onClick={() => setDeleteOpen(false)} variant="outlined">
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              onClick={handleConfirmDelete} variant="contained" color="primary" sx={{ '&:hover': { backgroundColor: theme.palette.primary.dark } }}>
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </Box>
        </Box>
      </GenericModal>
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