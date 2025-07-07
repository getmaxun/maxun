import {
  Box,
  Tabs,
  Typography,
  Tab,
  Paper,
  Button,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ButtonGroup
} from "@mui/material";
import Highlight from "react-highlight";
import * as React from "react";
import { Data } from "./RunsTable";
import { TabPanel, TabContext } from "@mui/lab";
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useEffect, useState } from "react";
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import 'highlight.js/styles/github.css';
import { useTranslation } from "react-i18next";
import { useThemeMode } from "../../context/theme-provider";

interface RunContentProps {
  row: Data,
  currentLog: string,
  interpretationInProgress: boolean,
  logEndRef: React.RefObject<HTMLDivElement>,
  abortRunHandler: () => void,
}

export const RunContent = ({ row, currentLog, interpretationInProgress, logEndRef, abortRunHandler }: RunContentProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<string>('output');

  const [schemaData, setSchemaData] = useState<any[]>([]);
  const [schemaColumns, setSchemaColumns] = useState<string[]>([]);

  const [listData, setListData] = useState<any[][]>([]);
  const [listColumns, setListColumns] = useState<string[][]>([]);
  const [currentListIndex, setCurrentListIndex] = useState<number>(0);

  const [screenshotKeys, setScreenshotKeys] = useState<string[]>([]);
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState<number>(0);

  const [legacyData, setLegacyData] = useState<any[]>([]);
  const [legacyColumns, setLegacyColumns] = useState<string[]>([]);
  const [isLegacyData, setIsLegacyData] = useState<boolean>(false);

  const { darkMode } = useThemeMode();

  useEffect(() => {
    setTab(tab);
  }, [interpretationInProgress]);

  useEffect(() => {
    if (!row.serializableOutput) return;

    if (!row.serializableOutput.scrapeSchema &&
      !row.serializableOutput.scrapeList &&
      Object.keys(row.serializableOutput).length > 0) {

      setIsLegacyData(true);
      processLegacyData(row.serializableOutput);
      return;
    }

    setIsLegacyData(false);

    if (row.serializableOutput.scrapeSchema && Object.keys(row.serializableOutput.scrapeSchema).length > 0) {
      processDataCategory(row.serializableOutput.scrapeSchema, setSchemaData, setSchemaColumns);
    }

    if (row.serializableOutput.scrapeList) {
      processScrapeList(row.serializableOutput.scrapeList);
    }
  }, [row.serializableOutput]);

  useEffect(() => {
    if (row.binaryOutput && Object.keys(row.binaryOutput).length > 0) {
      setScreenshotKeys(Object.keys(row.binaryOutput));
      setCurrentScreenshotIndex(0);
    }
  }, [row.binaryOutput]);

  const processLegacyData = (legacyOutput: Record<string, any>) => {
    let allData: any[] = [];

    Object.keys(legacyOutput).forEach(key => {
      const data = legacyOutput[key];
      if (Array.isArray(data)) {
        const filteredData = data.filter(row =>
          Object.values(row).some(value => value !== undefined && value !== "")
        );
        allData = [...allData, ...filteredData];
      }
    });

    if (allData.length > 0) {
      const allColumns = new Set<string>();
      allData.forEach(item => {
        Object.keys(item).forEach(key => allColumns.add(key));
      });

      setLegacyData(allData);
      setLegacyColumns(Array.from(allColumns));
    }
  };

  const processDataCategory = (
    categoryData: Record<string, any>,
    setData: React.Dispatch<React.SetStateAction<any[]>>,
    setColumns: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    let allData: any[] = [];

    Object.keys(categoryData).forEach(key => {
      const data = categoryData[key];
      if (Array.isArray(data)) {
        const filteredData = data.filter(row =>
          Object.values(row).some(value => value !== undefined && value !== "")
        );
        allData = [...allData, ...filteredData];
      }
    });

    if (allData.length > 0) {
      const allColumns = new Set<string>();
      allData.forEach(item => {
        Object.keys(item).forEach(key => allColumns.add(key));
      });

      setData(allData);
      setColumns(Array.from(allColumns));
    }
  };

  const processScrapeList = (scrapeListData: any) => {
    const tablesList: any[][] = [];
    const columnsList: string[][] = [];

    if (Array.isArray(scrapeListData)) {
      scrapeListData.forEach(tableData => {
        if (Array.isArray(tableData) && tableData.length > 0) {
          const filteredData = tableData.filter(row =>
            Object.values(row).some(value => value !== undefined && value !== "")
          );

          if (filteredData.length > 0) {
            tablesList.push(filteredData);

            const tableColumns = new Set<string>();
            filteredData.forEach(item => {
              Object.keys(item).forEach(key => tableColumns.add(key));
            });

            columnsList.push(Array.from(tableColumns));
          }
        }
      });
    } else if (typeof scrapeListData === 'object') {
      Object.keys(scrapeListData).forEach(key => {
        const tableData = scrapeListData[key];
        if (Array.isArray(tableData) && tableData.length > 0) {
          const filteredData = tableData.filter(row =>
            Object.values(row).some(value => value !== undefined && value !== "")
          );

          if (filteredData.length > 0) {
            tablesList.push(filteredData);

            const tableColumns = new Set<string>();
            filteredData.forEach(item => {
              Object.keys(item).forEach(key => tableColumns.add(key));
            });

            columnsList.push(Array.from(tableColumns));
          }
        }
      });
    }

    setListData(tablesList);
    setListColumns(columnsList);
    setCurrentListIndex(0);
  };

  // Function to convert table data to CSV format
  const convertToCSV = (data: any[], columns: string[]): string => {
    const header = columns.join(',');
    const rows = data.map(row =>
      columns.map(col => JSON.stringify(row[col] || "", null, 2)).join(',')
    );
    return [header, ...rows].join('\n');
  };

  // Function to download a specific dataset as CSV
  const downloadCSV = (data: any[], columns: string[], filename: string) => {
    const csvContent = convertToCSV(data, columns);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadJSON = (data: any[], filename: string) => {
    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  };

  const navigateListTable = (direction: 'next' | 'prev') => {
    if (direction === 'next' && currentListIndex < listData.length - 1) {
      setCurrentListIndex(currentListIndex + 1);
    } else if (direction === 'prev' && currentListIndex > 0) {
      setCurrentListIndex(currentListIndex - 1);
    }
  };

  const navigateScreenshots = (direction: 'next' | 'prev') => {
    if (direction === 'next' && currentScreenshotIndex < screenshotKeys.length - 1) {
      setCurrentScreenshotIndex(currentScreenshotIndex + 1);
    } else if (direction === 'prev' && currentScreenshotIndex > 0) {
      setCurrentScreenshotIndex(currentScreenshotIndex - 1);
    }
  };

  const renderDataTable = (
    data: any[],
    columns: any[],
    title: string,
    csvFilename: string,
    jsonFilename: string,
    isPaginatedList: boolean = false
  ) => {
    if (!isPaginatedList && data.length === 0) return null;
    if (isPaginatedList && (listData.length === 0 || currentListIndex >= listData.length)) return null;

    const currentData = isPaginatedList ? listData[currentListIndex] : data;
    const currentColumns = isPaginatedList ? listColumns[currentListIndex] : columns;

    if (!currentData || currentData.length === 0) return null;

    const isSchemaData = title.toLowerCase().includes('text') || title.toLowerCase().includes('schema');

    return (
      <Accordion defaultExpanded sx={{ mb: 2 }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls={`${title.toLowerCase()}-content`}
          id={`${title.toLowerCase()}-header`}
        >
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant='h6'>
              {title}
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Button 
                component="a"
                onClick={() => downloadJSON(currentData, jsonFilename)}
                sx={{ 
                  color: '#FF00C3', 
                  textTransform: 'none',
                  mr: 2,
                  p: 0,
                  minWidth: 'auto',
                  backgroundColor: 'transparent',
                  '&:hover': {
                    backgroundColor: 'transparent',
                    textDecoration: 'underline'
                  }
                }}
              >
                {t('run_content.captured_data.download_json', 'Download as JSON')}
              </Button>

              <Button 
                component="a"
                onClick={() => downloadCSV(currentData, currentColumns, csvFilename)}
                sx={{ 
                  color: '#FF00C3', 
                  textTransform: 'none',
                  p: 0,
                  minWidth: 'auto',
                  backgroundColor: 'transparent',
                  '&:hover': {
                    backgroundColor: 'transparent',
                    textDecoration: 'underline'
                  }
                }}
              >
                {t('run_content.captured_data.download_csv', 'Download as CSV')}
              </Button>
            </Box>

            {isPaginatedList && listData.length > 1 && (
              <ButtonGroup size="small">
                <Button
                  onClick={() => navigateListTable('prev')}
                  disabled={currentListIndex === 0}
                  sx={{
                    borderColor: '#FF00C3',
                    color: currentListIndex === 0 ? 'gray' : '#FF00C3',
                    '&.Mui-disabled': {
                      borderColor: 'rgba(0, 0, 0, 0.12)'
                    }
                  }}
                >
                  <ArrowBackIcon />
                </Button>
                <Button
                  onClick={() => navigateListTable('next')}
                  disabled={currentListIndex === listData.length - 1}
                  sx={{
                    borderColor: '#FF00C3',
                    color: currentListIndex === listData.length - 1 ? 'gray' : '#FF00C3',
                    '&.Mui-disabled': {
                      borderColor: 'rgba(0, 0, 0, 0.12)'
                    }
                  }}
                >
                  <ArrowForwardIcon />
                </Button>
              </ButtonGroup>
            )}
          </Box>
          <TableContainer component={Paper} sx={{ maxHeight: 320 }}>
            <Table stickyHeader aria-label="sticky table">
              <TableHead>
                <TableRow>
                  {isSchemaData ? (
                    <>
                      <TableCell 
                        sx={{ 
                          borderBottom: '1px solid',
                          borderColor: darkMode ? '#3a4453' : '#dee2e6',
                          backgroundColor: darkMode ? '#2a3441' : '#f8f9fa'
                        }}
                      >
                        Label
                      </TableCell>
                      <TableCell 
                        sx={{ 
                          borderBottom: '1px solid',
                          borderColor: darkMode ? '#3a4453' : '#dee2e6',
                          backgroundColor: darkMode ? '#2a3441' : '#f8f9fa'
                        }}
                      >
                        Value
                      </TableCell>
                    </>
                  ) : (
                    (isPaginatedList ? currentColumns : columns).map((column) => (
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
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {isSchemaData ? (
                  currentColumns.map((column) => (
                    <TableRow key={column}>
                      <TableCell sx={{ fontWeight: 500 }}>
                        {column}
                      </TableCell>
                      <TableCell>
                        {currentData[0][column] === undefined || currentData[0][column] === "" ? "-" : currentData[0][column]}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  currentData.map((row, index) => (
                    <TableRow key={index}>
                      {(isPaginatedList ? currentColumns : columns).map((column) => (
                        <TableCell key={column}>
                          {row[column] === undefined || row[column] === "" ? "-" : row[column]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>
    );
  };

  const hasData = schemaData.length > 0 || listData.length > 0 || legacyData.length > 0;
  const hasScreenshots = row.binaryOutput && Object.keys(row.binaryOutput).length > 0;

  return (
    <Box sx={{ width: '100%' }}>
      <TabContext value={tab}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tab}
            onChange={(e, newTab) => setTab(newTab)}
            aria-label="run-content-tabs"
            sx={{
              '& .MuiTabs-indicator': {
                backgroundColor: '#FF00C3',
              },
              '& .MuiTab-root': {
                '&.Mui-selected': {
                  color: '#FF00C3',
                },
              }
            }}
          >
            <Tab
              label={t('run_content.tabs.output_data')}
              value='output'
              sx={{
                color: (theme) => theme.palette.mode === 'dark' ? '#fff' : '#000',
                '&:hover': {
                  color: '#FF00C3'
                },
                '&.Mui-selected': {
                  color: '#FF00C3',
                }
              }}
            />
            <Tab
              label={t('run_content.tabs.log')}
              value='log'
              sx={{
                color: (theme) => theme.palette.mode === 'dark' ? '#fff' : '#000',
                '&:hover': {
                  color: '#FF00C3'
                },
                '&.Mui-selected': {
                  color: '#FF00C3',
                }
              }}
            />
          </Tabs>
        </Box>
        <TabPanel value='log'>
          <Box sx={{
            margin: 1,
            background: '#19171c',
            overflowY: 'scroll',
            overflowX: 'scroll',
            width: '700px',
            height: 'fit-content',
            maxHeight: '450px',
          }}>
            <div>
              <Highlight className="javascript">
                {row.status === 'running' ? currentLog : row.log}
              </Highlight>
              <div style={{ float: "left", clear: "both" }}
                ref={logEndRef} />
            </div>
          </Box>
          {row.status === 'running' || row.status === 'queued' ? <Button
            color="error"
            onClick={abortRunHandler}
          >
            {t('run_content.buttons.stop')}
          </Button> : null}
        </TabPanel>
        <TabPanel value='output' sx={{ width: '100%', maxWidth: '900px' }}>
          {row.status === 'running' || row.status === 'queued' ? (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <CircularProgress size={22} sx={{ marginRight: '10px' }} />
              {t('run_content.loading')}
            </Box>
          ) : (!hasData && !hasScreenshots
            ? <Typography>{t('run_content.empty_output')}</Typography>
            : null)}

          {hasData && (
            <Box sx={{ mb: 3 }}>
              {isLegacyData && (
                renderDataTable(
                  legacyData,
                  legacyColumns,
                  t('run_content.captured_data.title'),
                  'data.csv',
                  'data.json'
                )
              )}

              {!isLegacyData && (
                <>
                  {renderDataTable(
                    schemaData,
                    schemaColumns,
                    t('run_content.captured_data.schema_title'),
                    'schema_data.csv',
                    'schema_data.json'
                  )}

                  {listData.length > 0 && renderDataTable(
                    listData,
                    listColumns,
                    t('run_content.captured_data.list_title'),
                    'list_data.csv',
                    'list_data.json',
                    true
                  )}
                </>
              )}
            </Box>
          )}

          {hasScreenshots && (
            <>
              <Accordion defaultExpanded sx={{ mb: 2 }}>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  aria-controls="screenshot-content"
                  id="screenshot-header"
                >
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant='h6'>
                      {t('run_content.captured_screenshot.title', 'Screenshots')}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Button
                      onClick={() => {
                        fetch(row.binaryOutput[screenshotKeys[currentScreenshotIndex]])
                          .then(response => response.blob())
                          .then(blob => {
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.style.display = 'none';
                            a.href = url;
                            a.download = screenshotKeys[currentScreenshotIndex];
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                          })
                          .catch(err => console.error('Download failed:', err));
                      }}
                      sx={{ 
                        color: '#FF00C3', 
                        textTransform: 'none',
                        p: 0,
                        minWidth: 'auto',
                        backgroundColor: 'transparent',
                        '&:hover': {
                          backgroundColor: 'transparent',
                          textDecoration: 'underline'
                        }
                      }}
                    >
                      {t('run_content.captured_screenshot.download', 'Download')}
                    </Button>
                    
                    {screenshotKeys.length > 1 && (
                      <ButtonGroup size="small">
                        <Button
                          onClick={() => navigateScreenshots('prev')}
                          disabled={currentScreenshotIndex === 0}
                          sx={{
                            borderColor: '#FF00C3',
                            color: currentScreenshotIndex === 0 ? 'gray' : '#FF00C3',
                            '&.Mui-disabled': {
                              borderColor: 'rgba(0, 0, 0, 0.12)'
                            }
                          }}
                        >
                          <ArrowBackIcon />
                        </Button>
                        <Button
                          onClick={() => navigateScreenshots('next')}
                          disabled={currentScreenshotIndex === screenshotKeys.length - 1}
                          sx={{
                            borderColor: '#FF00C3',
                            color: currentScreenshotIndex === screenshotKeys.length - 1 ? 'gray' : '#FF00C3',
                            '&.Mui-disabled': {
                              borderColor: 'rgba(0, 0, 0, 0.12)'
                            }
                          }}
                        >
                          <ArrowForwardIcon />
                        </Button>
                      </ButtonGroup>
                    )}
                  </Box>
                  
                  <Box sx={{ mt: 1 }}>
                    <Box>
                      <img
                        src={row.binaryOutput[screenshotKeys[currentScreenshotIndex]]}
                        alt={`Screenshot ${screenshotKeys[currentScreenshotIndex]}`}
                        style={{
                          maxWidth: '100%',
                          height: 'auto',
                          border: '1px solid #e0e0e0',
                          borderRadius: '4px'
                        }}
                      />
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </>
          )}
        </TabPanel>
      </TabContext>
    </Box>
  );
};
