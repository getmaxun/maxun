import { useEffect, useRef, useState } from "react";
import * as React from "react";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import { Box, Collapse, IconButton, Typography, Chip, TextField } from "@mui/material";
import { DeleteForever, KeyboardArrowDown, KeyboardArrowUp, Settings } from "@mui/icons-material";
import { deleteRunFromStorage } from "../../api/storage";
import { columns, Data } from "./RunsTable";
import { RunContent } from "./RunContent";
import { GenericModal } from "../ui/GenericModal";
import { modalStyle } from "../recorder/AddWhereCondModal";
import { getUserById } from "../../api/auth";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

interface RunTypeChipProps {
  runByUserId?: string;
  runByScheduledId?: string;
  runByAPI: boolean;
}

const RunTypeChip: React.FC<RunTypeChipProps> = ({ runByUserId, runByScheduledId, runByAPI }) => {
  const { t } = useTranslation();

  if (runByUserId) return <Chip label={t('runs_table.run_type_chips.manual_run')} color="primary" variant="outlined" />;
  if (runByScheduledId) return <Chip label={t('runs_table.run_type_chips.scheduled_run')} color="primary" variant="outlined" />;
  if (runByAPI) return <Chip label={t('runs_table.run_type_chips.api')} color="primary" variant="outlined" />;
  return <Chip label={t('runs_table.run_type_chips.unknown_run_type')} color="primary" variant="outlined" />;
};

interface CollapsibleRowProps {
  row: Data;
  handleDelete: () => void;
  isOpen: boolean;
  currentLog: string;
  abortRunHandler: () => void;
  runningRecordingName: string;
}
export const CollapsibleRow = ({ row, handleDelete, isOpen, currentLog, abortRunHandler, runningRecordingName }: CollapsibleRowProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(isOpen);
  const [openSettingsModal, setOpenSettingsModal] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const runByLabel = row.runByUserId
    ? `${userEmail}`
    : row.runByScheduleId
      ? `${row.runByScheduleId}`
      : row.runByAPI
        ? 'API'
        : 'Unknown';
  
  const { robotMetaId, runId } = useParams();

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToLogBottom = () => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }

  const handleAbort = () => {
    abortRunHandler();
  }

  const handleRowExpand = () => {
    const newOpen = !open;
    setOpen(newOpen);
    if (newOpen) {
      // Navigate to default tab (data) when expanding
      navigate(`/runs/${robotMetaId}/run/${row.runId}`);
    }
    scrollToLogBottom();
  };

  useEffect(() => {
    scrollToLogBottom();
  }, [currentLog])

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

  return (
    <React.Fragment>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }} hover role="checkbox" tabIndex={-1} key={row.id}>
        <TableCell>
          <IconButton
            aria-label="expand row"
            size="small"
            onClick={handleRowExpand}
          >
            {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
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
                    {row.status === 'failed' && <Chip label={t('runs_table.run_status_chips.failed')} color="error" variant="outlined" />}
                  </TableCell>
                )
              case 'delete':
                return (
                  <TableCell key={column.id} align={column.align}>
                    <IconButton aria-label="add" size="small" onClick={() => {
                      deleteRunFromStorage(`${row.runId}`).then((result: boolean) => {
                        if (result) {
                          handleDelete();
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
                              row.runByUserId
                                ? t('runs_table.run_settings_modal.labels.run_by_user')
                                : row.runByScheduleId
                                  ? t('runs_table.run_settings_modal.labels.run_by_schedule')
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
          <Collapse in={open} timeout="auto" unmountOnExit>
            <RunContent row={row} abortRunHandler={handleAbort} currentLog={currentLog}
              logEndRef={logEndRef} interpretationInProgress={runningRecordingName === row.name} />
          </Collapse>
        </TableCell>
      </TableRow>
    </React.Fragment>
  );
}
