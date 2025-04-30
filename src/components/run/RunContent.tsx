import { Box, Tabs, Typography, Tab, Paper, Button, CircularProgress, Accordion, AccordionSummary, AccordionDetails, Divider, Card, CardHeader, CardContent, Grid, IconButton, Chip, ButtonGroup } from "@mui/material";
import Highlight from "react-highlight";
import * as React from "react";
import { Data } from "./RunsTable";
import { TabPanel, TabContext } from "@mui/lab";
import ArticleIcon from '@mui/icons-material/Article';
import ImageIcon from '@mui/icons-material/Image';
import ListIcon from '@mui/icons-material/List';
import SchemaIcon from '@mui/icons-material/Schema';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DownloadIcon from '@mui/icons-material/Download';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewListIcon from '@mui/icons-material/ViewList';
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

  const [expandedView, setExpandedView] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'horizontal' | 'vertical'>('vertical');

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

  const downloadAllJSON = () => {
    let allData;

    if (isLegacyData) {
      allData = { data: legacyData };
    } else {
      allData = {
        schema: schemaData,
        list: listData.flat(),
      };
    }

    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "all_data.json");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const navigateListTable = (direction: 'next' | 'prev') => {
    if (direction === 'next' && currentListIndex < listData.length - 1) {
      setCurrentListIndex(currentListIndex + 1);
    } else if (direction === 'prev' && currentListIndex > 0) {
      setCurrentListIndex(currentListIndex - 1);
    }
  };

  const renderDataTable = (
    data: any[],
    columns: string[],
    title: string,
    icon: React.ReactNode,
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
            {icon}
            <Typography variant='h6' sx={{ ml: 2 }}>
              {title}
            </Typography>
            {isPaginatedList ? (
              <Chip
                label={listData.length > 1
                  ? `Table ${currentListIndex + 1} of ${listData.length} (${currentData.length} ${currentData.length === 1 ? 'item' : 'items'})`
                  : `${currentData.length} ${currentData.length === 1 ? 'item' : 'items'}`
                }
                size="small"
                sx={{ ml: 2, backgroundColor: '#FF00C3', color: 'white' }}
              />
            ) : (
              <Chip
                label={`${data.length} ${data.length === 1 ? 'item' : 'items'}`}
                size="small"
                sx={{ ml: 2, backgroundColor: '#FF00C3', color: 'white' }}
              />
            )}
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

  const renderDataCard = (
    data: any[],
    columns: string[],
    title: string,
    icon: React.ReactNode,
    dataType: string,
    csvFilename: string,
    jsonFilename: string,
    isPaginatedList: boolean = false
  ) => {
    if (!isPaginatedList && data.length === 0) return null;
    if (isPaginatedList && (listData.length === 0 || currentListIndex >= listData.length)) return null;

    const currentData = isPaginatedList ? listData[currentListIndex] : data;
    const currentColumns = isPaginatedList ? listColumns[currentListIndex] : columns;

    if (!currentData || currentData.length === 0) return null;

    const previewData = currentData.slice(0, 1);
    const previewColumns = currentColumns.slice(0, 3);

    const showMoreColumns = currentColumns.length > 3;

    return (
      <Card sx={{
        width: '100%',
        mb: 3,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 3
      }}>
        <CardHeader
          avatar={icon}
          title={title}
          action={
            <Box>
              <IconButton
                size="small"
                onClick={() => {
                  if (isPaginatedList) {
                    downloadCSV(currentData, currentColumns, `list_table_${currentListIndex + 1}.csv`);
                  } else {
                    downloadCSV(data, columns, csvFilename);
                  }
                }}
                title={t('run_content.captured_data.download_csv')}
              >
                <DownloadIcon />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => {
                  if (isPaginatedList) {
                    downloadJSON(currentData, `list_table_${currentListIndex + 1}.json`);
                  } else {
                    downloadJSON(data, jsonFilename);
                  }
                }}
                title="Download JSON"
                sx={{ mx: 0.5 }}
              >
                <DataObjectIcon />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => {
                  if (isPaginatedList) {
                    setExpandedView(`list-${currentListIndex}`);
                  } else {
                    setExpandedView(dataType);
                  }
                }}
                title={t('run_content.captured_data.view_full')}
              >
                <FullscreenIcon />
              </IconButton>
            </Box>
          }
          sx={{ pb: 1 }}
        />
        <CardContent sx={{ pt: 0, pb: 1, flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            {isPaginatedList ? (
              <Chip
                label={listData.length > 1
                  ? `Table ${currentListIndex + 1} of ${listData.length} (${currentData.length} ${currentData.length === 1 ? 'item' : 'items'})`
                  : `${currentData.length} ${currentData.length === 1 ? 'item' : 'items'}`
                }
                size="small"
                sx={{ backgroundColor: '#FF00C3', color: 'white' }}
              />
            ) : (
              <Chip
                label={`${data.length} ${data.length === 1 ? 'item' : 'items'}`}
                size="small"
                sx={{ backgroundColor: '#FF00C3', color: 'white' }}
              />
            )}

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
                    },
                    padding: '0 8px',
                    minWidth: 'auto'
                  }}
                >
                  &lt;
                </Button>
                <Button
                  onClick={() => navigateListTable('next')}
                  disabled={currentListIndex === listData.length - 1}
                  sx={{
                    borderColor: '#FF00C3',
                    color: currentListIndex === listData.length - 1 ? 'gray' : '#FF00C3',
                    '&.Mui-disabled': {
                      borderColor: 'rgba(0, 0, 0, 0.12)'
                    },
                    padding: '0 8px',
                    minWidth: 'auto'
                  }}
                >
                  &gt;
                </Button>
              </ButtonGroup>
            )}
          </Box>
          <TableContainer component={Paper} sx={{ maxHeight: 180 }}>
            <Table size="small" aria-label="preview table">
              <TableHead>
                <TableRow>
                  {previewColumns.map((column) => (
                    <TableCell key={column}>{column}</TableCell>
                  ))}
                  {showMoreColumns && <TableCell>...</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {previewData.map((row, index) => (
                  <TableRow key={index}>
                    {previewColumns.map((column) => (
                      <TableCell key={column}>
                        {row[column] === undefined || row[column] === "" ? "-" : row[column]}
                      </TableCell>
                    ))}
                    {showMoreColumns && <TableCell>...</TableCell>}
                  </TableRow>
                ))}
                {currentData.length > 1 && (
                  <TableRow>
                    <TableCell colSpan={previewColumns.length + (showMoreColumns ? 1 : 0)} align="center">
                      <Button
                        size="small"
                        onClick={() => {
                          if (isPaginatedList) {
                            setExpandedView(`list-${currentListIndex}`);
                          } else {
                            setExpandedView(dataType);
                          }
                        }}
                        sx={{ color: '#FF00C3', mt: 1 }}
                      >
                        View all {currentData.length} items
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
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
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant='h6' sx={{ display: 'flex', alignItems: 'center' }}>
                  <ArticleIcon sx={{ marginRight: '15px' }} />
                  {t('run_content.captured_data.title')}
                </Typography>
                <Box>
                  <IconButton
                    onClick={() => setViewMode('horizontal')}
                    color={viewMode === 'horizontal' ? 'primary' : 'default'}
                    sx={{ color: viewMode === 'horizontal' ? '#FF00C3' : 'inherit' }}
                  >
                    <ViewModuleIcon />
                  </IconButton>
                  <IconButton
                    onClick={() => setViewMode('vertical')}
                    color={viewMode === 'vertical' ? 'primary' : 'default'}
                    sx={{ color: viewMode === 'vertical' ? '#FF00C3' : 'inherit' }}
                  >
                    <ViewListIcon />
                  </IconButton>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={downloadAllJSON}
                    startIcon={<CloudDownloadIcon />}
                    sx={{ borderColor: '#FF00C3', color: '#FF00C3', ml: 1 }}
                  >
                    {t('run_content.captured_data.download_all_json')}
                  </Button>
                </Box>
              </Box>

              {isLegacyData && (
                viewMode === 'vertical' ? (
                  renderDataTable(
                    legacyData,
                    legacyColumns,
                    t('run_content.captured_data.title'),
                    <ArticleIcon sx={{ color: '#FF00C3' }} />,
                    'data.csv',
                    'data.json'
                  )
                ) : (
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={12}>
                      {renderDataCard(
                        legacyData,
                        legacyColumns,
                        t('run_content.captured_data.title'),
                        <ArticleIcon sx={{ color: '#FF00C3' }} />,
                        'legacy',
                        'data.csv',
                        'data.json'
                      )}
                    </Grid>
                  </Grid>
                )
              )}

              {!isLegacyData && (
                viewMode === 'vertical' ? (
                  <>
                    {renderDataTable(
                      schemaData,
                      schemaColumns,
                      t('run_content.captured_data.schema_title'),
                      <SchemaIcon sx={{ color: '#FF00C3' }} />,
                      'schema_data.csv',
                      'schema_data.json'
                    )}

                    {listData.length > 0 && renderDataTable(
                      [],
                      [],
                      t('run_content.captured_data.list_title'),
                      <ListIcon sx={{ color: '#FF00C3' }} />,
                      'list_data.csv',
                      'list_data.json',
                      true
                    )}
                  </>
                ) : (
                  <Grid container spacing={3}>
                    {(() => {
                      const dataCategoriesCount = [
                        schemaData.length > 0,
                        listData.length > 0,
                      ].filter(Boolean).length;

                      const columnWidth = dataCategoriesCount === 1 ? 12 : dataCategoriesCount === 2 ? 6 : 4;

                      return (
                        <>
                          {schemaData.length > 0 && (
                            <Grid item xs={12} md={columnWidth} sx={{ display: 'flex' }}>
                              {renderDataCard(
                                schemaData,
                                schemaColumns,
                                t('run_content.captured_data.schema_title'),
                                <SchemaIcon sx={{ color: '#FF00C3' }} />,
                                'schema',
                                'schema_data.csv',
                                'schema_data.json'
                              )}
                            </Grid>
                          )}

                          {listData.length > 0 && (
                            <Grid item xs={12} md={columnWidth} sx={{ display: 'flex' }}>
                              {renderDataCard(
                                [],
                                [],
                                t('run_content.captured_data.list_title'),
                                <ListIcon sx={{ color: '#FF00C3' }} />,
                                'list',
                                'list_data.csv',
                                'list_data.json',
                                true
                              )}
                            </Grid>
                          )}
                        </>
                      );
                    })()}
                  </Grid>
                )
              )}

              {renderExpandedView('schema')}
              {renderExpandedView('legacy')}

              {listData.map((_, index) => renderExpandedView(`list-${index}`))}
            </Box>
          )}

          {hasScreenshots && (
            <>
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant='h6' sx={{ display: 'flex', alignItems: 'center' }}>
                    <ImageIcon sx={{ marginRight: '15px' }} />
                    {t('run_content.captured_screenshot.title')}
                    <Chip
                      label={`${Object.keys(row.binaryOutput).length} ${Object.keys(row.binaryOutput).length === 1 ? 'item' : 'items'}`}
                      size="small"
                      sx={{ ml: 2, backgroundColor: '#FF00C3', color: 'white' }}
                    />
                  </Typography>
                  <Box>
                    <IconButton
                      onClick={() => setViewMode('horizontal')}
                      color={viewMode === 'horizontal' ? 'primary' : 'default'}
                      sx={{ color: viewMode === 'horizontal' ? '#FF00C3' : 'inherit' }}
                    >
                      <ViewModuleIcon />
                    </IconButton>
                    <IconButton
                      onClick={() => setViewMode('vertical')}
                      color={viewMode === 'vertical' ? 'primary' : 'default'}
                      sx={{ color: viewMode === 'vertical' ? '#FF00C3' : 'inherit' }}
                    >
                      <ViewListIcon />
                    </IconButton>
                  </Box>
                </Box>
              </Box>

              {viewMode === 'vertical' ? (
                <>
                  {Object.keys(row.binaryOutput).map((key, index) => {
                    try {
                      const imageUrl = row.binaryOutput[key];
                      return (
                        <Accordion defaultExpanded sx={{ mb: 2 }} key={`screenshot-${key}`}>
                          <AccordionSummary
                            expandIcon={<ExpandMoreIcon />}
                            aria-controls={`screenshot-${key}-content`}
                            id={`screenshot-${key}-header`}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <ImageIcon sx={{ color: '#FF00C3' }} />
                              <Typography variant='h6' sx={{ ml: 2 }}>
                                Screenshot {index + 1}
                              </Typography>
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                              <ButtonGroup size="small" variant="outlined">
                                <Button
                                  startIcon={<DownloadIcon />}
                                  href={imageUrl}
                                  download={key}
                                  sx={{ borderColor: '#FF00C3', color: '#FF00C3' }}
                                >
                                  {t('run_content.captured_screenshot.download')}
                                </Button>
                              </ButtonGroup>
                            </Box>
                            <Box>
                              <img
                                src={imageUrl}
                                alt={`Screenshot ${key}`}
                                style={{
                                  maxWidth: '100%',
                                  height: 'auto',
                                  border: '1px solid #e0e0e0',
                                  borderRadius: '4px'
                                }}
                              />
                            </Box>
                          </AccordionDetails>
                        </Accordion>
                      );
                    } catch (e) {
                      console.log(e);
                      return (
                        <Typography key={`screenshot-error-${key}`} color="error">
                          {key}: {t('run_content.captured_screenshot.render_failed')}
                        </Typography>
                      );
                    }
                  })}
                </>
              ) : (
                <Grid container spacing={3}>
                  {Object.keys(row.binaryOutput).map((key) => {
                    try {
                      const imageUrl = row.binaryOutput[key];
                      return (
                        <Grid item xs={12} md={6} key={`screenshot-${key}`}>
                          <Card sx={{ height: '100%', boxShadow: 3 }}>
                            <CardHeader
                              avatar={<ImageIcon sx={{ color: '#FF00C3' }} />}
                              title={`Screenshot ${key}`}
                              action={
                                <IconButton
                                  size="small"
                                  href={imageUrl}
                                  download={key}
                                  title={t('run_content.captured_screenshot.download')}
                                >
                                  <DownloadIcon />
                                </IconButton>
                              }
                            />
                            <CardContent sx={{ p: 1 }}>
                              <Box sx={{ position: 'relative', width: '100%', height: 'auto', overflow: 'hidden' }}>
                                <img
                                  src={imageUrl}
                                  alt={`Screenshot ${key}`}
                                  style={{
                                    width: '100%',
                                    height: 'auto',
                                    objectFit: 'contain',
                                    border: '1px solid #e0e0e0',
                                    borderRadius: '4px'
                                  }}
                                />
                              </Box>
                            </CardContent>
                          </Card>
                        </Grid>
                      );
                    } catch (e) {
                      console.log(e);
                      return (
                        <Box key={`screenshot-error-${key}`}>
                          <Typography color="error">
                            {key}: {t('run_content.captured_screenshot.render_failed')}
                          </Typography>
                        </Box>
                      );
                    }
                  })}
                </Grid>
              )}
            </>
          )}
        </TabPanel>
      </TabContext>
    </Box>
  );
};