import { Box, Tabs, Typography, Tab, Paper, Button } from "@mui/material";
import Highlight from "react-highlight";
import * as React from "react";
import { Data } from "./RunsTable";
import { TabPanel, TabContext } from "@mui/lab";
import ArticleIcon from '@mui/icons-material/Article';
import ImageIcon from '@mui/icons-material/Image';
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
  const [tab, setTab] = React.useState<string>('log');
  const [tableData, setTableData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    setTab(tab);
  }, [interpretationInProgress]);

  useEffect(() => {
    if (row.serializableOutput && Object.keys(row.serializableOutput).length > 0) {
      const firstKey = Object.keys(row.serializableOutput)[0];
      const data = row.serializableOutput[firstKey];
      if (Array.isArray(data)) {
        // Filter out completely empty rows
        const filteredData = data.filter(row =>
          Object.values(row).some(value => value !== undefined && value !== "")
        );
        setTableData(filteredData);
        if (filteredData.length > 0) {
          setColumns(Object.keys(filteredData[0]));
        }
      }
    }
  }, [row.serializableOutput]);


  // Function to convert table data to CSV format
  const convertToCSV = (data: any[], columns: string[]): string => {
    const header = columns.join(',');
    const rows = data.map(row =>
      columns.map(col => JSON.stringify(row[col], null, 2)).join(',')
    );
    return [header, ...rows].join('\n');
  };

  const downloadCSV = () => {
    const csvContent = convertToCSV(tableData, columns);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <TabContext value={tab}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs 
          value={tab} 
          onChange={(e, newTab) => setTab(newTab)} 
          aria-label="run-content-tabs"
          sx={{
            // Remove the default blue indicator
            '& .MuiTabs-indicator': {
              backgroundColor: '#FF00C3',  // Change to pink
            },
            // Remove default transition effects
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
                {interpretationInProgress ? currentLog : row.log}
              </Highlight>
              <div style={{ float: "left", clear: "both" }}
                ref={logEndRef} />
            </div>
          </Box>
          {interpretationInProgress ? <Button
            color="error"
            onClick={abortRunHandler}
          >
            {t('run_content.buttons.stop')}
          </Button> : null}
        </TabPanel>
        <TabPanel value='output' sx={{ width: '700px' }}>
          {!row || !row.serializableOutput || !row.binaryOutput
            || (Object.keys(row.serializableOutput).length === 0 && Object.keys(row.binaryOutput).length === 0)
            ? <Typography>{t('run_content.empty_output')}</Typography> : null}

          {row.serializableOutput &&
            Object.keys(row.serializableOutput).length !== 0 &&
            <div>
              <Typography variant='h6' sx={{ display: 'flex', alignItems: 'center' }}>
                <ArticleIcon sx={{ marginRight: '15px' }} />
                {t('run_content.captured_data.title')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                <Typography>
                  <a style={{ textDecoration: 'none' }} href={`data:application/json;utf8,${JSON.stringify(row.serializableOutput, null, 2)}`}
                    download="data.json">
                    {t('run_content.captured_data.download_json')}
                  </a>
                </Typography>
                <Typography
                  onClick={downloadCSV}
                >
                  <a style={{ textDecoration: 'none', cursor: 'pointer' }}>{t('run_content.captured_data.download_csv')}</a>
                </Typography>
              </Box>
              {tableData.length > 0 ? (
                <TableContainer component={Paper} sx={{ maxHeight: 440, marginTop: 2 }}>
                  <Table stickyHeader aria-label="sticky table">
                    <TableHead>
                      <TableRow>
                        {columns.map((column) => (
                          <TableCell key={column}>{column}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tableData.map((row, index) => (
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
              ) : (
                <Box sx={{
                  width: 'fit-content',
                  background: 'rgba(0,0,0,0.06)',
                  maxHeight: '300px',
                  overflow: 'scroll',
                  backgroundColor: '#19171c'
                }}>
                  <pre>
                    {JSON.stringify(row.serializableOutput, null, 2)}
                  </pre>
                </Box>
              )}
            </div>
          }
          {row.binaryOutput && Object.keys(row.binaryOutput).length !== 0 &&
            <div>
              <Typography variant='h6' sx={{ display: 'flex', alignItems: 'center' }}>
                <ImageIcon sx={{ marginRight: '15px' }} />
                {t('run_content.captured_screenshot.title')}
              </Typography>
              {Object.keys(row.binaryOutput).map((key) => {
                try {
                  const imageUrl = row.binaryOutput[key];
                  return (
                    <Box key={`number-of-binary-output-${key}`} sx={{
                      width: 'max-content',
                    }}>
                      <Typography sx={{ margin: '20px 0px' }}>
                        <a href={imageUrl} download={key} style={{ textDecoration: 'none' }}>{t('run_content.captured_screenshot.download')}</a>
                      </Typography>
                      <img src={imageUrl} alt={key} height='auto' width='700px' />
                    </Box>
                  )
                } catch (e) {
                  console.log(e)
                  return <Typography key={`number-of-binary-output-${key}`}>
                    {key}: {t('run_content.captured_screenshot.render_failed')}
                  </Typography>
                }
              })}
            </div>
          }
        </TabPanel>
      </TabContext>
    </Box>
  );
};
