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
  Chip,
  ButtonGroup
} from "@mui/material";
import Highlight from "react-highlight";
import * as React from "react";
import { Data } from "./RunsTable";
import { TabPanel, TabContext } from "@mui/lab";
import ImageIcon from '@mui/icons-material/Image';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import DataObjectIcon from '@mui/icons-material/DataObject';
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

  const [expandedView, setExpandedView] = useState<string | null>(null);

  const [legacyData, setLegacyData] = useState<any[]>([]);
  const [legacyColumns, setLegacyColumns] = useState<string[]>([]);
  const [isLegacyData, setIsLegacyData] = useState<boolean>(false);

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
    columns: string[],
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
            <ButtonGroup size="small" variant="outlined">
              <Button
                startIcon={<DownloadIcon />}
                onClick={() => {
                  if (isPaginatedList) {
                    downloadCSV(currentData, currentColumns, `list_table_${currentListIndex + 1}.csv`);
                  } else {
                    downloadCSV(data, columns, csvFilename);
                  }
                }}
                sx={{ borderColor: '#FF00C3', color: '#FF00C3' }}
              >
                CSV
              </Button>
              <Button
                startIcon={<DataObjectIcon />}
                onClick={() => {
                  if (isPaginatedList) {
                    downloadJSON(currentData, `list_table_${currentListIndex + 1}.json`);
                  } else {
                    downloadJSON(data, jsonFilename);
                  }
                }}
                sx={{ borderColor: '#FF00C3', color: '#FF00C3' }}
              >
                JSON
              </Button>
            </ButtonGroup>

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
                  {(isPaginatedList ? currentColumns : columns).map((column) => (
                    <TableCell key={column}>{column}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(isPaginatedList ? currentData : data).map((row, index) => (
                  <TableRow key={index}>
                    {(isPaginatedList ? currentColumns : columns).map((column) => (
                      <TableCell key={column}>
                        {row[column] === undefined || row[column] === "" ? "-" : row[column]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>
    );
  };

  const renderExpandedView = (dataTypeWithIndex: string) => {
    if (expandedView !== dataTypeWithIndex) return null;

    let data: any[] = [];
    let columns: string[] = [];
    let title = "";
    let csvFilename = "";
    let jsonFilename = "";

    if (dataTypeWithIndex.startsWith('list-')) {
      const indexStr = dataTypeWithIndex.split('-')[1];
      const index = parseInt(indexStr, 10);

      if (index >= 0 && index < listData.length) {
        data = listData[index];
        columns = listColumns[index];
        title = `${t('run_content.captured_data.list_title')} - Table ${index + 1}`;
        csvFilename = `list_table_${index + 1}.csv`;
        jsonFilename = `list_table_${index + 1}.json`;
      }
    } else {
      switch (dataTypeWithIndex) {
        case 'schema':
          data = schemaData;
          columns = schemaColumns;
          title = t('run_content.captured_data.schema_title');
          csvFilename = 'schema_data.csv';
          jsonFilename = 'schema_data.json';
          break;
        case 'list':
          if (listData.length > 0 && listColumns.length > 0) {
            data = listData[currentListIndex];
            columns = listColumns[currentListIndex];
          }
          title = t('run_content.captured_data.list_title');
          csvFilename = 'list_data.csv';
          jsonFilename = 'list_data.json';
          break;
        case 'legacy':
          data = legacyData;
          columns = legacyColumns;
          title = t('run_content.captured_data.title');
          csvFilename = 'data.csv';
          jsonFilename = 'data.json';
          break;
      }
    }

    return (
      <Box sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        p: 4
      }}>
        <Box sx={{
          bgcolor: 'background.paper',
          borderRadius: 1,
          boxShadow: 24,
          p: 4,
          width: '90%',
          maxWidth: '1200px',
          maxHeight: '90vh',
          overflow: 'auto'
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
            <Typography variant="h5">{title}</Typography>
            <Box>
              <ButtonGroup variant="outlined" size="small" sx={{ mr: 2 }}>
                <Button
                  onClick={() => downloadCSV(data, columns, csvFilename)}
                  startIcon={<DownloadIcon />}
                >
                  CSV
                </Button>
                <Button
                  onClick={() => downloadJSON(data, jsonFilename)}
                  startIcon={<DataObjectIcon />}
                >
                  JSON
                </Button>
              </ButtonGroup>
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => setExpandedView(null)}
              >
                Close
              </Button>
            </Box>
          </Box>

          <TableContainer component={Paper} sx={{ maxHeight: 'calc(90vh - 150px)' }}>
            <Table stickyHeader aria-label="expanded data table">
              <TableHead>
                <TableRow>
                  {columns.map((column) => (
                    <TableCell key={column}>{column}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((row, index) => (
                  <TableRow key={index}>
                    {columns.map((column) => (
                      <TableCell key={column}>
                        {row[column] === undefined || row[column] === "" ? "-" : row[column]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>
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
          {row.status === 'running' ? <Button
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
                    [],
                    [],
                    t('run_content.captured_data.list_title'),
                    'list_data.csv',
                    'list_data.json',
                    true
                  )}
                </>
              )}

              {renderExpandedView('schema')}
              {renderExpandedView('legacy')}

              {listData.map((_, index) => renderExpandedView(`list-${index}`))}
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
                    <ImageIcon sx={{ color: '#FF00C3' }} />
                    <Typography variant='h6' sx={{ ml: 2 }}>
                      {t('run_content.captured_screenshot.title', 'Screenshots')}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Button
                      startIcon={<DownloadIcon />}
                      href={row.binaryOutput[screenshotKeys[currentScreenshotIndex]]}
                      download={screenshotKeys[currentScreenshotIndex]}
                      sx={{ borderColor: '#FF00C3', color: '#FF00C3', borderRadius: 1 }}
                      variant="outlined"
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
                    {screenshotKeys.length > 1 && (
                      <Chip
                        label={`Screenshot ${currentScreenshotIndex + 1} of ${screenshotKeys.length}`}
                        size="small"
                        sx={{ backgroundColor: '#FF00C3', color: 'white', mb: 2 }}
                      />
                    )}
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