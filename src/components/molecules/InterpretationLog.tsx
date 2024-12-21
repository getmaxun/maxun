import * as React from 'react';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Typography from '@mui/material/Typography';
import { Button, TextField, Grid } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from "react";
import { useSocketStore } from "../../context/socket";
import { Buffer } from 'buffer';
import { useBrowserDimensionsStore } from "../../context/browserDimensions";
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import StorageIcon from '@mui/icons-material/Storage';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import { SidePanelHeader } from './SidePanelHeader';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useTranslation } from 'react-i18next';

interface InterpretationLogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const InterpretationLog: React.FC<InterpretationLogProps> = ({ isOpen, setIsOpen }) => {
  const { t } = useTranslation();
  const [log, setLog] = useState<string>('');
  const [customValue, setCustomValue] = useState('');
  const [tableData, setTableData] = useState<any[]>([]);
  const [binaryData, setBinaryData] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const { width } = useBrowserDimensionsStore();
  const { socket } = useSocketStore();
  const { currentWorkflowActionsState, notify } = useGlobalInfoStore();

  const toggleDrawer = (newOpen: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
    if (
      event.type === 'keydown' &&
      ((event as React.KeyboardEvent).key === 'Tab' ||
        (event as React.KeyboardEvent).key === 'Shift')
    ) {
      return;
    }
    setIsOpen(newOpen);
  };

  const scrollLogToBottom = () => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleLog = useCallback((msg: string, date: boolean = true) => {
    if (!date) {
      setLog((prevState) => prevState + '\n' + msg);
    } else {
      setLog((prevState) => prevState + '\n' + `[${new Date().toLocaleString()}] ` + msg);
    }
    scrollLogToBottom();
  }, [log, scrollLogToBottom]);

  const handleSerializableCallback = useCallback((data: any) => {
    setLog((prevState) =>
      prevState + '\n' + t('interpretation_log.data_sections.serializable_received') + '\n'
      + JSON.stringify(data, null, 2) + '\n' + t('interpretation_log.data_sections.separator'));

    if (Array.isArray(data)) {
      setTableData(data);
    }

    scrollLogToBottom();
  }, [log, scrollLogToBottom, t]);

  const handleBinaryCallback = useCallback(({ data, mimetype }: any) => {
    const base64String = Buffer.from(data).toString('base64');
    const imageSrc = `data:${mimetype};base64,${base64String}`;

    setLog((prevState) =>
      prevState + '\n' + t('interpretation_log.data_sections.binary_received') + '\n'
      + t('interpretation_log.data_sections.mimetype') + mimetype + '\n' 
      + t('interpretation_log.data_sections.image_below') + '\n'
      + t('interpretation_log.data_sections.separator'));

    setBinaryData(imageSrc);
    scrollLogToBottom();
  }, [log, scrollLogToBottom, t]);


  const handleCustomValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomValue(event.target.value);
  };

  const handleReset = () => {
    setLog('');
    setTableData([]);
    setBinaryData(null);
    notify("success", t('interpretation_log.notifications.reset_success'));
  };

  useEffect(() => {
    socket?.on('log', handleLog);
    socket?.on('serializableCallback', handleSerializableCallback);
    socket?.on('binaryCallback', handleBinaryCallback);
    return () => {
      socket?.off('log', handleLog);
      socket?.off('serializableCallback', handleSerializableCallback);
      socket?.off('binaryCallback', handleBinaryCallback);
    };
  }, [socket, handleLog, handleSerializableCallback, handleBinaryCallback]);

  // Extract columns dynamically from the first item of tableData
  const columns = tableData.length > 0 ? Object.keys(tableData[0]) : [];

  const { hasScrapeListAction, hasScreenshotAction, hasScrapeSchemaAction } = currentWorkflowActionsState

  useEffect(() => {
    if (hasScrapeListAction || hasScrapeSchemaAction || hasScreenshotAction) {
      setIsOpen(true);
    }
  }, [hasScrapeListAction, hasScrapeSchemaAction, hasScreenshotAction, setIsOpen]);

  return (
    <Grid container>
      <Grid item xs={12} md={9} lg={9}>
        <Button
          onClick={toggleDrawer(true)}
          variant="contained"
          color="primary"
          sx={{
            marginTop: '10px',
            color: 'white',
            position: 'absolute',
            background: '#ff00c3',
            border: 'none',
            padding: '10px 20px',
            width: '900px',
            overflow: 'hidden',
            textAlign: 'left',
            justifyContent: 'flex-start',
            '&:hover': {
              backgroundColor: '#ff00c3',
            },
          }}
        >
          <ArrowUpwardIcon fontSize="inherit" sx={{ marginRight: '10px'}} /> 
          {t('interpretation_log.titles.output_preview')}
        </Button>
        <SwipeableDrawer
          anchor="bottom"
          open={isOpen}
          onClose={toggleDrawer(false)}
          onOpen={toggleDrawer(true)}
          PaperProps={{
            sx: {
              background: 'white',
              color: 'black',
              padding: '10px',
              height: 500,
              width: width - 10,
              display: 'flex',
              borderRadius: '10px 10px 0 0',
            },
          }}
        >
          <Typography variant="h6" gutterBottom style={{ display: 'flex', alignItems: 'center' }}>
            <StorageIcon style={{ marginRight: '8px' }} /> 
            {t('interpretation_log.titles.output_preview')}
          </Typography>
          <div
            style={{
              height: '50vh',
              overflow: 'none',
              padding: '10px',
            }}
          >
            {
              binaryData ? (
                <>
                  <div style={{ marginBottom: '20px' }}>
                    <Typography variant="body1" gutterBottom>
                      {t('interpretation_log.titles.screenshot')}
                    </Typography>
                    <img src={binaryData} alt={t('interpretation_log.titles.screenshot')} style={{ maxWidth: '100%' }} />
                  </div>
                  <Button
                  variant="contained"
                  color="primary"
                  onClick={handleReset}
                  sx={{
                    position: 'absolute',
                    color: 'white',
                    bottom: '20px',
                    right: '20px',
                    backgroundColor: '#ff00c3',
                    overflow: 'hidden',
                    textAlign: 'left',
                    '&:hover': {
                      backgroundColor: '#ff00c3',
                    },
                  }}
                  >
                  Reset
                  {/* {t('interpretation_log.buttons.reset')} */}
                </Button>
              </>
              ) : tableData.length > 0 ? (
                <>
                  <TableContainer component={Paper}>
                    <Table sx={{ minWidth: 650 }} stickyHeader aria-label="output data table">
                      <TableHead>
                        <TableRow>
                          {columns.map((column) => (
                            <TableCell key={column}>{column}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {tableData.slice(0, Math.min(5, tableData.length)).map((row, index) => (
                          <TableRow key={index}>
                            {columns.map((column) => (
                              <TableCell key={column}>{row[column]}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <span style={{ marginLeft: '15px', marginTop: '10px', fontSize: '12px' }}>
                    {t('interpretation_log.messages.additional_rows')}
                  </span>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleReset}
                    sx={{
                      position: 'absolute',
                      color: 'white',
                      bottom: '20px',
                      right: '20px',
                      backgroundColor: '#ff00c3',
                      overflow: 'hidden',
                      textAlign: 'left',
                      '&:hover': {
                        backgroundColor: '#ff00c3',
                      },
                    }}
                    >
                    {t('interpretation_buttons.buttons.reset')}
                  </Button>
                </>
              ) : (
                <Grid container justifyContent="center" alignItems="center" style={{ height: '100%' }}>
                  <Grid item>
                    {hasScrapeListAction || hasScrapeSchemaAction || hasScreenshotAction ? (
                      <>
                        <Typography variant="h6" gutterBottom align="left">
                          {t('interpretation_log.messages.successful_training')}
                        </Typography>
                        <SidePanelHeader />
                      </>
                    ) : (
                      <Typography variant="h6" gutterBottom align="left">
                        {t('interpretation_log.messages.no_selection')}
                      </Typography>
                    )}
                  </Grid>
                </Grid>
              )}
            <div style={{ float: 'left', clear: 'both' }} ref={logEndRef} />
          </div>
        </SwipeableDrawer>
      </Grid>
    </Grid>
  );
};