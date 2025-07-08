import * as React from 'react';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Typography from '@mui/material/Typography';
import { Button, Grid, Box } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useBrowserSteps } from '../../context/browserSteps';

interface InterpretationLogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const InterpretationLog: React.FC<InterpretationLogProps> = ({ isOpen, setIsOpen }) => {
  const { t } = useTranslation();
  
  const [captureListData, setCaptureListData] = useState<any[]>([]);
  const [captureTextData, setCaptureTextData] = useState<any[]>([]);
  const [screenshotData, setScreenshotData] = useState<string[]>([]);

  const [captureListPage, setCaptureListPage] = useState<number>(0);
  const [screenshotPage, setScreenshotPage] = useState<number>(0);
  
  const [activeTab, setActiveTab] = useState(0);
  
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const { browserSteps } = useBrowserSteps();
  
  const { browserWidth, outputPreviewHeight, outputPreviewWidth } = useBrowserDimensionsStore();
  const { currentWorkflowActionsState, shouldResetInterpretationLog } = useGlobalInfoStore();

  const [showPreviewData, setShowPreviewData] = useState<boolean>(false);

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

  const updateActiveTab = useCallback(() => {
    const availableTabs = getAvailableTabs();
    
    if (captureListData.length > 0 && availableTabs.findIndex(tab => tab.id === 'captureList') !== -1) {
      setActiveTab(availableTabs.findIndex(tab => tab.id === 'captureList'));
    } else if (captureTextData.length > 0 && availableTabs.findIndex(tab => tab.id === 'captureText') !== -1) {
      setActiveTab(availableTabs.findIndex(tab => tab.id === 'captureText'));
    } else if (screenshotData.length > 0 && availableTabs.findIndex(tab => tab.id === 'captureScreenshot') !== -1) {
      setActiveTab(availableTabs.findIndex(tab => tab.id === 'captureScreenshot'));
    }
  }, [captureListData.length, captureTextData.length, screenshotData.length]);

  useEffect(() => {
    const textSteps = browserSteps.filter(step => step.type === 'text');
    if (textSteps.length > 0) {
      const textDataRow: Record<string, string> = {};
      
      textSteps.forEach(step => {
        textDataRow[step.label] = step.data;
      });
      
      setCaptureTextData([textDataRow]);
    }
    
    const listSteps = browserSteps.filter(step => step.type === 'list');
    if (listSteps.length > 0) {
      setCaptureListData(listSteps);
    }

    const screenshotSteps = browserSteps.filter(step => 
      step.type === 'screenshot'
    ) as Array<{ type: 'screenshot'; id: number; fullPage: boolean; actionId?: string; screenshotData?: string }>;

    const screenshotsWithData = screenshotSteps.filter(step => step.screenshotData);
    if (screenshotsWithData.length > 0) {
      const screenshots = screenshotsWithData.map(step => step.screenshotData!);
      setScreenshotData(screenshots);
    }
    
    updateActiveTab();
  }, [browserSteps, updateActiveTab]);

  useEffect(() => {
    if (shouldResetInterpretationLog) {
      setCaptureListData([]);
      setCaptureTextData([]);
      setScreenshotData([]);
      setActiveTab(0);
      setCaptureListPage(0);
      setScreenshotPage(0);
      setShowPreviewData(false);
    }
  }, [shouldResetInterpretationLog]);

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
  }, [captureListData.length, captureTextData.length, screenshotData.length, showPreviewData]);

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

  const shouldShowTabs = availableTabs.length > 1;

  const getSingleContentType = () => {
    if (availableTabs.length === 1) {
      return availableTabs[0].id;
    }
    return null;
  };

  const singleContentType = getSingleContentType();

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
          
          {showPreviewData && availableTabs.length > 0 ? (
            <>
              {shouldShowTabs && (
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
              )}
              
              <Box sx={{ flexGrow: 1, overflow: 'auto', p: 0 }}>
                {(activeTab === availableTabs.findIndex(tab => tab.id === 'captureList') || singleContentType === 'captureList') && captureListData.length > 0 && (
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
                            {Object.values(captureListData[captureListPage]?.fields || {}).map((field: any, index) => (
                              <TableCell 
                                key={index}
                                sx={{ 
                                  borderBottom: '1px solid',
                                  borderColor: darkMode ? '#3a4453' : '#dee2e6',
                                  backgroundColor: darkMode ? '#2a3441' : '#f8f9fa'
                                }}
                              >
                                {field.label}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(captureListData[captureListPage]?.data || [])
                            .slice(0, Math.min(captureListData[captureListPage]?.limit || 10, 5))
                            .map((row: any, rowIndex: any) => (
                              <TableRow 
                                key={rowIndex}
                                sx={{ 
                                  borderBottom: rowIndex < Math.min(
                                    (captureListData[captureListPage]?.data?.length || 0),
                                    Math.min(captureListData[captureListPage]?.limit || 10, 5)
                                  ) - 1 ? '1px solid' : 'none',
                                  borderColor: darkMode ? '#3a4453' : '#dee2e6'
                                }}
                              >
                                {Object.values(captureListData[captureListPage]?.fields || {}).map((field: any, colIndex) => (
                                  <TableCell 
                                    key={colIndex}
                                    sx={{ 
                                      borderBottom: 'none',
                                      py: 2
                                    }}
                                  >
                                    {row[field.label]}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))
                          }
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}

                {(activeTab === availableTabs.findIndex(tab => tab.id === 'captureScreenshot') || singleContentType === 'captureScreenshot') && screenshotData.length > 0 && (
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
                
                {(activeTab === availableTabs.findIndex(tab => tab.id === 'captureText') || singleContentType === 'captureText') && captureTextData.length > 0 && (
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
                    <SidePanelHeader onPreviewClick={() => setShowPreviewData(true)} />
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