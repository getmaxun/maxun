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
import { modalStyle } from "../recorder/AddWhereCondModal";
import { getUserById } from "../../api/auth";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";

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

  const scrollToLogBottom = () => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }

  const handleAbort = () => {
    abortRunHandler(row.runId, row.name, row.browserId);
  }

  const handleRowExpand = () => {
    const newOpen = !isOpen;
    onToggleExpanded(newOpen);
    //scrollToLogBottom();
  };
  
  // useEffect(() => {
  //   scrollToLogBottom();
  // }, [currentLog])

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
              logEndRef={logEndRef} interpretationInProgress={runningRecordingName === row.name} />
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
