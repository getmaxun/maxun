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
  AccordionDetails
} from "@mui/material";
import Highlight from "react-highlight";
import * as React from "react";
import { Data } from "./RunsTable";
import { TabPanel, TabContext } from "@mui/lab";
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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
  const [markdownContent, setMarkdownContent] = useState<string>('');

  const [schemaData, setSchemaData] = useState<any[]>([]);
  const [schemaColumns, setSchemaColumns] = useState<string[]>([]);
  const [schemaKeys, setSchemaKeys] = useState<string[]>([]);
  const [schemaDataByKey, setSchemaDataByKey] = useState<Record<string, any[]>>({});
  const [schemaColumnsByKey, setSchemaColumnsByKey] = useState<Record<string, string[]>>({});
  const [isSchemaTabular, setIsSchemaTabular] = useState<boolean>(false);

  const [listData, setListData] = useState<any[][]>([]);
  const [listColumns, setListColumns] = useState<string[][]>([]);
  const [listKeys, setListKeys] = useState<string[]>([]);
  const [currentListIndex, setCurrentListIndex] = useState<number>(0);

  const [screenshotKeys, setScreenshotKeys] = useState<string[]>([]);
  const [screenshotKeyMap, setScreenshotKeyMap] = useState<Record<string, string>>({});
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState<number>(0);
  const [currentSchemaIndex, setCurrentSchemaIndex] = useState<number>(0);

  const [legacyData, setLegacyData] = useState<any[]>([]);
  const [legacyColumns, setLegacyColumns] = useState<string[]>([]);
  const [isLegacyData, setIsLegacyData] = useState<boolean>(false);

  useEffect(() => {
    setTab(tab);
  }, [interpretationInProgress]);

  useEffect(() => {
    if (row.serializableOutput?.markdown && Array.isArray(row.serializableOutput.markdown)) {
      const markdownData = row.serializableOutput.markdown[0];
      if (markdownData && markdownData.content) {
        setMarkdownContent(markdownData.content);
      }
    }
  }, [row.serializableOutput]);

  useEffect(() => {
    if (row.status === 'running' || row.status === 'queued' || row.status === 'scheduled') {
      setSchemaData([]);
      setSchemaColumns([]);
      setSchemaKeys([]);
      setSchemaDataByKey({});
      setSchemaColumnsByKey({});
      setListData([]);
      setListColumns([]);
      setListKeys([]);
      setLegacyData([]);
      setLegacyColumns([]);
      setIsLegacyData(false);
      setIsSchemaTabular(false);
      return;
    }

    if (!row.serializableOutput) return;

    const hasLegacySchema = row.serializableOutput.scrapeSchema && Array.isArray(row.serializableOutput.scrapeSchema);
    const hasLegacyList = row.serializableOutput.scrapeList && Array.isArray(row.serializableOutput.scrapeList);
    const hasOldFormat = !row.serializableOutput.scrapeSchema && !row.serializableOutput.scrapeList && Object.keys(row.serializableOutput).length > 0;

    if (hasLegacySchema || hasLegacyList || hasOldFormat) {
      processLegacyData(row.serializableOutput);
      setIsLegacyData(false);
      return;
    }

    setIsLegacyData(false);

    if (row.serializableOutput.scrapeSchema && Object.keys(row.serializableOutput.scrapeSchema).length > 0) {
      processSchemaData(row.serializableOutput.scrapeSchema);
    }

    if (row.serializableOutput.scrapeList) {
      processScrapeList(row.serializableOutput.scrapeList);
    }
  }, [row.serializableOutput, row.status]);

  useEffect(() => {
    if (row.status === 'running' || row.status === 'queued' || row.status === 'scheduled') {
      setScreenshotKeys([]);
      setScreenshotKeyMap({});
      setCurrentScreenshotIndex(0);
      return;
    }

    if (row.binaryOutput && Object.keys(row.binaryOutput).length > 0) {
      const rawKeys = Object.keys(row.binaryOutput);

      const isLegacyPattern = rawKeys.every(key => /^item-\d+-\d+$/.test(key));
      
      let normalizedScreenshotKeys: string[];

      if (isLegacyPattern) {
        // Legacy unnamed screenshots → Screenshot 1, Screenshot 2...
        normalizedScreenshotKeys = rawKeys.map((_, index) => `Screenshot ${index + 1}`);
      } else {
        // Same rule as captured lists: if name missing or generic, auto-label
        normalizedScreenshotKeys = rawKeys.map((key, index) => {
          if (!key || key.toLowerCase().includes("screenshot")) {
            return `Screenshot ${index + 1}`;
          }
          return key;
        });
      }

      const keyMap: Record<string, string> = {};
      normalizedScreenshotKeys.forEach((displayName, index) => {
        keyMap[displayName] = rawKeys[index];
      });

      setScreenshotKeys(normalizedScreenshotKeys);
      setScreenshotKeyMap(keyMap);
      setCurrentScreenshotIndex(0);
    } else {
      setScreenshotKeys([]);
      setScreenshotKeyMap({});
      setCurrentScreenshotIndex(0);
    }
  }, [row.binaryOutput, row.status]);

  const processLegacyData = (legacyOutput: Record<string, any>) => {
    const convertedSchema: Record<string, any[]> = {};
    const convertedList: Record<string, any[]> = {};

    const keys = Object.keys(legacyOutput);

    keys.forEach((key) => {
      const data = legacyOutput[key];

      if (Array.isArray(data)) {
        const firstNonNullElement = data.find(item => item !== null && item !== undefined);
        const isNestedArray = firstNonNullElement && Array.isArray(firstNonNullElement);

        if (isNestedArray) {
          data.forEach((subArray, index) => {
            if (subArray !== null && subArray !== undefined && Array.isArray(subArray) && subArray.length > 0) {
              const filteredData = subArray.filter(row =>
                row && typeof row === 'object' && Object.values(row).some(value => value !== undefined && value !== "")
              );

              if (filteredData.length > 0) {
                const autoName = `List ${Object.keys(convertedList).length + 1}`;
                convertedList[autoName] = filteredData;
              }
            }
          });
        } else {
          const filteredData = data.filter(row =>
            row && typeof row === 'object' && !Array.isArray(row) && Object.values(row).some(value => value !== undefined && value !== "")
          );

          if (filteredData.length > 0) {
            const schemaCount = Object.keys(convertedSchema).length;
            const autoName = `Text ${schemaCount + 1}`;
            convertedSchema[autoName] = filteredData;
          }
        }
      }
    });

    if (Object.keys(convertedSchema).length === 1) {
      const singleKey = Object.keys(convertedSchema)[0];
      const singleData = convertedSchema[singleKey];
      delete convertedSchema[singleKey];
      convertedSchema["Texts"] = singleData;
    }

    if (Object.keys(convertedSchema).length > 0) {
      processSchemaData(convertedSchema);
    }

    if (Object.keys(convertedList).length > 0) {
      processScrapeList(convertedList);
    }
  };

  const processSchemaData = (schemaOutput: any) => {
    const keys = Object.keys(schemaOutput);
    const normalizedKeys = keys.map((key, index) => {
      if (!key || key.toLowerCase().includes("scrapeschema")) {
        return keys.length === 1 ? "Texts" : `Text ${index + 1}`;
      }
      return key;
    });

    setSchemaKeys(normalizedKeys);

    const dataByKey: Record<string, any[]> = {};
    const columnsByKey: Record<string, string[]> = {};

    if (Array.isArray(schemaOutput)) {
      const filteredData = schemaOutput.filter(row =>
        row && typeof row === 'object' && Object.values(row).some(value => value !== undefined && value !== "")
      );

      if (filteredData.length > 0) {
        const allColumns = new Set<string>();
        filteredData.forEach(item => {
          Object.keys(item).forEach(key => allColumns.add(key));
        });

        setSchemaData(filteredData);
        setSchemaColumns(Array.from(allColumns));
        setIsSchemaTabular(filteredData.length > 1);
        return;
      }
    }

    let allData: any[] = [];
    let hasMultipleEntries = false;

    keys.forEach(key => {
      const data = schemaOutput[key];
      if (Array.isArray(data)) {
        const filteredData = data.filter(row =>
          row && typeof row === 'object' && Object.values(row).some(value => value !== undefined && value !== "")
        );

        dataByKey[key] = filteredData;

        const columnsForKey = new Set<string>();
        filteredData.forEach(item => {
          Object.keys(item).forEach(col => columnsForKey.add(col));
        });
        columnsByKey[key] = Array.from(columnsForKey);

        allData = [...allData, ...filteredData];
        if (filteredData.length > 1) hasMultipleEntries = true;
      }
    });

    const remappedDataByKey: Record<string, any[]> = {};
    const remappedColumnsByKey: Record<string, string[]> = {};

    normalizedKeys.forEach((newKey, idx) => {
      const oldKey = keys[idx];
      remappedDataByKey[newKey] = dataByKey[oldKey];
      remappedColumnsByKey[newKey] = columnsByKey[oldKey];
    });

    setSchemaDataByKey(remappedDataByKey);
    setSchemaColumnsByKey(remappedColumnsByKey);

    if (allData.length > 0) {
      const allColumns = new Set<string>();
      allData.forEach(item => {
        Object.keys(item).forEach(key => allColumns.add(key));
      });

      setSchemaData(allData);
      setSchemaColumns(Array.from(allColumns));
      setIsSchemaTabular(hasMultipleEntries || allData.length > 1);
    }
  };

  const processScrapeList = (scrapeListData: any) => {
    const tablesList: any[][] = [];
    const columnsList: string[][] = [];
    const keys: string[] = [];

    if (typeof scrapeListData === 'object') {
      Object.keys(scrapeListData).forEach(key => {
        const tableData = scrapeListData[key];
        if (Array.isArray(tableData) && tableData.length > 0) {
          const filteredData = tableData.filter(row =>
            row && typeof row === 'object' && Object.values(row).some(value => value !== undefined && value !== "")
          );
          if (filteredData.length > 0) {
            tablesList.push(filteredData);
            keys.push(key);
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
    const normalizedListKeys = keys.map((key, index) => {
      if (!key || key.toLowerCase().includes("scrapelist")) {
        return `List ${index + 1}`;
      }
      return key;
    });

    setListKeys(normalizedListKeys);
    setCurrentListIndex(0);
  };

  const convertToCSV = (data: any[], columns: string[], isSchemaData: boolean = false, isTabular: boolean = false): string => {
    if (isSchemaData && !isTabular && data.length === 1) {
      const header = 'Label,Value';
      const rows = columns.map(column => 
        `"${column}","${data[0][column] || ""}"`
      );
      return [header, ...rows].join('\n');
    } else {
      const header = columns.map(col => `"${col}"`).join(',');
      const rows = data.map(row =>
        columns.map(col => {
          const value = row[col] || "";
          const escapedValue = String(value).replace(/"/g, '""');
          return `"${escapedValue}"`;
        }).join(',')
      );
      return [header, ...rows].join('\n');
    }
  };

  // Function to download a specific dataset as CSV
  const downloadCSV = (data: any[], columns: string[], filename: string, isSchemaData: boolean = false, isTabular: boolean = false) => {
    const csvContent = convertToCSV(data, columns, isSchemaData, isTabular);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

  const downloadMarkdown = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
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


  const renderDataTable = (
    data: any[],
    columns: string[],
    title: string,
    csvFilename: string,
    jsonFilename: string,
    isPaginatedList: boolean = false,
    isSchemaData: boolean = false
  ) => {
    if (data.length === 0) return null;

    const shouldShowAsKeyValue = isSchemaData && !isSchemaTabular && data.length === 1;

    if (title === '') {
      return (
        <>
          <Box sx={{ mb: 2 }}>
            <TableContainer component={Paper} sx={{ maxHeight: 320 }}>
              <Table stickyHeader aria-label="sticky table">
                <TableHead>
                  <TableRow>
                    {shouldShowAsKeyValue ? (
                      <>
                        <TableCell
                          sx={{
                            backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                          }}
                        >
                          Label
                        </TableCell>
                        <TableCell
                          sx={{
                            backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                          }}
                        >
                          Value
                        </TableCell>
                      </>
                    ) : (
                      columns.map((column) => (
                        <TableCell
                          key={column}
                          sx={{
                            backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                          }}
                        >
                          {column}
                        </TableCell>
                      ))
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shouldShowAsKeyValue ? (
                    columns.map((column) => (
                      <TableRow key={column}>
                        <TableCell sx={{ fontWeight: 500 }}>
                          {column}
                        </TableCell>
                        <TableCell>
                          {data[0][column] === undefined || data[0][column] === ""
                            ? "-"
                            : (typeof data[0][column] === 'object'
                              ? JSON.stringify(data[0][column])
                              : String(data[0][column]))}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    data.map((row, index) => (
                      <TableRow key={index}>
                        {columns.map((column) => (
                          <TableCell key={column}>
                            {row[column] === undefined || row[column] === ""
                              ? "-"
                              : (typeof row[column] === 'object'
                                ? JSON.stringify(row[column])
                                : String(row[column]))}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Button
                component="a"
                onClick={() => downloadJSON(data, jsonFilename)}
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
                {t('run_content.captured_data.download_json', 'Download JSON')}
              </Button>

              <Button
                component="a"
                onClick={() => downloadCSV(data, columns, csvFilename, isSchemaData, isSchemaTabular)}
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
          </Box>
        </>
      );
    }

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
                onClick={() => downloadJSON(data, jsonFilename)}
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
                {t('run_content.captured_data.download_json', 'Download JSON')}
              </Button>

              <Button
                component="a"
                onClick={() => downloadCSV(data, columns, csvFilename, isSchemaData, isSchemaTabular)}
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
          </Box>
          <TableContainer component={Paper} sx={{ maxHeight: 320 }}>
            <Table stickyHeader aria-label="sticky table">
              <TableHead>
                <TableRow>
                  {shouldShowAsKeyValue ? (
                    <>
                      <TableCell
                        sx={{
                          backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                        }}
                      >
                        Label
                      </TableCell>
                      <TableCell
                        sx={{
                          backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                        }}
                      >
                        Value
                      </TableCell>
                    </>
                  ) : (
                    columns.map((column) => (
                      <TableCell
                        key={column}
                        sx={{
                          backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                        }}
                      >
                        {column}
                      </TableCell>
                    ))
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {shouldShowAsKeyValue ? (
                  columns.map((column) => (
                    <TableRow key={column}>
                      <TableCell sx={{ fontWeight: 500 }}>
                        {column}
                      </TableCell>
                      <TableCell>
                        {data[0][column] === undefined || data[0][column] === ""
                          ? "-"
                          : (typeof data[0][column] === 'object'
                            ? JSON.stringify(data[0][column])
                            : String(data[0][column]))}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  data.map((row, index) => (
                    <TableRow key={index}>
                      {columns.map((column) => (
                        <TableCell key={column}>
                          {row[column] === undefined || row[column] === ""
                            ? "-"
                            : (typeof row[column] === 'object'
                              ? JSON.stringify(row[column])
                              : String(row[column]))}
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
  const hasMarkdown = markdownContent.length > 0;

  return (
    <Box sx={{ width: '100%' }}>
      <TabContext value={tab}>
        <TabPanel value='output' sx={{ width: '100%', maxWidth: '900px' }}>
          {hasMarkdown ? (
            <Box>
              <Accordion defaultExpanded sx={{ mb: 2 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant='h6'>
                      Markdown Output
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Paper
                    sx={{
                      p: 2,
                      maxHeight: '500px',
                      overflow: 'auto',
                      backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5'
                    }}
                  >
                    <Typography
                      component="pre"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'monospace',
                        fontSize: '0.875rem'
                      }}
                    >
                      {markdownContent}
                    </Typography>
                  </Paper>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, mt: 2 }}>
                    <Box>
                      <Button
                        component="a"
                        onClick={() => downloadMarkdown(markdownContent, 'output.md')}
                        sx={{
                          color: '#FF00C3',
                          textTransform: 'none',
                          p: 0,
                          minWidth: 'auto',
                          backgroundColor: 'transparent',
                          '&:hover': {
                            backgroundColor: 'transparent',
                            textDecoration: 'underline',
                          },
                        }}
                      >
                        Download Markdown
                      </Button>
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Box>
          ) : (
            // Traditional robot output
            <>
          {row.status === 'running' || row.status === 'queued' ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CircularProgress size={22} sx={{ marginRight: '10px' }} />
                {t('run_content.loading')}
              </Box>
              <Button color="error" onClick={abortRunHandler} sx={{ mt: 1 }}>
                {t('run_content.buttons.stop')}
              </Button>
            </>
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
                  {schemaData.length > 0 && (
                    <Accordion defaultExpanded sx={{ mb: 2 }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant='h6'>
                            {t('run_content.captured_data.schema_title', 'Captured Texts')}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        {schemaKeys.length > 0 && (
                          <Box
                            sx={{
                              display: 'flex',
                              borderBottom: '1px solid',
                              borderColor: 'divider',
                              mb: 2,
                            }}
                          >
                            {schemaKeys.map((key, idx) => (
                              <Box
                                key={key}
                                onClick={() => setCurrentSchemaIndex(idx)}
                                sx={{
                                  px: 3,
                                  py: 1,
                                  cursor: 'pointer',
                                  backgroundColor:
                                    currentSchemaIndex === idx
                                      ? (theme) => theme.palette.mode === 'dark'
                                        ? '#121111ff'
                                        : '#e9ecef'
                                      : 'transparent',
                                  borderBottom: currentSchemaIndex === idx ? '3px solid #FF00C3' : 'none',
                                  color: (theme) => theme.palette.mode === 'dark' ? '#fff' : '#000',
                                }}
                              >
                                {key}
                              </Box>
                            ))}
                          </Box>
                        )}

                        {renderDataTable(
                          schemaDataByKey[schemaKeys[currentSchemaIndex]] || schemaData,
                          schemaColumnsByKey[schemaKeys[currentSchemaIndex]] || schemaColumns,
                          '',
                          `${schemaKeys[currentSchemaIndex] || 'schema_data'}.csv`,
                          `${schemaKeys[currentSchemaIndex] || 'schema_data'}.json`,
                          false,
                          true
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {listData.length > 0 && (
                    <Accordion defaultExpanded sx={{ mb: 2 }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant='h6'>
                            {t('run_content.captured_data.list_title', 'Captured Lists')}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Box
                          sx={{
                            display: 'flex',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            mb: 2,
                          }}
                        >
                          {listKeys.map((key, idx) => (
                            <Box
                              key={key}
                              onClick={() => setCurrentListIndex(idx)}
                              sx={{
                                px: 3,
                                py: 1,
                                cursor: 'pointer',
                                backgroundColor:
                                  currentListIndex === idx
                                    ? (theme) => theme.palette.mode === 'dark'
                                      ? '#121111ff'
                                      : '#e9ecef'
                                    : 'transparent',
                                borderBottom: currentListIndex === idx ? '3px solid #FF00C3' : 'none',
                                color: (theme) => theme.palette.mode === 'dark' ? '#fff' : '#000',
                              }}
                            >
                              {key}
                            </Box>
                          ))}
                        </Box>

                        <TableContainer component={Paper} sx={{ maxHeight: 320 }}>
                          <Table stickyHeader aria-label="captured-list-table">
                            <TableHead>
                              <TableRow>
                                {(listColumns[currentListIndex] || []).map((column) => (
                                  <TableCell
                                    key={column}
                                    sx={{
                                      backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#11111' : '#f8f9fa'
                                    }}
                                  >
                                    {column}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </TableHead>

                            <TableBody>
                              {(listData[currentListIndex] || []).map((rowItem, idx) => (
                                <TableRow key={idx}>
                                  {(listColumns[currentListIndex] || []).map((column) => (
                                    <TableCell key={column}>
                                      {rowItem[column] === undefined || rowItem[column] === ''
                                        ? '-'
                                        : typeof rowItem[column] === 'object'
                                        ? JSON.stringify(rowItem[column])
                                        : String(rowItem[column])}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>

                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            mb: 2,
                            mt: 2
                          }}
                        >
                          <Box>
                            <Button
                              component="a"
                              onClick={() =>
                                downloadJSON(
                                  listData[currentListIndex],
                                  `${listKeys[currentListIndex] || 'list_data'}.json`
                                )
                              }
                              sx={{
                                color: '#FF00C3',
                                textTransform: 'none',
                                mr: 2,
                                p: 0,
                                minWidth: 'auto',
                                backgroundColor: 'transparent',
                                '&:hover': {
                                  backgroundColor: 'transparent',
                                  textDecoration: 'underline',
                                },
                              }}
                            >
                              {t('run_content.captured_data.download_json', 'Download JSON')}
                            </Button>

                            <Button
                              component="a"
                              onClick={() =>
                                downloadCSV(
                                  listData[currentListIndex],
                                  listColumns[currentListIndex] || [],
                                  `${listKeys[currentListIndex] || 'list_data'}.csv`,
                                  false,
                                  false
                                )
                              }
                              sx={{
                                color: '#FF00C3',
                                textTransform: 'none',
                                p: 0,
                                minWidth: 'auto',
                                backgroundColor: 'transparent',
                                '&:hover': {
                                  backgroundColor: 'transparent',
                                  textDecoration: 'underline',
                                },
                              }}
                            >
                              {t('run_content.captured_data.download_csv', 'Download as CSV')}
                            </Button>
                          </Box>
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </>
              )}
            </Box>
          )}

          {hasScreenshots && (
            <Accordion defaultExpanded sx={{ mb: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Typography variant='h6'>
                    {t('run_content.captured_screenshot.title', 'Captured Screenshots')}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 2,
                  }}
                >
                  {screenshotKeys.length > 0 && (
                    <Box
                      sx={{
                        display: 'flex',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        mb: 2,
                      }}
                    >
                      {screenshotKeys.map((key, idx) => (
                        <Box
                          key={key}
                          onClick={() => setCurrentScreenshotIndex(idx)}
                          sx={{
                            px: 3,
                            py: 1,
                            cursor: 'pointer',
                            backgroundColor:
                              currentScreenshotIndex === idx
                                ? (theme) => theme.palette.mode === 'dark'
                                  ? '#121111ff'
                                  : '#e9ecef'
                                : 'transparent',
                            borderBottom: currentScreenshotIndex === idx ? '3px solid #FF00C3' : 'none',
                            color: (theme) => theme.palette.mode === 'dark' ? '#fff' : '#000',
                          }}
                        >
                          {key}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                <Box sx={{ mt: 1 }}>
                  {screenshotKeys.length > 0 && (
                    <img
                      src={row.binaryOutput[screenshotKeyMap[screenshotKeys[currentScreenshotIndex]]]}
                      alt={`Screenshot ${screenshotKeys[currentScreenshotIndex]}`}
                      style={{
                        maxWidth: '100%',
                        height: 'auto',
                        border: '1px solid #e0e0e0',
                        borderRadius: '4px'
                      }}
                    />
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}
          </>
          )}
        </TabPanel>
      </TabContext>
    </Box>
  );
};
