import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Link,
  Tooltip,
  IconButton,
  Menu,
  MenuItem,
} from "@mui/material";
import * as React from "react";
import { Data } from "./RunsTable";
import { TabPanel, TabContext } from "@mui/lab";
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ImageIcon from '@mui/icons-material/Image';
import CodeIcon from '@mui/icons-material/Code';
import DescriptionIcon from '@mui/icons-material/Description';
import SubjectIcon from '@mui/icons-material/Subject';
import LinkIcon from '@mui/icons-material/Link';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import ViewListIcon from '@mui/icons-material/ViewList';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import SearchIcon from '@mui/icons-material/Search';
import PsychologyIcon from '@mui/icons-material/Psychology';
import StorageIcon from '@mui/icons-material/Storage';
import { ContentCopy, Check, ChevronLeft, ChevronRight } from "@mui/icons-material";
import { useEffect, useState, useRef, useCallback } from "react";
import JSZip from "jszip";
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useTranslation } from "react-i18next";
import { useThemeMode } from "../../context/theme-provider";
import DownloadIcon from '@mui/icons-material/Download';

interface ScreenshotTabsProps {
  screenshotVisible?: string;
  screenshotFullpage?: string;
  binaryOutput?: Record<string, any>;
  darkMode: boolean;
}

interface RunContentProps {
  row: Data,
  currentLog: string,
  interpretationInProgress: boolean,
  logEndRef: React.RefObject<HTMLDivElement>,
  abortRunHandler: () => void,
  workflowProgress: {
    current: number;
    total: number;
    percentage: number;
  } | null,
}

// NOTE: Keep all your existing imports from the original file, and ADD these three:
// import DownloadIcon from '@mui/icons-material/Download';
// import Menu from '@mui/material/Menu';
// import MenuItem from '@mui/material/MenuItem'; // (you likely already import this)

// ---------------------------------------------------------------------------
// Reusable download control: renders a single icon button if there's one
// download action, or an icon button + dropdown menu if there are several
// (e.g. "Download JSON" + "Download as CSV"). Always stops propagation so
// clicking it doesn't also toggle the parent Accordion open/closed.
// ---------------------------------------------------------------------------
const DownloadMenuButton: React.FC<{ actions: { label: string; onClick: () => void }[] }> = ({ actions }) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  if (!actions || actions.length === 0) return null;

  if (actions.length === 1) {
    return (
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          actions[0].onClick();
        }}
        sx={{ color: '#FF00C3' }}
        aria-label={actions[0].label}
      >
        <DownloadIcon fontSize="small" />
      </IconButton>
    );
  }

  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          setAnchorEl(e.currentTarget);
        }}
        sx={{ color: '#FF00C3' }}
        aria-label="Download options"
      >
        <DownloadIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={(e) => e.stopPropagation()}
      >
        {actions.map((action, idx) => (
          <MenuItem
            key={idx}
            onClick={() => {
              action.onClick();
              setAnchorEl(null);
            }}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

// ---------------------------------------------------------------------------
// Reusable AccordionSummary content: icon + title on the left, optional
// download action(s) on the right, right before the expand chevron.
// ---------------------------------------------------------------------------
const AccordionHeader: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  actions?: { label: string; onClick: () => void }[];
}> = ({ icon, title, actions }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', pr: 1 }}>
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      {icon}
      <Typography variant='subtitle1'>{title}</Typography>
    </Box>
    {actions && actions.length > 0 && <DownloadMenuButton actions={actions} />}
  </Box>
);

const ScreenshotTabs: React.FC<ScreenshotTabsProps> = ({ screenshotVisible, screenshotFullpage, binaryOutput, darkMode }) => {
  const [activeTab, setActiveTab] = React.useState(0);

  const tabs: { key: string; label: string; value: string }[] = [];
  if (screenshotVisible) tabs.push({ key: 'visible', label: 'Screenshot (Visible)', value: screenshotVisible });
  if (screenshotFullpage) tabs.push({ key: 'fullpage', label: 'Screenshot (Full Page)', value: screenshotFullpage });

  if (tabs.length === 0) return null;

  const getImageSrc = (val: string): string => {
    if (!val || typeof val !== 'string') return '';
    if (val.startsWith('http') || val.startsWith('data:')) return val;
    if (binaryOutput && binaryOutput[val]) {
      const item = binaryOutput[val];
      const binaryData = typeof item === 'object' && item !== null ? (item.data || item) : item;
      if (typeof binaryData === 'string') {
        return binaryData.startsWith('http') ? binaryData : `data:image/png;base64,${binaryData}`;
      }
    }
    return val.length > 50 ? `data:image/png;base64,${val}` : '';
  };

  const handleDownload = () => {
    const src = getImageSrc(tabs[activeTab].value);
    const link = document.createElement('a');
    link.href = src;
    link.download = `${tabs[activeTab].label}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', borderBottom: '1px solid', borderColor: darkMode ? '#2a3441' : '#dee2e6', flexGrow: 1 }}>
          {tabs.map((tab, idx) => (
            <Box
              key={tab.key}
              onClick={() => tabs.length > 1 && setActiveTab(idx)}
              sx={{
                px: 3, py: 1,
                cursor: tabs.length > 1 ? 'pointer' : 'default',
                backgroundColor: activeTab === idx ? (darkMode ? '#121111ff' : '#e9ecef') : 'transparent',
                borderBottom: activeTab === idx ? '3px solid #FF00C3' : 'none',
                color: darkMode ? '#fff' : '#000',
              }}
            >
              {tab.label}
            </Box>
          ))}
        </Box>
        <IconButton size="small" onClick={handleDownload} sx={{ color: '#FF00C3', ml: 1 }} aria-label="Download screenshot">
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box>
        <img
          src={getImageSrc(tabs[activeTab].value)}
          alt={tabs[activeTab].label}
          style={{ maxWidth: '100%', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.1)' }}
        />
      </Box>
    </>
  );
};

const CopyButton: React.FC<{ content: string; darkMode: boolean }> = ({ content, darkMode }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'} placement="left">
      <IconButton
        onClick={handleCopy}
        size="small"
        sx={{
          position: 'absolute',
          top: 8,
          right: 20,
          color: copied ? '#4caf50' : (darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)'),
          backgroundColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          '&:hover': {
            color: copied ? '#4caf50' : '',
            backgroundColor: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
          },
          zIndex: 1,
        }}
      >
        {copied ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
};

const stripCodeFences = (text: string): string => {
  return text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
};

const humanizeKey = (key: string): string => {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const stripMarkdownFormatting = (text: string): string => {
  return text
    .replace(/^[ \t]{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(^|[^*\w])\*(?!\*)([^*\n]+?)\*(?!\*)(?=[^*\w]|$)/g, '$1$2')
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[*+]\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
};

const objectToReadableText = (value: any, depth = 0): string => {
  const indent = '  '.repeat(depth);
  if (value === null || value === undefined || value === '') return '';

  if (Array.isArray(value)) {
    const isPrimitiveArray = value.every((v) => v === null || typeof v !== 'object');
    if (isPrimitiveArray) {
      return value.map((v) => `${indent}- ${String(v)}`).join('\n');
    }
    return value.map((v) => objectToReadableText(v, depth)).filter(Boolean).join('\n\n');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => {
        if (v === null || v === undefined || v === '') return '';
        const label = humanizeKey(k);
        if (typeof v === 'object') {
          const nested = objectToReadableText(v, depth + 1);
          return nested ? `${indent}${label}:\n${nested}` : '';
        }
        return `${indent}${label}: ${String(v)}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  return `${indent}${String(value)}`;
};

const formatAgentResultText = (content: string): string => {
  const stripped = stripCodeFences(content);
  try {
    const json = JSON.parse(stripped);
    if (json !== null && typeof json === 'object') {
      const value = json.result !== undefined ? json.result : json;
      const flattened = typeof value === 'string' ? value : objectToReadableText(value);
      return stripMarkdownFormatting(flattened || stripped);
    }
    return stripMarkdownFormatting(stripped);
  } catch {
    return stripMarkdownFormatting(stripped);
  }
};

const AgentResultView: React.FC<{ content: string; darkMode: boolean }> = ({ content }) => {
  const text = React.useMemo(() => formatAgentResultText(content), [content]);

  return (
    <Typography component="div" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: '14px', lineHeight: 1.7, m: 0, color: 'inherit' }}>
      {text}
    </Typography>
  );
};

export const RunContent = ({ row, currentLog, interpretationInProgress, logEndRef, abortRunHandler, workflowProgress }: RunContentProps) => {
  const { t } = useTranslation();
  const { darkMode } = useThemeMode();
  const [tab, setTab] = React.useState<string>('output');
  const [markdownContent, setMarkdownContent] = useState<string>('');
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [textContent, setTextContent] = useState<string>('');
  const [linksContent, setLinksContent] = useState<string[]>([]);
  const [summaryContent, setSummaryContent] = useState<string>('');
  const [smartQueryResult, setSmartQueryResult] = useState<string>('');

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

  const [crawlData, setCrawlData] = useState<any[][]>([]);
  const [crawlColumns, setCrawlColumns] = useState<string[][]>([]);
  const [crawlKeys, setCrawlKeys] = useState<string[]>([]);
  const [currentCrawlIndex, setCurrentCrawlIndex] = useState<number>(0);

  const [searchData, setSearchData] = useState<any[]>([]);
  const [searchMode, setSearchMode] = useState<'discover' | 'scrape'>('discover');
  const [currentSearchIndex, setCurrentSearchIndex] = useState<number>(0);

  const [screenshotKeys, setScreenshotKeys] = useState<string[]>([]);
  const [rawScreenshotKeys, setRawScreenshotKeys] = useState<string[]>([]);
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState<number>(0);
  const [currentSchemaIndex, setCurrentSchemaIndex] = useState<number>(0);

  const [legacyData, setLegacyData] = useState<any[]>([]);
  const [legacyColumns, setLegacyColumns] = useState<string[]>([]);
  const [isLegacyData, setIsLegacyData] = useState<boolean>(false);

  const searchTabsRef = useRef<HTMLDivElement>(null);
  const crawlTabsRef = useRef<HTMLDivElement>(null);

  // Reusable hook: tracks whether a scroll container overflows and where it's scrolled to
  const useTabScroll = (ref: React.RefObject<HTMLDivElement>, deps: any[]) => {
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const updateScrollState = useCallback(() => {
      const el = ref.current;
      if (!el) return;
      const hasOverflow = el.scrollWidth > el.clientWidth + 1; // +1 to avoid subpixel false positives
      setCanScrollLeft(hasOverflow && el.scrollLeft > 0);
      setCanScrollRight(hasOverflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    }, [ref]);

    useEffect(() => {
      updateScrollState();
      const el = ref.current;
      if (!el) return;

      el.addEventListener('scroll', updateScrollState);
      window.addEventListener('resize', updateScrollState);
      return () => {
        el.removeEventListener('scroll', updateScrollState);
        window.removeEventListener('resize', updateScrollState);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updateScrollState, ...deps]);

    return { canScrollLeft, canScrollRight, hasOverflow: canScrollLeft || canScrollRight };
  };

  const scrollTabs = (ref: React.RefObject<HTMLDivElement>, direction: 'left' | 'right') => {
    if (ref.current) {
      ref.current.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
    }
  };

  const { canScrollLeft: searchCanLeft, canScrollRight: searchCanRight } = useTabScroll(searchTabsRef, [searchData.length]);
  const { canScrollLeft: crawlCanLeft, canScrollRight: crawlCanRight } = useTabScroll(crawlTabsRef, [crawlData[0]?.length]);

  useEffect(() => {
    setTab(tab);
  }, [interpretationInProgress]);

  const getProgressMessage = (percentage: number): string => {
    if (percentage === 0) return 'Initializing workflow...';
    if (percentage < 25) return 'Starting execution...';
    if (percentage < 50) return 'Processing actions...';
    if (percentage < 75) return 'Extracting data...';
    if (percentage < 100) return 'Finalizing results...';
    return 'Completing...';
  };

  useEffect(() => {
    setMarkdownContent('');
    setHtmlContent('');
    setSmartQueryResult('');
    setTextContent('');
    setLinksContent([]);
    setSummaryContent('');

    if (!row.serializableOutput) return;

    const extractFromOutput = (output: any) => {
      if (output?.markdown && Array.isArray(output.markdown)) {
        const markdownData = output.markdown[0];
        if (markdownData?.content) setMarkdownContent(markdownData.content);
      }

      if (output?.html && Array.isArray(output.html)) {
        const htmlData = output.html[0];
        if (htmlData?.content) setHtmlContent(htmlData.content);
      }

      const textOutput = output?.textContent || output?.text;
      if (textOutput) {
        if (Array.isArray(textOutput)) {
          const textData = textOutput[0];
          if (typeof textData === 'string') {
            setTextContent(textData);
          } else if (textData && typeof textData === 'object' && textData.content) {
            setTextContent(textData.content);
          } else if (textData && typeof textData === 'object' && textData.text) {
            setTextContent(textData.text);
          }
        } else if (typeof textOutput === 'string') {
          setTextContent(textOutput);
        }
      }

      if (output?.links && Array.isArray(output.links) && output.links.length > 0) {
        const urls: string[] = output.links.map((item: any) =>
          typeof item === 'string' ? item : item?.url ?? ''
        ).filter(Boolean);
        if (urls.length > 0) setLinksContent(urls);
      }

      if (output?.summary && Array.isArray(output.summary)) {
        const summaryData = output.summary[0];
        if (summaryData?.content) {
          setSummaryContent(summaryData.content);
        }
      }
    };

    extractFromOutput(row.serializableOutput);

    if (row.serializableOutput.scrape) {
      extractFromOutput(row.serializableOutput.scrape);
    }

    const textOutput = row.serializableOutput?.textContent || row.serializableOutput?.text;
    if (textOutput) {
      if (Array.isArray(textOutput)) {
        const textData = textOutput[0];
        if (typeof textData === 'string') {
          setTextContent(textData);
        } else if (textData && typeof textData === 'object' && textData.content) {
          setTextContent(textData.content);
        } else if (textData && typeof textData === 'object' && textData.text) {
          setTextContent(textData.text);
        }
      } else if (typeof textOutput === 'string') {
        setTextContent(textOutput);
      }
    }

    const promptResult = row.serializableOutput?.promptResult || row.serializableOutput?.smartQuery;
    if (promptResult && Array.isArray(promptResult)) {
      const sq = promptResult[0];
      const result = sq?.content || sq?.result;
      if (result) {
        setSmartQueryResult(result);
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
      setCrawlData([]);
      setCrawlColumns([]);
      setCrawlKeys([]);
      setSearchData([]);
      setLegacyData([]);
      setLegacyColumns([]);
      setIsLegacyData(false);
      setIsSchemaTabular(false);
      return;
    }

    if (!row.serializableOutput) return;

    const modernKeys = ['scrapeSchema', 'scrapeList', 'crawl', 'search', 'markdown', 'html', 'textContent', 'text', 'scrapeDoc', 'links', 'summary', 'promptResult'];
    const hasModernData = modernKeys.some(key => row.serializableOutput[key]);

    const hasLegacySchema = row.serializableOutput.scrapeSchema && Array.isArray(row.serializableOutput.scrapeSchema);
    const hasLegacyList = row.serializableOutput.scrapeList && Array.isArray(row.serializableOutput.scrapeList);
    const hasLegacyDataInOutput = Object.keys(row.serializableOutput).some(key => !modernKeys.includes(key));

    if (hasLegacySchema || hasLegacyList || (hasLegacyDataInOutput && !hasModernData)) {
      processLegacyData(row.serializableOutput);
      setIsLegacyData(true);
      return;
    }

    setIsLegacyData(false);

    if (row.serializableOutput.scrapeSchema && Object.keys(row.serializableOutput.scrapeSchema).length > 0) {
      processSchemaData(row.serializableOutput.scrapeSchema);
    }

    if (row.serializableOutput.scrapeList) {
      processScrapeList(row.serializableOutput.scrapeList);
    }

    if (row.serializableOutput.crawl) {
      processCrawl(row.serializableOutput.crawl);
    }

    if (row.serializableOutput.search) {
      processSearch(row.serializableOutput.search);
    }

    if (row.serializableOutput.scrapeDoc?.data) {
      const docData: Record<string, any> = row.serializableOutput.scrapeDoc.data;

      const formatLabel = (key: string): string =>
        key
          .replace(/_/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/\b\w/g, c => c.toUpperCase());

      const flat: Record<string, any> = {};
      const flatten = (obj: Record<string, any>, prefix = '') => {
        Object.entries(obj).forEach(([k, v]) => {
          const label = formatLabel(k);
          const key = prefix ? `${prefix} › ${label}` : label;
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            flatten(v, key);
          } else if (!Array.isArray(v) || (v.length > 0 && typeof v[0] !== 'object')) {
            flat[key] = Array.isArray(v) ? v.join(', ') : v;
          }
        });
      };
      flatten(docData);

      if (Object.keys(flat).length > 0) {
        const tabName = row.serializableOutput.scrapeDoc?.tabName || 'Extracted Data';
        processSchemaData({ [tabName]: [flat] });
      }

      const listInput: Record<string, any[]> = {};
      Object.entries(docData).forEach(([k, v]) => {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
          listInput[formatLabel(k)] = v.map((item: Record<string, any>) => {
            const formatted: Record<string, any> = {};
            Object.entries(item).forEach(([ik, iv]) => { formatted[formatLabel(ik)] = iv; });
            return formatted;
          });
        }
      });
      if (Object.keys(listInput).length > 0) {
        processScrapeList(listInput);
      }
    }
  }, [row.serializableOutput, row.status]);

  useEffect(() => {
    if (row.status === 'running' || row.status === 'queued' || row.status === 'scheduled') {
      setScreenshotKeys([]);
      setRawScreenshotKeys([]);
      setCurrentScreenshotIndex(0);
      return;
    }

    if (row.binaryOutput && Object.keys(row.binaryOutput).length > 0) {
      const rawKeys = Object.keys(row.binaryOutput);

      const isLegacyPattern = rawKeys.every(key => /^item-\d+-\d+$/.test(key));

      let normalizedScreenshotKeys: string[];

      if (isLegacyPattern) {
        normalizedScreenshotKeys = rawKeys.map((_, index) => `Screenshot ${index + 1}`);
      } else {
        normalizedScreenshotKeys = rawKeys.map((key, index) => {
          const crawlMatch = key.match(/^crawl-(\d+)-screenshot-(visible|fullpage)$/);
          if (crawlMatch) {
            const pageNo = crawlMatch[1];
            const type = crawlMatch[2] === 'visible' ? 'Visible' : 'Full Page';
            return `Page ${pageNo} (${type})`;
          }

          if (key === 'screenshot-visible' || key.includes('screenshot-visible')) {
            return 'Screenshot (Visible)';
          } else if (key === 'screenshot-fullpage' || key.includes('screenshot-fullpage')) {
            return 'Screenshot (Full Page)';
          } else if (!key || key.toLowerCase().includes("screenshot")) {
            return `Screenshot ${index + 1}`;
          }
          return key;
        });
      }

      const keyMap: Record<string, { id: string; label: string }> = {};
      normalizedScreenshotKeys.forEach((displayName, index) => {
        const rawKey = rawKeys[index];
        keyMap[rawKey] = { id: rawKey, label: displayName };
      });

      setScreenshotKeys(normalizedScreenshotKeys);
      setRawScreenshotKeys(rawKeys);
      setCurrentScreenshotIndex(0);
    } else {
      setScreenshotKeys([]);
      setRawScreenshotKeys([]);
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

  const processCrawl = (crawlDataInput: any) => {
    const tablesList: any[][] = [];
    const columnsList: string[][] = [];
    const keys: string[] = [];

    if (typeof crawlDataInput === 'object') {
      Object.keys(crawlDataInput).forEach(key => {
        const tableData = crawlDataInput[key];

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

    setCrawlData(tablesList);
    setCrawlColumns(columnsList);
    const normalizedCrawlKeys = keys.map((key, index) => {
      if (!key || key.toLowerCase().includes("crawl")) {
        return `Crawl ${index + 1}`;
      }
      return key;
    });

    setCrawlKeys(normalizedCrawlKeys);
    setCurrentCrawlIndex(0);
  };

  const processSearch = (searchDataInput: any) => {
    if (typeof searchDataInput === 'object') {
      const keys = Object.keys(searchDataInput);

      if (keys.length > 0) {
        const searchKey = keys[0];
        const searchInfo = searchDataInput[searchKey];

        if (searchInfo && searchInfo.results && Array.isArray(searchInfo.results)) {
          const mode = searchInfo.mode || 'discover';
          setSearchMode(mode);

          if (mode === 'scrape') {
            setSearchData(searchInfo.results);
          } else {
            const normalizedResults = searchInfo.results.map((result: any, index: number) => ({
              title: result.title || '-',
              url: result.url || '-',
              description: result.description || '-',
              position: result.position || index + 1,
            }));
            setSearchData(normalizedResults);
          }

          setCurrentSearchIndex(0);
        }
      }
    }
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

  const downloadText = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
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

  const downloadHTML = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/html;charset=utf-8;' });
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

  const resolveScreenshotSrc = (value?: string): string | null => {
    if (!value || typeof value !== 'string') return null;

    if (value.startsWith('http') || value.startsWith('data:')) {
      return value;
    }

    if (row.binaryOutput && row.binaryOutput[value]) {
      const binaryEntry = row.binaryOutput[value];
      const binaryData = typeof binaryEntry === 'object' && binaryEntry !== null
        ? (binaryEntry.data || binaryEntry)
        : binaryEntry;

      if (typeof binaryData === 'string') {
        if (binaryData.startsWith('http') || binaryData.startsWith('data:')) {
          return binaryData;
        }
        if (/^[A-Za-z0-9+/=]+$/.test(binaryData)) {
          return `data:image/png;base64,${binaryData}`;
        }
      }
    }

    return null;
  };

  const downloadAllCrawlsAsZip = async (crawlDataArray: any[], zipFilename: string) => {
    const zip = new JSZip();

    for (let index = 0; index < crawlDataArray.length; index++) {
      const item = crawlDataArray[index];
      const url = item?.metadata?.url || item?.url || '';
      const folderName = url
        ? url.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_')
        : `page_${index + 1}`;

      const pageFolder = zip.folder(folderName);
      if (!pageFolder) continue;

      pageFolder.file('metadata.json', JSON.stringify(item, null, 2));

      if (item.text) {
        const textContent = typeof item.text === 'object' ? JSON.stringify(item.text, null, 2) : String(item.text);
        pageFolder.file('content.txt', textContent);
      }

      if (item.html) {
        const htmlContent = typeof item.html === 'object' ? JSON.stringify(item.html, null, 2) : String(item.html);
        pageFolder.file('content.html', htmlContent);
      }

      if (item.markdown) {
        const mdContent = typeof item.markdown === 'object' ? JSON.stringify(item.markdown, null, 2) : String(item.markdown);
        pageFolder.file('content.md', mdContent);
      }

      if (item.links && Array.isArray(item.links)) {
        const uniqueLinks = Array.from(new Set(item.links));
        pageFolder.file('links.txt', uniqueLinks.join('\n'));
      }

      const screenshots = [
        { id: item.screenshotVisible, name: 'screenshot_visible.png' },
        { id: item.screenshotFullpage, name: 'screenshot_full_page.png' }
      ];

      for (const screenshot of screenshots) {
        const src = resolveScreenshotSrc(screenshot.id);
        if (!src) continue;

        if (src.startsWith('http')) {
          try {
            const response = await fetch(src);
            if (response.ok) {
              const blob = await response.blob();
              pageFolder.file(screenshot.name, blob);
            }
          } catch {
            // Skip screenshot download errors while building ZIP
          }
        } else if (src.startsWith('data:')) {
          const base64Data = src.replace(/^data:image\/\w+;base64,/, '');
          pageFolder.file(screenshot.name, base64Data, { base64: true });
        }
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", zipFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  };

  const downloadScreenshot = async (label: string, value: string) => {
    try {
      const src = resolveScreenshotSrc(value);
      if (!src) {
        console.warn(`[downloadScreenshot] No valid source for label: ${label}`);
        return;
      }

      if (typeof src === 'string' && src.startsWith('http')) {
        // Handles HTTP-based screenshots with error handling
        const response = await fetch(src);

        if (!response.ok) {
          const errorMsg = `Failed to download screenshot: ${response.status} ${response.statusText}`;
          console.error(errorMsg);
          alert(`Error: ${errorMsg}`);
          return;
        }

        try {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${label}.png`;
          a.click();
          window.URL.revokeObjectURL(url);
        } catch (blobError) {
          const errorMsg = 'Failed to process downloaded image. Please try again.';
          console.error(`[downloadScreenshot] Blob processing error:`, blobError);
          alert(errorMsg);
          return;
        }
      } else {
        // Handles URL based screenshots
        const link = document.createElement('a');
        link.href = src as string;
        link.download = `${label}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error downloading screenshot';
      console.error(`[downloadScreenshot] Error:`, error);
      alert(`Failed to download screenshot: ${errorMsg}`);
    }
  };

  // ---------------------------------------------------------------------
  // "Captured Screenshots" accordion (used as the standalone/global one).
  // Download action now lives in the header instead of the bottom of the body.
  // ---------------------------------------------------------------------
  const renderCapturedScreenshotsAccordion = (
    title: string,
    tabs: { key: string; label: string; value: string }[],
    currentIndex: number,
    setIndex: (idx: number) => void,
    idPrefix: string,
    defaultExpanded: boolean = true
  ) => {
    if (tabs.length === 0) return null;
    const activeIdx = Math.min(currentIndex, tabs.length - 1);
    const activeTab = tabs[activeIdx >= 0 ? activeIdx : 0];
    const activeSrc = resolveScreenshotSrc(activeTab?.value);

    return (
      <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <AccordionHeader
            icon={<ImageIcon sx={{ mr: 1 }} />}
            title={title}
            actions={activeTab ? [{ label: 'Download Screenshot', onClick: () => downloadScreenshot(activeTab.label, activeTab.value) }] : []}
          />
        </AccordionSummary>
        <AccordionDetails>
          {tabs.length > 1 && (
            <Box
              sx={{
                display: 'flex',
                borderBottom: '1px solid',
                borderColor: 'divider',
                mb: 2,
                overflowX: 'auto',
              }}
              role="tablist"
              aria-label={`${title} tabs`}
            >
              {tabs.map((tab, idx) => (
                <Box
                  key={tab.key}
                  role="tab"
                  id={`screenshot-tab-${idPrefix}-${tab.key}`}
                  aria-controls={`screenshot-tabpanel-${idPrefix}-${tab.key}`}
                  aria-selected={activeIdx === idx}
                  onClick={() => setIndex(idx)}
                  sx={{
                    px: 3,
                    py: 1,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    backgroundColor:
                      activeIdx === idx
                        ? darkMode
                          ? '#121111ff'
                          : '#e9ecef'
                        : 'transparent',
                    borderBottom: activeIdx === idx ? '3px solid #FF00C3' : 'none',
                    color: darkMode ? '#fff' : '#000',
                  }}
                >
                  {tab.label}
                </Box>
              ))}
            </Box>
          )}
          <Box
            role="tabpanel"
            id={`screenshot-tabpanel-${idPrefix}-${activeTab?.key || 'active'}`}
            aria-labelledby={`screenshot-tab-${idPrefix}-${activeTab?.key || 'active'}`}
            sx={{ mt: 1 }}
          >
            {activeSrc && (
              <img
                src={activeSrc as string}
                alt={activeTab?.label}
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  border: '1px solid #e0e0e0',
                  borderRadius: '4px',
                }}
              />
            )}
          </Box>
        </AccordionDetails>
      </Accordion>
    );
  };

  // ---------------------------------------------------------------------
  // Data table renderer. Download actions (JSON/CSV) now live in the
  // accordion header (title case) via a menu, instead of below the table.
  // For the title === '' case (used inline inside a parent-owned accordion,
  // e.g. Captured Texts/Lists tabs), we no longer render download buttons
  // here at all — the caller supplies them in its own accordion header.
  // ---------------------------------------------------------------------
  const renderDataTable = (
    data: any[],
    columns: string[],
    title: string,
    csvFilename: string,
    jsonFilename: string,
    isSchemaData: boolean = false
  ) => {
    if (data.length === 0) return null;

    const shouldShowAsKeyValue = isSchemaData && !isSchemaTabular && data.length === 1;

    if (!title || title.trim() === '') {
      return (
        <Box sx={{ width: 0, minWidth: '100%' }}>
          <TableContainer component={Paper} sx={{ maxHeight: 320, overflowX: 'auto' }}>
            <Table
              stickyHeader
              aria-label="sticky table"
              sx={{
                tableLayout: 'fixed',
                width: 'max-content',
                minWidth: `${Math.max(
                  (shouldShowAsKeyValue ? 2 : columns.length) * 160,
                  100
                )}px`,
              }}
            >
              <TableHead>
                <TableRow>
                  {shouldShowAsKeyValue ? (
                    <>
                      <TableCell sx={{ backgroundColor: darkMode ? '#11111' : '#f8f9fa', width: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        Label
                      </TableCell>
                      <TableCell sx={{ backgroundColor: darkMode ? '#11111' : '#f8f9fa', width: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        Value
                      </TableCell>
                    </>
                  ) : (
                    columns.map((column) => (
                      <TableCell
                        key={column}
                        sx={{
                          backgroundColor: darkMode ? '#11111' : '#f8f9fa',
                          width: 160,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={column}
                      >
                        {column}
                      </TableCell>
                    ))
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {shouldShowAsKeyValue ? (
                  columns.map((column) => {
                    const val =
                      data[0][column] === undefined || data[0][column] === ''
                        ? '-'
                        : typeof data[0][column] === 'object'
                          ? JSON.stringify(data[0][column])
                          : String(data[0][column]);
                    return (
                      <TableRow key={column}>
                        <TableCell sx={{ fontWeight: 500, width: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={column}>
                          {column}
                        </TableCell>
                        <TableCell sx={{ width: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={val}>
                          {val}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  data.map((row, index) => (
                    <TableRow key={index}>
                      {columns.map((column) => {
                        const val =
                          row[column] === undefined || row[column] === ''
                            ? '-'
                            : typeof row[column] === 'object'
                              ? JSON.stringify(row[column])
                              : String(row[column]);
                        return (
                          <TableCell key={column} sx={{ width: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={val}>
                            {val}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      );
    }

    return (
      <Accordion defaultExpanded sx={{ width: '100%', m: 0, mb: 2, boxSizing: 'border-box' }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls={`${title.toLowerCase()}-content`}
          id={`${title.toLowerCase()}-header`}
        >
          <AccordionHeader
            icon={<StorageIcon sx={{ mr: 1 }} />}
            title={title}
            actions={[
              { label: t('run_content.captured_data.download_json', 'Download JSON'), onClick: () => downloadJSON(data, jsonFilename) },
              { label: t('run_content.captured_data.download_csv', 'Download as CSV'), onClick: () => downloadCSV(data, columns, csvFilename, isSchemaData, isSchemaTabular) },
            ]}
          />
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer component={Paper} sx={{ maxHeight: 320 }}>
            <Table stickyHeader aria-label="sticky table">
              <TableHead>
                <TableRow>
                  {shouldShowAsKeyValue ? (
                    <>
                      <TableCell
                        sx={{
                          backgroundColor: darkMode ? '#11111' : '#f8f9fa',
                          minWidth: '100px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Label
                      </TableCell>
                      <TableCell
                        sx={{
                          backgroundColor: darkMode ? '#11111' : '#f8f9fa'
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
                          backgroundColor: darkMode ? '#11111' : '#f8f9fa'
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
                      <TableCell sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
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

  const hasData = schemaData.length > 0 || listData.length > 0 || crawlData.length > 0 || searchData.length > 0 || legacyData.length > 0;
  const hasScreenshots = row.binaryOutput && Object.keys(row.binaryOutput).length > 0;
  const hasMarkdown = markdownContent && markdownContent.length > 0;
  const hasHTML = htmlContent && htmlContent.length > 0;
  const hasTextFormat = textContent && textContent.length > 0;
  const hasLinks = linksContent && linksContent.length > 0;
  const hasSummary = summaryContent && summaryContent.length > 0;
  const promptResultData = smartQueryResult || null;
  const hasPromptResult = !!promptResultData;
  const hasCrawlPageScreenshots = crawlData.some(group => Array.isArray(group) && group.some((item: any) => item?.screenshotVisible || item?.screenshotFullpage));
  const hasSearchResultScreenshots = searchData.some((item: any) => item?.screenshotVisible || item?.screenshotFullpage);
  const showCapturedScreenshotSection = hasScreenshots && !hasCrawlPageScreenshots && !hasSearchResultScreenshots;
  const isExtractRobot = schemaData.length > 0 || listData.length > 0 || legacyData.length > 0 || (!hasMarkdown && !hasHTML && !hasTextFormat && !hasLinks && !hasSummary && crawlData.length === 0 && searchData.length === 0);

  return (
    <Box sx={{ width: '100%' }}>
      <TabContext value={tab}>
        <TabPanel value='output' sx={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', p: 2 }}>
          {row.status === 'running' || row.status === 'queued' ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                {workflowProgress ? (
                  <>
                    <CircularProgress
                      size={22}
                      sx={{ marginRight: '10px' }}
                    />
                    {getProgressMessage(workflowProgress.percentage)}
                  </>
                ) : (
                  <>
                    <CircularProgress size={22} sx={{ marginRight: '10px' }} />
                    {(row.interpreterSettings as any)?.robotType === 'doc-extract'
                      ? t('run_content.loading_document', 'Extracting document data...')
                      : (row.interpreterSettings as any)?.robotType === 'doc-parse'
                        ? t('run_content.loading_document_parse', 'Parsing document...')
                        : t('run_content.loading')}
                  </>
                )}
              </Box>
              {(row.interpreterSettings as any)?.robotType !== 'doc-extract' &&
                (row.interpreterSettings as any)?.robotType !== 'doc-parse' && (
                  <Button color="error" onClick={abortRunHandler} sx={{ mt: 1 }}>
                    {t('run_content.buttons.stop')}
                  </Button>
                )}
            </>
          ) : (!hasData && !hasScreenshots && !hasMarkdown && !hasHTML && !hasTextFormat && !hasLinks && !hasPromptResult && !hasSummary ? (
            <Box sx={{ p: 2 }}>
              <Typography paragraph>
                {t('run_content.no_data_found', 'No data found. Need help?')}{" "}
                <Link href="mailto:support@maxun.dev" underline="hover" color="#ff00c3">
                  {t('run_content.contact_support', 'Contact Support')}
                </Link>{" "}
                {t('run_content.or', 'or')}{" "}
                <Link
                  href="https://github.com/getmaxun/maxun/issues/new"
                  target="_blank"
                  rel="noopener"
                  underline="hover"
                  color="#ff00c3"
                >
                  {t('run_content.open_github_issue', 'Open a GitHub Issue')}
                </Link>.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {hasTextFormat && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<SubjectIcon sx={{ mr: 1 }} />}
                      title="Text Content"
                      actions={[{
                        label: 'Download Text',
                        onClick: () => downloadText(textContent, `${row.name || 'content'}.txt`),
                      }]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ position: 'relative' }}>
                      <Paper sx={{ p: 2, maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                        <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6, m: 0 }}>
                          {textContent}
                        </Typography>
                      </Paper>
                      <CopyButton content={textContent} darkMode={darkMode} />
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {hasHTML && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<CodeIcon sx={{ mr: 1 }} />}
                      title="HTML"
                      actions={[{
                        label: 'Download HTML',
                        onClick: () => downloadHTML(htmlContent, `${row.name || 'content'}.html`),
                      }]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ position: 'relative' }}>
                      <Paper sx={{ p: 2, maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                        <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6, m: 0, color: 'inherit' }}>
                          {htmlContent}
                        </Typography>
                      </Paper>
                      <CopyButton content={htmlContent} darkMode={darkMode} />
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {hasMarkdown && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<DescriptionIcon sx={{ mr: 1 }} />}
                      title="Markdown"
                      actions={[{
                        label: 'Download Markdown',
                        onClick: () => downloadMarkdown(markdownContent, `${row.name || 'content'}.md`),
                      }]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ position: 'relative' }}>
                      <Paper sx={{ p: 2, maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                        <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6, m: 0, color: 'inherit' }}>
                          {markdownContent}
                        </Typography>
                      </Paper>
                      <CopyButton content={markdownContent} darkMode={darkMode} />
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {hasLinks && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<LinkIcon sx={{ mr: 1 }} />}
                      title={`Links (${linksContent.length})`}
                      actions={[{
                        label: 'Download Links',
                        onClick: () => downloadText(Array.from(new Set(linksContent)).join('\n'), `${row.name || 'links'}.txt`),
                      }]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ position: 'relative' }}>
                      <Paper sx={{ p: 2, maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {Array.from(new Set(linksContent)).map((link: string, idx: number) => (
                            <Link key={idx} href={link} target="_blank" rel="noopener" sx={{ color: '#FF00C3', wordBreak: 'break-all', fontSize: '0.875rem' }}>
                              {link}
                            </Link>
                          ))}
                        </Box>
                      </Paper>
                      <CopyButton content={Array.from(new Set(linksContent)).join('\n')} darkMode={darkMode} />
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {hasSummary && crawlData.length === 0 && searchData.length === 0 && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<PsychologyIcon sx={{ mr: 1 }} />}
                      title="Summary"
                      actions={[{
                        label: 'Download Summary',
                        onClick: () => downloadMarkdown(summaryContent, `${row.name || 'summary'}.md`),
                      }]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ position: 'relative' }}>
                      <Paper sx={{ p: 2, pr: '50px', maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                        <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6, m: 0, color: 'inherit' }}>
                          {summaryContent}
                        </Typography>
                      </Paper>
                      <CopyButton content={summaryContent} darkMode={darkMode} />
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {hasPromptResult && promptResultData && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<PsychologyIcon sx={{ mr: 1 }} />}
                      title="Smart Queries"
                      actions={[{
                        label: 'Download Result',
                        onClick: () => {
                          const text = formatAgentResultText(promptResultData);
                          downloadText(text, `${row.name || 'agent'}-result.txt`);
                        },
                      }]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ position: 'relative' }}>
                      <Paper sx={{ p: 2, maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                        <AgentResultView content={promptResultData} darkMode={darkMode} />
                      </Paper>
                      <CopyButton content={formatAgentResultText(promptResultData)} darkMode={darkMode} />
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {(schemaData.length > 0 || listData.length > 0 || legacyData.length > 0) && (
                <>
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
                        <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <AccordionHeader
                              icon={<TextFieldsIcon sx={{ mr: 1 }} />}
                              title={t('run_content.captured_data.schema_title', 'Captured Texts')}
                              actions={[
                                {
                                  label: t('run_content.captured_data.download_json', 'Download JSON'),
                                  onClick: () => downloadJSON(
                                    schemaDataByKey[schemaKeys[currentSchemaIndex]] || schemaData,
                                    `${schemaKeys[currentSchemaIndex] || 'schema_data'}.json`
                                  ),
                                },
                                {
                                  label: t('run_content.captured_data.download_csv', 'Download as CSV'),
                                  onClick: () => downloadCSV(
                                    schemaDataByKey[schemaKeys[currentSchemaIndex]] || schemaData,
                                    schemaColumnsByKey[schemaKeys[currentSchemaIndex]] || schemaColumns,
                                    `${schemaKeys[currentSchemaIndex] || 'schema_data'}.csv`,
                                    true,
                                    isSchemaTabular
                                  ),
                                },
                              ]}
                            />
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
                                          ? darkMode
                                            ? '#121111ff'
                                            : '#e9ecef'
                                          : 'transparent',
                                      borderBottom: currentSchemaIndex === idx ? '3px solid #FF00C3' : 'none',
                                      color: darkMode ? '#fff' : '#000',
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
                              true
                            )}
                          </AccordionDetails>
                        </Accordion>
                      )}

                      {listData.length > 0 && (
                        <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <AccordionHeader
                              icon={<ViewListIcon sx={{ mr: 1 }} />}
                              title={t('run_content.captured_data.list_title', 'Captured Lists')}
                              actions={[
                                {
                                  label: t('run_content.captured_data.download_json', 'Download JSON'),
                                  onClick: () => downloadJSON(
                                    listData[currentListIndex],
                                    `${listKeys[currentListIndex] || 'list_data'}.json`
                                  ),
                                },
                                {
                                  label: t('run_content.captured_data.download_csv', 'Download as CSV'),
                                  onClick: () => downloadCSV(
                                    listData[currentListIndex],
                                    listColumns[currentListIndex] || [],
                                    `${listKeys[currentListIndex] || 'list_data'}.csv`,
                                    false,
                                    false
                                  ),
                                },
                              ]}
                            />
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
                                        ? darkMode
                                          ? '#121111ff'
                                          : '#e9ecef'
                                        : 'transparent',
                                    borderBottom: currentListIndex === idx ? '3px solid #FF00C3' : 'none',
                                    color: darkMode ? '#fff' : '#000',
                                  }}
                                >
                                  {key}
                                </Box>
                              ))}
                            </Box>

                            <Box sx={{ width: 0, minWidth: '100%' }}>
                              <TableContainer
                                component={Paper}
                                sx={{
                                  maxHeight: 320,
                                  overflowX: 'auto',
                                }}
                              >
                                <Table
                                  stickyHeader
                                  aria-label="captured-list-table"
                                  sx={{
                                    tableLayout: 'fixed',
                                    width: 'max-content',
                                    minWidth: `${Math.max((listColumns[currentListIndex] || []).length * 160, 100)}px`,
                                  }}
                                >
                                  <TableHead>
                                    <TableRow>
                                      {(listColumns[currentListIndex] || []).map((column) => (
                                        <TableCell
                                          key={column}
                                          sx={{
                                            backgroundColor: darkMode ? '#11111' : '#f8f9fa',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            width: 160,
                                          }}
                                          title={column}
                                        >
                                          {column}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  </TableHead>

                                  <TableBody>
                                    {(listData[currentListIndex] || []).map((rowItem, idx) => (
                                      <TableRow key={idx}>
                                        {(listColumns[currentListIndex] || []).map((column) => {
                                          const display =
                                            rowItem[column] === undefined || rowItem[column] === ''
                                              ? '-'
                                              : typeof rowItem[column] === 'object'
                                                ? JSON.stringify(rowItem[column])
                                                : String(rowItem[column]);
                                          return (
                                            <TableCell
                                              key={column}
                                              sx={{
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                width: 160,
                                              }}
                                              title={display}
                                            >
                                              {display}
                                            </TableCell>
                                          );
                                        })}
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </TableContainer>
                            </Box>
                          </AccordionDetails>
                        </Accordion>
                      )}
                    </>
                  )}
                </>
              )}

              {crawlData.length > 0 && crawlData[0] && crawlData[0].length > 0 && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<TravelExploreIcon sx={{ mr: 1 }} />}
                      title="Crawl Results"
                      actions={[
                        {
                          label: 'Download This Page',
                          onClick: () => {
                            const item = crawlData[0][currentCrawlIndex];
                            const pageUrl = item?.metadata?.url || item?.url || '';
                            const baseFilename = pageUrl
                              ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_')
                              : `page_${currentCrawlIndex + 1}`;
                            downloadAllCrawlsAsZip([item], `${baseFilename}_bundle.zip`);
                          },
                        },
                        {
                          label: 'Download All Pages',
                          onClick: () => {
                            const firstUrl = crawlData[0][0]?.metadata?.url || crawlData[0][0]?.url || '';
                            const baseFilename = firstUrl
                              ? firstUrl.replace(/^https?:\/\//, '').split('/')[0].replace(/[^a-zA-Z0-9_.-]/g, '_')
                              : 'crawl';
                            downloadAllCrawlsAsZip(crawlData[0], `${baseFilename}_all_urls.zip`);
                          },
                        },
                      ]}
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ width: 0, minWidth: '100%', display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                      {(crawlCanLeft || crawlCanRight) && (
                        <IconButton
                          size="small"
                          onClick={() => scrollTabs(crawlTabsRef, 'left')}
                          disabled={!crawlCanLeft}
                          sx={{ flexShrink: 0, opacity: crawlCanLeft ? 1 : 0.3, alignSelf: 'center' }}
                          aria-label="Scroll crawl results left"
                        >
                          <ChevronLeft fontSize="small" />
                        </IconButton>
                      )}
                      <Box
                        ref={crawlTabsRef}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          overflowX: 'auto',
                          borderBottom: '1px solid',
                          borderColor: darkMode ? '#2a3441' : '#dee2e6',
                          scrollbarWidth: 'none',
                          '&::-webkit-scrollbar': { display: 'none' },
                        }}
                      >
                        {crawlData[0].map((item: any, idx: number) => {
                          const url = item?.metadata?.url || item?.url || `URL ${idx + 1}`;
                          return (
                            <Box
                              key={idx}
                              onClick={() => setCurrentCrawlIndex(idx)}
                              sx={{
                                px: 2, py: 1, cursor: 'pointer',
                                backgroundColor: currentCrawlIndex === idx ? (darkMode ? '#121111ff' : '#e9ecef') : 'transparent',
                                borderBottom: currentCrawlIndex === idx ? '3px solid #FF00C3' : 'none',
                                color: darkMode ? '#fff' : '#000', whiteSpace: 'nowrap',
                                fontSize: '0.875rem', flexShrink: 0,
                              }}
                              title={url}
                            >
                              Link {idx + 1}
                            </Box>
                          );
                        })}
                      </Box>
                      {(crawlCanLeft || crawlCanRight) && (
                        <IconButton
                          size="small"
                          onClick={() => scrollTabs(crawlTabsRef, 'right')}
                          disabled={!crawlCanRight}
                          sx={{ flexShrink: 0, opacity: crawlCanRight ? 1 : 0.3, alignSelf: 'center' }}
                          aria-label="Scroll crawl results right"
                        >
                          <ChevronRight fontSize="small" />
                        </IconButton>
                      )}
                    </Box>

                    {crawlData[0][currentCrawlIndex] && (
                      <>
                        <Accordion defaultExpanded sx={{ mb: 2 }}>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <AccordionHeader
                              icon={<InfoOutlinedIcon sx={{ mr: 1 }} />}
                              title="Metadata"
                              actions={[{
                                label: 'Download Metadata',
                                onClick: () => {
                                  const pageUrl = crawlData[0][currentCrawlIndex]?.metadata?.url || crawlData[0][currentCrawlIndex]?.url || '';
                                  const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `page_${currentCrawlIndex + 1}`;
                                  downloadJSON(crawlData[0][currentCrawlIndex].metadata, `${baseFilename}_metadata.json`);
                                },
                              }]}
                            />
                          </AccordionSummary>
                          <AccordionDetails>
                            <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
                              <Table size="small">
                                <TableBody>
                                  {crawlData[0][currentCrawlIndex].metadata &&
                                    Object.entries(crawlData[0][currentCrawlIndex].metadata).map(([key, value]: [string, any]) => (
                                      <TableRow key={key}>
                                        <TableCell sx={{ fontWeight: 500, width: '200px' }}>
                                          {key}
                                        </TableCell>
                                        <TableCell sx={{ wordBreak: 'break-word' }}>
                                          {value === undefined || value === ''
                                            ? '-'
                                            : typeof value === 'object'
                                              ? JSON.stringify(value)
                                              : String(value)}
                                        </TableCell>
                                      </TableRow>
                                    ))
                                  }
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </AccordionDetails>
                        </Accordion>

                        {crawlData[0][currentCrawlIndex].text && (
                          <Accordion defaultExpanded sx={{ mb: 2 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <AccordionHeader
                                icon={<SubjectIcon sx={{ mr: 1 }} />}
                                title="Text Content"
                                actions={[{
                                  label: 'Download Text Content',
                                  onClick: () => {
                                    const pageUrl = crawlData[0][currentCrawlIndex]?.metadata?.url || crawlData[0][currentCrawlIndex]?.url || '';
                                    const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `page_${currentCrawlIndex + 1}`;
                                    const content = typeof crawlData[0][currentCrawlIndex].text === 'object' ? JSON.stringify(crawlData[0][currentCrawlIndex].text, null, 2) : crawlData[0][currentCrawlIndex].text;
                                    downloadText(content, `${baseFilename}_text.txt`);
                                  },
                                }]}
                              />
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box sx={{ position: 'relative' }}>
                                <Paper
                                  sx={{
                                    p: 2,
                                    maxHeight: '500px',
                                    overflow: 'auto',
                                    backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5'
                                  }}
                                >
                                  <Typography
                                    component="pre"
                                    sx={{
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      fontFamily: 'monospace',
                                      fontSize: '14px',
                                      lineHeight: 1.6,
                                      m: 0
                                    }}
                                  >
                                    {typeof crawlData[0][currentCrawlIndex].text === 'object'
                                      ? JSON.stringify(crawlData[0][currentCrawlIndex].text, null, 2)
                                      : crawlData[0][currentCrawlIndex].text}
                                  </Typography>
                                </Paper>
                                <CopyButton content={typeof crawlData[0][currentCrawlIndex].text === 'object' ? JSON.stringify(crawlData[0][currentCrawlIndex].text, null, 2) : crawlData[0][currentCrawlIndex].text} darkMode={darkMode} />
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        )}

                        {crawlData[0][currentCrawlIndex].html && (
                          <Accordion defaultExpanded sx={{ mb: 2 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <AccordionHeader
                                icon={<CodeIcon sx={{ mr: 1 }} />}
                                title="HTML"
                                actions={[{
                                  label: 'Download HTML',
                                  onClick: () => {
                                    const pageUrl = crawlData[0][currentCrawlIndex]?.metadata?.url || crawlData[0][currentCrawlIndex]?.url || '';
                                    const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `page_${currentCrawlIndex + 1}`;
                                    const content = typeof crawlData[0][currentCrawlIndex].html === 'object' ? JSON.stringify(crawlData[0][currentCrawlIndex].html, null, 2) : crawlData[0][currentCrawlIndex].html;
                                    downloadHTML(content, `${baseFilename}.html`);
                                  },
                                }]}
                              />
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box sx={{ position: 'relative' }}>
                                <Paper
                                  sx={{
                                    p: 2,
                                    maxHeight: '500px',
                                    overflow: 'auto',
                                    backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5'
                                  }}
                                >
                                  <Typography
                                    component="pre"
                                    sx={{
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      fontFamily: 'monospace',
                                      fontSize: '14px',
                                      lineHeight: 1.6,
                                      m: 0
                                    }}
                                  >
                                    {typeof crawlData[0][currentCrawlIndex].html === 'object'
                                      ? JSON.stringify(crawlData[0][currentCrawlIndex].html, null, 2)
                                      : crawlData[0][currentCrawlIndex].html}
                                  </Typography>
                                </Paper>
                                <CopyButton content={typeof crawlData[0][currentCrawlIndex].html === 'object' ? JSON.stringify(crawlData[0][currentCrawlIndex].html, null, 2) : crawlData[0][currentCrawlIndex].html} darkMode={darkMode} />
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        )}

                        {crawlData[0][currentCrawlIndex].markdown && (
                          <Accordion sx={{ mb: 2 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <AccordionHeader
                                icon={<DescriptionIcon sx={{ mr: 1 }} />}
                                title="Markdown"
                                actions={[{
                                  label: 'Download Markdown',
                                  onClick: () => {
                                    const pageUrl = crawlData[0][currentCrawlIndex]?.metadata?.url || crawlData[0][currentCrawlIndex]?.url || '';
                                    const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `page_${currentCrawlIndex + 1}`;
                                    const content = typeof crawlData[0][currentCrawlIndex].markdown === 'object' ? JSON.stringify(crawlData[0][currentCrawlIndex].markdown, null, 2) : crawlData[0][currentCrawlIndex].markdown;
                                    downloadMarkdown(content, `${baseFilename}.md`);
                                  },
                                }]}
                              />
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box sx={{ position: 'relative' }}>
                                <Paper
                                  sx={{
                                    p: 2,
                                    maxHeight: '500px',
                                    overflow: 'auto',
                                    backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5'
                                  }}
                                >
                                  <Typography
                                    component="pre"
                                    sx={{
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      fontFamily: 'monospace',
                                      fontSize: '14px',
                                      lineHeight: 1.6,
                                      m: 0
                                    }}
                                  >
                                    {typeof crawlData[0][currentCrawlIndex].markdown === 'object'
                                      ? JSON.stringify(crawlData[0][currentCrawlIndex].markdown, null, 2)
                                      : crawlData[0][currentCrawlIndex].markdown}
                                  </Typography>
                                </Paper>
                                <CopyButton content={typeof crawlData[0][currentCrawlIndex].markdown === 'object' ? JSON.stringify(crawlData[0][currentCrawlIndex].markdown, null, 2) : crawlData[0][currentCrawlIndex].markdown} darkMode={darkMode} />
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        )}

                        {(() => {
                          const validLinks = crawlData[0][currentCrawlIndex].links?.filter((link: any) =>
                            typeof link === 'string' && link.trim() !== ''
                          ) || [];

                          return validLinks.length > 0 && (
                            <Accordion sx={{ mb: 2 }}>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <AccordionHeader
                                  icon={<LinkIcon sx={{ mr: 1 }} />}
                                  title={`Links (${validLinks.length})`}
                                  actions={[{
                                    label: 'Download Links',
                                    onClick: () => {
                                      const pageUrl = crawlData[0][currentCrawlIndex]?.metadata?.url || crawlData[0][currentCrawlIndex]?.url || '';
                                      const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `page_${currentCrawlIndex + 1}`;
                                      const uniqueLinks = Array.from(new Set(validLinks));
                                      downloadText(uniqueLinks.join('\n'), `${baseFilename}_links.txt`);
                                    },
                                  }]}
                                />
                              </AccordionSummary>
                              <AccordionDetails>
                                <Box sx={{ position: 'relative' }}>
                                  <Paper sx={{ maxHeight: '500px', overflow: 'auto', p: 2, backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      {(Array.from(new Set(validLinks)) as string[]).map((link: string, idx: number) => (
                                        <Link key={idx} href={link} target="_blank" rel="noopener" sx={{ color: '#FF00C3', wordBreak: 'break-all', fontSize: '0.875rem' }}>
                                          {link}
                                        </Link>
                                      ))}
                                    </Box>
                                  </Paper>
                                  <CopyButton content={(Array.from(new Set(validLinks)) as string[]).join('\n')} darkMode={darkMode} />
                                </Box>
                              </AccordionDetails>
                            </Accordion>
                          );
                        })()}

                        {crawlData[0][currentCrawlIndex].summary && (
                          <Accordion>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <AccordionHeader
                                icon={<PsychologyIcon sx={{ mr: 1 }} />}
                                title="Summary"
                                actions={[{
                                  label: 'Download Summary',
                                  onClick: () => {
                                    const pageUrl = crawlData[0][currentCrawlIndex]?.metadata?.url || '';
                                    const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `page_${currentCrawlIndex + 1}`;
                                    const content = typeof crawlData[0][currentCrawlIndex].summary === 'string' ? crawlData[0][currentCrawlIndex].summary : crawlData[0][currentCrawlIndex].summary?.content || '';
                                    downloadMarkdown(content, `${baseFilename}_summary.md`);
                                  },
                                }]}
                              />
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box sx={{ position: 'relative' }}>
                                <Paper sx={{ p: 2, pr: '64px', maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                                  <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6, m: 0 }}>
                                    {typeof crawlData[0][currentCrawlIndex].summary === 'string'
                                      ? crawlData[0][currentCrawlIndex].summary
                                      : crawlData[0][currentCrawlIndex].summary?.content || ''}
                                  </Typography>
                                </Paper>
                                <CopyButton content={typeof crawlData[0][currentCrawlIndex].summary === 'string' ? crawlData[0][currentCrawlIndex].summary : crawlData[0][currentCrawlIndex].summary?.content || ''} darkMode={darkMode} />
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        )}

                        {(crawlData[0][currentCrawlIndex].screenshotVisible || crawlData[0][currentCrawlIndex].screenshotFullpage) && (
                          <Accordion>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <AccordionHeader
                                icon={<ImageIcon sx={{ mr: 1 }} />}
                                title={t('run_content.screenshot.title', 'Screenshots')}
                              />
                            </AccordionSummary>
                            <AccordionDetails>
                              <ScreenshotTabs
                                screenshotVisible={crawlData[0][currentCrawlIndex].screenshotVisible}
                                screenshotFullpage={crawlData[0][currentCrawlIndex].screenshotFullpage}
                                binaryOutput={row.binaryOutput}
                                darkMode={darkMode}
                              />
                            </AccordionDetails>
                          </Accordion>
                        )}
                      </>
                    )}
                  </AccordionDetails>
                </Accordion>
              )}

              {searchData.length > 0 && (
                <Accordion defaultExpanded sx={{ width: '100%', m: 0, boxSizing: 'border-box' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <AccordionHeader
                      icon={<SearchIcon sx={{ mr: 1 }} />}
                      title="Search Results"
                      actions={
                        searchMode === 'scrape'
                          ? [
                            {
                              label: 'Download This Page',
                              onClick: () => {
                                const item = searchData[currentSearchIndex];
                                const pageUrl = item?.metadata?.url || item?.url || '';
                                const baseFilename = pageUrl
                                  ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_')
                                  : `search_result_${currentSearchIndex + 1}`;
                                downloadAllCrawlsAsZip([item], `${baseFilename}_bundle.zip`);
                              },
                            },
                            {
                              label: 'Download All Results',
                              onClick: () => {
                                const firstUrl = searchData[0]?.metadata?.url || searchData[0]?.url || '';
                                const baseFilename = firstUrl
                                  ? firstUrl.replace(/^https?:\/\//, '').split('/')[0].replace(/[^a-zA-Z0-9_.-]/g, '_')
                                  : 'search_results';
                                downloadAllCrawlsAsZip(searchData, `${baseFilename}_all_results.zip`);
                              },
                            },
                          ]
                          : [
                            { label: 'Download as JSON', onClick: () => downloadJSON(searchData, 'search_results.json') },
                            { label: 'Download as CSV', onClick: () => downloadCSV(searchData, ['title', 'url', 'description'], 'search_results.csv') },
                          ]
                      }
                    />
                  </AccordionSummary>
                  <AccordionDetails>
                    {searchMode === 'scrape' && searchData.length > 0 ? (
                      <>
                        <Box sx={{ width: 0, minWidth: '100%', display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                          {(searchCanLeft || searchCanRight) && (
                            <IconButton
                              size="small"
                              onClick={() => scrollTabs(searchTabsRef, 'left')}
                              disabled={!searchCanLeft}
                              sx={{ flexShrink: 0, opacity: searchCanLeft ? 1 : 0.3, alignSelf: 'center' }}
                              aria-label="Scroll search results left"
                            >
                              <ChevronLeft fontSize="small" />
                            </IconButton>
                          )}
                          <Box
                            ref={searchTabsRef}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              overflowX: 'auto',
                              borderBottom: '1px solid',
                              borderColor: darkMode ? '#2a3441' : '#dee2e6',
                              scrollbarWidth: 'none',
                              '&::-webkit-scrollbar': {
                                display: 'none',
                              },
                            }}
                          >
                            {searchData.map((item: any, idx: number) => (
                              <Box key={idx} onClick={() => setCurrentSearchIndex(idx)}
                                sx={{
                                  px: 2, py: 1, cursor: 'pointer',
                                  backgroundColor: currentSearchIndex === idx ? (darkMode ? '#121111ff' : '#e9ecef') : 'transparent',
                                  borderBottom: currentSearchIndex === idx ? '3px solid #FF00C3' : 'none',
                                  color: darkMode ? '#fff' : '#000', whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                }}>Result {idx + 1}</Box>
                            ))}
                          </Box>
                          {(searchCanLeft || searchCanRight) && (
                            <IconButton
                              size="small"
                              onClick={() => scrollTabs(searchTabsRef, 'right')}
                              disabled={!searchCanRight}
                              sx={{ flexShrink: 0, opacity: searchCanRight ? 1 : 0.3, alignSelf: 'center' }}
                              aria-label="Scroll search results right"
                            >
                              <ChevronRight fontSize="small" />
                            </IconButton>
                          )}
                        </Box>

                        {searchData[currentSearchIndex] && (
                          <>
                            <Accordion defaultExpanded sx={{ mb: 2 }}>
                              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <AccordionHeader
                                  icon={<InfoOutlinedIcon sx={{ mr: 1 }} />}
                                  title="Metadata"
                                  actions={[{
                                    label: 'Download Metadata',
                                    onClick: () => {
                                      const res = searchData[currentSearchIndex];
                                      const pageUrl = res.metadata?.url || res.url || '';
                                      const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `search_result_${currentSearchIndex + 1}`;
                                      downloadJSON(res.metadata, `${baseFilename}_metadata.json`);
                                    },
                                  }]}
                                />
                              </AccordionSummary>
                              <AccordionDetails>
                                <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
                                  <Table size="small">
                                    <TableBody>
                                      {searchData[currentSearchIndex].metadata &&
                                        Object.entries(searchData[currentSearchIndex].metadata).map(([key, value]: [string, any]) => (
                                          <TableRow key={key}>
                                            <TableCell sx={{ fontWeight: 500, width: '200px' }}>
                                              {key}
                                            </TableCell>
                                            <TableCell sx={{ wordBreak: 'break-word' }}>
                                              {value === undefined || value === ''
                                                ? '-'
                                                : typeof value === 'object'
                                                  ? JSON.stringify(value)
                                                  : String(value)}
                                            </TableCell>
                                          </TableRow>
                                        ))
                                      }
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </AccordionDetails>
                            </Accordion>

                            {searchData[currentSearchIndex].text && (
                              <Accordion defaultExpanded sx={{ mb: 2 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <AccordionHeader
                                    icon={<SubjectIcon sx={{ mr: 1 }} />}
                                    title="Text Content"
                                    actions={[{
                                      label: 'Download Text Content',
                                      onClick: () => {
                                        const res = searchData[currentSearchIndex];
                                        const pageUrl = res.metadata?.url || res.url || '';
                                        const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `search_result_${currentSearchIndex + 1}`;
                                        const content = typeof res.text === 'object' ? JSON.stringify(res.text, null, 2) : res.text;
                                        downloadText(content, `${baseFilename}_text.txt`);
                                      },
                                    }]}
                                  />
                                </AccordionSummary>
                                <AccordionDetails>
                                  <Box sx={{ position: 'relative' }}>
                                    <Paper
                                      sx={{
                                        p: 2,
                                        maxHeight: '500px',
                                        overflow: 'auto',
                                        backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5'
                                      }}
                                    >
                                      <Typography
                                        component="pre"
                                        sx={{
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          fontFamily: 'monospace',
                                          fontSize: '14px',
                                          lineHeight: 1.6,
                                          m: 0
                                        }}
                                      >
                                        {searchData[currentSearchIndex].text}
                                      </Typography>
                                    </Paper>
                                    <CopyButton content={typeof searchData[currentSearchIndex].text === 'object' ? JSON.stringify(searchData[currentSearchIndex].text, null, 2) : searchData[currentSearchIndex].text} darkMode={darkMode} />
                                  </Box>
                                </AccordionDetails>
                              </Accordion>
                            )}

                            {searchData[currentSearchIndex].html && (
                              <Accordion defaultExpanded sx={{ mb: 2 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <AccordionHeader
                                    icon={<CodeIcon sx={{ mr: 1 }} />}
                                    title="HTML"
                                    actions={[{
                                      label: 'Download HTML',
                                      onClick: () => {
                                        const res = searchData[currentSearchIndex];
                                        const pageUrl = res.metadata?.url || res.url || '';
                                        const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `search_result_${currentSearchIndex + 1}`;
                                        const content = typeof res.html === 'object' ? JSON.stringify(res.html, null, 2) : res.html;
                                        downloadHTML(content, `${baseFilename}.html`);
                                      },
                                    }]}
                                  />
                                </AccordionSummary>
                                <AccordionDetails>
                                  <Box sx={{ position: 'relative' }}>
                                    <Paper
                                      sx={{
                                        p: 2,
                                        maxHeight: '500px',
                                        overflow: 'auto',
                                        backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5'
                                      }}
                                    >
                                      <Typography
                                        component="pre"
                                        sx={{
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          fontFamily: 'monospace',
                                          fontSize: '14px',
                                          lineHeight: 1.6,
                                          m: 0
                                        }}
                                      >
                                        {typeof searchData[currentSearchIndex].html === 'object'
                                          ? JSON.stringify(searchData[currentSearchIndex].html, null, 2)
                                          : searchData[currentSearchIndex].html}
                                      </Typography>
                                    </Paper>
                                    <CopyButton content={typeof searchData[currentSearchIndex].html === 'object' ? JSON.stringify(searchData[currentSearchIndex].html, null, 2) : searchData[currentSearchIndex].html} darkMode={darkMode} />
                                  </Box>
                                </AccordionDetails>
                              </Accordion>
                            )}

                            {searchData[currentSearchIndex].markdown && (
                              <Accordion sx={{ mb: 2 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <AccordionHeader
                                    icon={<DescriptionIcon sx={{ mr: 1 }} />}
                                    title="Markdown"
                                    actions={[{
                                      label: 'Download Markdown',
                                      onClick: () => {
                                        const res = searchData[currentSearchIndex];
                                        const pageUrl = res.metadata?.url || res.url || '';
                                        const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `search_result_${currentSearchIndex + 1}`;
                                        const content = typeof res.markdown === 'object' ? JSON.stringify(res.markdown, null, 2) : res.markdown;
                                        downloadMarkdown(content, `${baseFilename}.md`);
                                      },
                                    }]}
                                  />
                                </AccordionSummary>
                                <AccordionDetails>
                                  <Box sx={{ position: 'relative' }}>
                                    <Paper
                                      sx={{
                                        p: 2,
                                        maxHeight: '500px',
                                        overflow: 'auto',
                                        backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5'
                                      }}
                                    >
                                      <Typography
                                        component="pre"
                                        sx={{
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          fontFamily: 'monospace',
                                          fontSize: '14px',
                                          lineHeight: 1.6,
                                          m: 0
                                        }}
                                      >
                                        {typeof searchData[currentSearchIndex].markdown === 'object'
                                          ? JSON.stringify(searchData[currentSearchIndex].markdown, null, 2)
                                          : searchData[currentSearchIndex].markdown}
                                      </Typography>
                                    </Paper>
                                    <CopyButton content={typeof searchData[currentSearchIndex].markdown === 'object' ? JSON.stringify(searchData[currentSearchIndex].markdown, null, 2) : searchData[currentSearchIndex].markdown} darkMode={darkMode} />
                                  </Box>
                                </AccordionDetails>
                              </Accordion>
                            )}

                            {(() => {
                              const validLinks = searchData[currentSearchIndex].links?.filter((link: any) =>
                                typeof link === 'string' && link.trim() !== ''
                              ) || [];

                              return validLinks.length > 0 && (
                                <Accordion sx={{ mb: 2 }}>
                                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <AccordionHeader
                                      icon={<LinkIcon sx={{ mr: 1 }} />}
                                      title={`Links (${validLinks.length})`}
                                      actions={[{
                                        label: 'Download Links',
                                        onClick: () => {
                                          const res = searchData[currentSearchIndex];
                                          const pageUrl = res.metadata?.url || res.url || '';
                                          const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `search_result_${currentSearchIndex + 1}`;
                                          const uniqueLinks = Array.from(new Set(validLinks)) as string[];
                                          downloadText(uniqueLinks.join('\n'), `${baseFilename}_links.txt`);
                                        },
                                      }]}
                                    />
                                  </AccordionSummary>
                                  <AccordionDetails>
                                    <Box sx={{ position: 'relative' }}>
                                      <Paper sx={{ maxHeight: '500px', overflow: 'auto', p: 2, backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                          {(Array.from(new Set(validLinks)) as string[]).map((link: string, idx: number) => (
                                            <Link key={idx} href={link} target="_blank" rel="noopener" sx={{ color: '#FF00C3', wordBreak: 'break-all', fontSize: '0.875rem' }}>
                                              {link}
                                            </Link>
                                          ))}
                                        </Box>
                                      </Paper>
                                      <CopyButton content={(Array.from(new Set(validLinks)) as string[]).join('\n')} darkMode={darkMode} />
                                    </Box>
                                  </AccordionDetails>
                                </Accordion>
                              );
                            })()}

                            {searchData[currentSearchIndex]?.summary && (
                              <Accordion>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <AccordionHeader
                                    icon={<PsychologyIcon sx={{ mr: 1 }} />}
                                    title="Summary"
                                    actions={[{
                                      label: 'Download Summary',
                                      onClick: () => {
                                        const pageUrl = searchData[currentSearchIndex]?.url || searchData[currentSearchIndex]?.metadata?.url || '';
                                        const baseFilename = pageUrl ? pageUrl.replace(/^https?:\/\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_') : `result_${currentSearchIndex + 1}`;
                                        const content = typeof searchData[currentSearchIndex].summary === 'string' ? searchData[currentSearchIndex].summary : searchData[currentSearchIndex].summary?.content || '';
                                        downloadMarkdown(content, `${baseFilename}_summary.md`);
                                      },
                                    }]}
                                  />
                                </AccordionSummary>
                                <AccordionDetails>
                                  <Box sx={{ position: 'relative' }}>
                                    <Paper sx={{ p: 2, pr: '64px', maxHeight: '500px', overflow: 'auto', backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5' }}>
                                      <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '14px', lineHeight: 1.6, m: 0 }}>
                                        {typeof searchData[currentSearchIndex].summary === 'string'
                                          ? searchData[currentSearchIndex].summary
                                          : searchData[currentSearchIndex].summary?.content || ''}
                                      </Typography>
                                    </Paper>
                                    <CopyButton
                                      content={typeof searchData[currentSearchIndex].summary === 'string' ? searchData[currentSearchIndex].summary : searchData[currentSearchIndex].summary?.content || ''}
                                      darkMode={darkMode}
                                    />
                                  </Box>
                                </AccordionDetails>
                              </Accordion>
                            )}

                            {(searchData[currentSearchIndex].screenshotVisible || searchData[currentSearchIndex].screenshotFullpage) && (
                              <Accordion>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <AccordionHeader
                                    icon={<ImageIcon sx={{ mr: 1 }} />}
                                    title={t('run_content.screenshot.title', 'Screenshots')}
                                  />
                                </AccordionSummary>
                                <AccordionDetails>
                                  <ScreenshotTabs
                                    screenshotVisible={searchData[currentSearchIndex].screenshotVisible}
                                    screenshotFullpage={searchData[currentSearchIndex].screenshotFullpage}
                                    binaryOutput={row.binaryOutput}
                                    darkMode={darkMode}
                                  />
                                </AccordionDetails>
                              </Accordion>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <TableContainer component={Paper}>
                        <Table stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ backgroundColor: darkMode ? '#1e1e1e' : '#f8f9fa', whiteSpace: 'nowrap' }}>Title</TableCell>
                              <TableCell sx={{ backgroundColor: darkMode ? '#1e1e1e' : '#f8f9fa', whiteSpace: 'nowrap' }}>URL</TableCell>
                              <TableCell sx={{ backgroundColor: darkMode ? '#1e1e1e' : '#f8f9fa', whiteSpace: 'nowrap' }}>Description</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {searchData.map((r: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell sx={{ minWidth: 200 }}>{r.title || '-'}</TableCell>
                                <TableCell sx={{ minWidth: 250 }}>
                                  {r.url && r.url !== '-' ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Tooltip title={r.url}>
                                        <Link
                                          href={r.url}
                                          target="_blank"
                                          rel="noopener"
                                          sx={{
                                            color: '#FF00C3',
                                            textDecoration: 'none',
                                            '&:hover': { textDecoration: 'underline' },
                                            maxWidth: '200px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            display: 'block'
                                          }}
                                        >
                                          {r.url.length > 35 ? r.url.substring(0, 35) + '...' : r.url}
                                        </Link>
                                      </Tooltip>
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          navigator.clipboard.writeText(r.url);
                                        }}
                                        sx={{
                                          color: '#6c757d',
                                          '&:hover': { color: '#FF00C3' },
                                          p: 0.5
                                        }}
                                      >
                                        <ContentCopy sx={{ fontSize: '0.9rem' }} />
                                      </IconButton>
                                    </Box>
                                  ) : (
                                    '-'
                                  )}
                                </TableCell>
                                <TableCell sx={{ minWidth: 300 }}>{r.description || '-'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </AccordionDetails>
                </Accordion>
              )}
              {showCapturedScreenshotSection && renderCapturedScreenshotsAccordion(
                isExtractRobot ? t('run_content.captured_screenshot.title_extract', 'Captured Screenshots') : t('run_content.screenshot.title', 'Screenshots'),
                screenshotKeys.map((label, index) => ({ key: label, label, value: rawScreenshotKeys[index] })).filter(tab => tab.value),
                currentScreenshotIndex,
                setCurrentScreenshotIndex,
                'global-screenshots-secondary'
              )}
            </Box>
          ))}
        </TabPanel>
      </TabContext>
    </Box>
  );
};
