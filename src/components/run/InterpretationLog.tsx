import * as React from 'react';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Typography from '@mui/material/Typography';
import { Button, Grid, Tabs, Tab, Box } from '@mui/material';
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
import { SidePanelHeader } from '../recorder/SidePanelHeader';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useThemeMode } from '../../context/theme-provider';
import { useTranslation } from 'react-i18next';

interface InterpretationLogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const InterpretationLog: React.FC<InterpretationLogProps> = ({ isOpen, setIsOpen }) => {
  const { t } = useTranslation();
  const [log, setLog] = useState<string>('');
  const [customValue, setCustomValue] = useState('');
  
  const [captureListData, setCaptureListData] = useState<any[]>([]);
  const [captureTextData, setCaptureTextData] = useState<any[]>([]);
  const [screenshotData, setScreenshotData] = useState<string[]>([]);
  const [otherData, setOtherData] = useState<any[]>([]);

  const [captureListPage, setCaptureListPage] = useState<number>(0);
  const [screenshotPage, setScreenshotPage] = useState<number>(0);
  const [otherPage, setOtherPage] = useState<number>(0);
  
  const [activeTab, setActiveTab] = useState(0);
  
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const { browserWidth, outputPreviewHeight, outputPreviewWidth } = useBrowserDimensionsStore();
  const { socket } = useSocketStore();
  const { currentWorkflowActionsState, shouldResetInterpretationLog, notify } = useGlobalInfoStore();

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
  }, []);

  const handleSerializableCallback = useCallback(({ type, data }: { type: string, data: any }) => {
    setLog((prevState) =>
      prevState + '\n' + t('interpretation_log.data_sections.serializable_received') + '\n'
      + JSON.stringify(data, null, 2) + '\n' + t('interpretation_log.data_sections.separator'));
  
    if (type === 'captureList' && Array.isArray(data)) {
      setCaptureListData(prev => [...prev, data]); 
      if (captureListData.length === 0) {
        const availableTabs = getAvailableTabs();
        const tabIndex = availableTabs.findIndex(tab => tab.id === 'captureList');
        if (tabIndex !== -1) setActiveTab(tabIndex);
      }
    } else if (type === 'captureText') {
      if (Array.isArray(data)) {
        setCaptureTextData(data);
      } else {
        setCaptureTextData([data]);
      }
      if (captureTextData.length === 0) {
        const availableTabs = getAvailableTabs();
        const tabIndex = availableTabs.findIndex(tab => tab.id === 'captureText');
        if (tabIndex !== -1) setActiveTab(tabIndex);
      }
    }
  
    scrollLogToBottom();
  }, [captureListData.length, captureTextData.length, otherData.length, t]);
  
  const handleBinaryCallback = useCallback(({ data, mimetype, type }: { data: any, mimetype: string, type: string }) => {
    const base64String = Buffer.from(data).toString('base64');
    const imageSrc = `data:${mimetype};base64,${base64String}`;
  
    setLog((prevState) =>
      prevState + '\n' + t('interpretation_log.data_sections.binary_received') + '\n'
      + t('interpretation_log.data_sections.mimetype') + mimetype + '\n'
      + t('interpretation_log.data_sections.image_below') + '\n'
      + t('interpretation_log.data_sections.separator'));
  
    if (type === 'captureScreenshot') {
      setScreenshotData(prev => [...prev, imageSrc]);
      if (screenshotData.length === 0) {
        const availableTabs = getAvailableTabs();
        const tabIndex = availableTabs.findIndex(tab => tab.id === 'captureScreenshot');
        if (tabIndex !== -1) setActiveTab(tabIndex);
      }
    }
    
    scrollLogToBottom();
  }, [screenshotData.length, t]);

  const handleCustomValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomValue(event.target.value);
  };

  useEffect(() => {
    if (shouldResetInterpretationLog) {
      setLog('');
      setCaptureListData([]);
      setCaptureTextData([]);
      setScreenshotData([]);
      setOtherData([]);
      setActiveTab(0);
      setCaptureListPage(0);
      setScreenshotPage(0);
      setOtherPage(0);
    }
  }, [shouldResetInterpretationLog]);

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

  const getAvailableTabs = useCallback(() => {
    const tabs = [];
    
    if (captureListData.length > 0) {
      tabs.push({ id: 'captureList', label: 'Lists' });
    }
    
    if (captureTextData.length > 0) {
      tabs.push({ id: 'captureText', label: 'Texts' });
    }
    
    if (screenshotData.length > 0) {
      tabs.push({ id: 'captureScreenshot', label: 'Screenshots' });
    }
    
    return tabs;
  }, [captureListData.length, captureTextData.length, screenshotData.length, otherData.length]);

  const availableTabs = getAvailableTabs();
  
  useEffect(() => {
    if (activeTab >= availableTabs.length && availableTabs.length > 0) {
      setActiveTab(0);
    }
  }, [activeTab, availableTabs.length]);

  const { hasScrapeListAction, hasScreenshotAction, hasScrapeSchemaAction } = currentWorkflowActionsState;

  useEffect(() => {
    if (hasScrapeListAction || hasScrapeSchemaAction || hasScreenshotAction) {
      setIsOpen(true);
    }
  }, [hasScrapeListAction, hasScrapeSchemaAction, hasScreenshotAction, setIsOpen]);

  const { darkMode } = useThemeMode();

  const getCaptureTextColumns = captureTextData.length > 0 ? Object.keys(captureTextData[0]) : [];

  return (
    <Grid container>
      <Grid item xs={12} md={9} lg={9}>
        <div style={{ height: '20px' }}></div>
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
            width: browserWidth,
            overflow: 'hidden',
            textAlign: 'left',
            justifyContent: 'flex-start',
            '&:hover': {
              backgroundColor: '#ff00c3',
            },
          }}
        >
          <ArrowUpwardIcon fontSize="inherit" sx={{ marginRight: '10px' }} />
          {t('interpretation_log.titles.output_preview')}
        </Button>
        <SwipeableDrawer
          anchor="bottom"
          open={isOpen}
          onClose={toggleDrawer(false)}
          onOpen={toggleDrawer(true)}
          PaperProps={{
            sx: {
              background: `${darkMode ? '#1e2124' : 'white'}`,
              color: `${darkMode ? 'white' : 'black'}`,
              padding: '10px',
              height: outputPreviewHeight,
              width: outputPreviewWidth,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '10px 10px 0 0',
            },
          }}
        >
          <Typography variant="h6" gutterBottom style={{ display: 'flex', alignItems: 'center' }}>
            <StorageIcon style={{ marginRight: '8px' }} />
            {t('interpretation_log.titles.output_preview')}
          </Typography>
          
          {availableTabs.length > 0 ? (
            <>
              <Box 
                sx={{
                  display: 'flex',
                  borderBottom: '1px solid',
                  borderColor: darkMode ? '#3a4453' : '#dee2e6',
                  backgroundColor: darkMode ? '#2a3441' : '#f8f9fa'
                }}
              >
                {availableTabs.map((tab, index) => (
                  <Box
                    key={tab.id}
                    onClick={() => setActiveTab(index)}
                    sx={{
                      px: 4,
                      py: 2,
                      cursor: 'pointer',
                      borderBottom: activeTab === index ? '2px solid' : 'none',
                      borderColor: activeTab === index ? (darkMode ? '#ff00c3' : '#ff00c3') : 'transparent',
                      backgroundColor: activeTab === index ? (darkMode ? '#34404d' : '#e9ecef') : 'transparent',
                      color: darkMode ? 'white' : 'black',
                      fontWeight: activeTab === index ? 500 : 400,
                      textAlign: 'center',
                      position: 'relative',
                      '&:hover': {
                        backgroundColor: activeTab !== index ? (darkMode ? '#303b49' : '#e2e6ea') : undefined
                      }
                    }}
                  >
                    <Typography variant="body1">
                      {tab.label}
                    </Typography>
                  </Box>
                ))}
              </Box>
              
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: 0 }}>
                {activeTab === availableTabs.findIndex(tab => tab.id === 'captureList') && captureListData.length > 0 && (
                  <Box>
                    <Box sx={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      mb: 2,
                      mt: 2 
                    }}>
                      <Typography variant="body2">
                        {`Table ${captureListPage + 1} of ${captureListData.length}`}
                      </Typography>
                      <Box>
                        <Button 
                          onClick={() => setCaptureListPage(prev => Math.max(0, prev - 1))}
                          disabled={captureListPage === 0}
                          size="small"
                        >
                          Previous
                        </Button>
                        <Button 
                          onClick={() => setCaptureListPage(prev => Math.min(captureListData.length - 1, prev + 1))}
                          disabled={captureListPage >= captureListData.length - 1}
                          size="small"
                          sx={{ ml: 1 }}
                        >
                          Next
                        </Button>
                      </Box>
                    </Box>
                    <TableContainer component={Paper} sx={{ boxShadow: 'none', borderRadius: 0 }}>
                      <Table>
                        <TableHead>
                          <TableRow>
                            {captureListData[captureListPage] && captureListData[captureListPage].length > 0 && 
                              Object.keys(captureListData[captureListPage][0]).map((column) => (
                                <TableCell 
                                  key={column}
                                  sx={{ 
                                    borderBottom: '1px solid',
                                    borderColor: darkMode ? '#3a4453' : '#dee2e6',
                                    backgroundColor: darkMode ? '#2a3441' : '#f8f9fa'
                                  }}
                                >
                                  {column}
                                </TableCell>
                              ))
                            }
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {captureListData[captureListPage] && 
                          captureListData[captureListPage].map((row: any, idx: any) => (
                            <TableRow 
                              key={idx}
                              sx={{ 
                                borderBottom: '1px solid',
                                borderColor: darkMode ? '#3a4453' : '#dee2e6'
                              }}
                            >
                              {Object.keys(row).map((column) => (
                                <TableCell 
                                  key={column}
                                  sx={{ 
                                    borderBottom: 'none',
                                    py: 2
                                  }}
                                >
                                  {row[column]}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}

                {activeTab === availableTabs.findIndex(tab => tab.id === 'captureScreenshot') && (
                  <Box>
                    {screenshotData.length > 1 && (
                      <Box sx={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        mb: 2,
                        mt: 2 
                      }}>
                        <Typography variant="body2">
                          {`Screenshot ${screenshotPage + 1} of ${screenshotData.length}`}
                        </Typography>
                        <Box>
                          <Button 
                            onClick={() => setScreenshotPage(prev => Math.max(0, prev - 1))}
                            disabled={screenshotPage === 0}
                            size="small"
                          >
                            Previous
                          </Button>
                          <Button 
                            onClick={() => setScreenshotPage(prev => Math.min(screenshotData.length - 1, prev + 1))}
                            disabled={screenshotPage >= screenshotData.length - 1}
                            size="small"
                            sx={{ ml: 1 }}
                          >
                            Next
                          </Button>
                        </Box>
                      </Box>
                    )}
                    {screenshotData.length > 0 && (
                      <Box sx={{ p: 3 }}>
                        <Typography variant="body1" gutterBottom>
                          {t('interpretation_log.titles.screenshot')} {screenshotPage + 1}
                        </Typography>
                        <img 
                          src={screenshotData[screenshotPage]} 
                          alt={`${t('interpretation_log.titles.screenshot')} ${screenshotPage + 1}`} 
                          style={{ maxWidth: '100%' }} 
                        />
                      </Box>
                    )}
                  </Box>
                )}
                
                {activeTab === availableTabs.findIndex(tab => tab.id === 'captureText') && (
                  <TableContainer component={Paper} sx={{ boxShadow: 'none', borderRadius: 0 }}>
                    <Table>
                      <TableHead>
                        <TableRow>
                          {getCaptureTextColumns.map((column) => (
                            <TableCell 
                              key={column}
                              sx={{ 
                                borderBottom: '1px solid',
                                borderColor: darkMode ? '#3a4453' : '#dee2e6',
                                backgroundColor: darkMode ? '#2a3441' : '#f8f9fa'
                              }}
                            >
                              {column}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {captureTextData.map((row, idx) => (
                          <TableRow 
                            key={idx}
                            sx={{ 
                              borderBottom: '1px solid',
                              borderColor: darkMode ? '#3a4453' : '#dee2e6'
                            }}
                          >
                            {getCaptureTextColumns.map((column) => (
                              <TableCell 
                                key={column}
                                sx={{ 
                                  borderBottom: 'none',
                                  py: 2
                                }}
                              >
                                {row[column]}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
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
        </SwipeableDrawer>
      </Grid>
    </Grid>
  );
};