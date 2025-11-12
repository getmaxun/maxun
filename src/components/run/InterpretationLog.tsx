import * as React from 'react';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import Typography from '@mui/material/Typography';
import { Button, Grid, Box, TextField, IconButton, Tooltip } from '@mui/material';
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
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import { SidePanelHeader } from '../recorder/SidePanelHeader';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useThemeMode } from '../../context/theme-provider';
import { useTranslation } from 'react-i18next';
import { useBrowserSteps } from '../../context/browserSteps';
import { useActionContext } from '../../context/browserActions';
import { useSocketStore } from '../../context/socket';

interface InterpretationLogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const InterpretationLog: React.FC<InterpretationLogProps> = ({ isOpen, setIsOpen }) => {
  const { t } = useTranslation();

  const [captureListData, setCaptureListData] = useState<any[]>([]);
  const [captureTextData, setCaptureTextData] = useState<any[]>([]);
  const [screenshotData, setScreenshotData] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState(0);
  const [activeListTab, setActiveListTab] = useState(0);
  const [activeScreenshotTab, setActiveScreenshotTab] = useState(0);

  const [editingField, setEditingField] = useState<{listId: number, fieldKey: string} | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  const [editingTextGroupName, setEditingTextGroupName] = useState<boolean>(false);
  const [editingTextGroupNameValue, setEditingTextGroupNameValue] = useState<string>('Text Data');

  const [editing, setEditing] = useState<{
    stepId: number | null;
    type: 'list' | 'text' | 'screenshot' | null;
    value: string;
  }>({ stepId: null, type: null, value: '' });

  const logEndRef = useRef<HTMLDivElement | null>(null);
  const autoFocusedListIds = useRef<Set<number>>(new Set());
  const previousDataLengths = useRef<Map<number, number>>(new Map());
  const hasAutoFocusedTextTab = useRef<boolean>(false);
  const previousGetText = useRef<boolean>(false);
  const autoFocusedScreenshotIndices = useRef<Set<number>>(new Set());

  const { browserSteps, updateListTextFieldLabel, removeListTextField, updateListStepName, updateScreenshotStepName, updateBrowserTextStepLabel, deleteBrowserStep, deleteStepsByActionId, emitForStepId } = useBrowserSteps();
  const { captureStage, getText } = useActionContext();
  const { socket } = useSocketStore();

  const { browserWidth, outputPreviewHeight, outputPreviewWidth } = useBrowserDimensionsStore();
  const { currentWorkflowActionsState, shouldResetInterpretationLog, currentTextGroupName, setCurrentTextGroupName, notify } = useGlobalInfoStore();

  const [showPreviewData, setShowPreviewData] = useState<boolean>(false);
  const userClosedDrawer = useRef<boolean>(false);
  const lastListDataLength = useRef<number>(0);
  const lastTextDataLength = useRef<number>(0);
  const lastScreenshotDataLength = useRef<number>(0);

  const toggleDrawer = (newOpen: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
    if (
      event.type === 'keydown' &&
      ((event as React.KeyboardEvent).key === 'Tab' ||
        (event as React.KeyboardEvent).key === 'Shift')
    ) {
      return;
    }
    if (!newOpen && isOpen) {
      userClosedDrawer.current = true;
    }
    setIsOpen(newOpen);
  };

  const handleStartEdit = (listId: number, fieldKey: string, currentLabel: string) => {
    setEditingField({ listId, fieldKey });
    setEditingValue(currentLabel);
  };

  const handleSaveEdit = () => {
    if (editingField && editingValue.trim()) {
      const listStep = browserSteps.find(step => step.id === editingField.listId);
      const actionId = listStep?.actionId;

      updateListTextFieldLabel(editingField.listId, editingField.fieldKey, editingValue.trim());

      // Emit updated action to backend after state update completes
      if (actionId) {
        setTimeout(() => emitForStepId(actionId), 0);
      }

      setEditingField(null);
      setEditingValue('');
    }
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditingValue('');
  };

  const handleDeleteField = (listId: number, fieldKey: string) => {
    const listStep = browserSteps.find(step => step.id === listId);
    const actionId = listStep?.actionId;

    removeListTextField(listId, fieldKey);

    // Emit updated action to backend after state update completes
    if (actionId) {
      setTimeout(() => emitForStepId(actionId), 0);
    }
  };

  const handleStartEditTextGroupName = () => {
    setEditingTextGroupName(true);
    setEditingTextGroupNameValue(currentTextGroupName);
  };

  const handleSaveTextGroupName = () => {
    const trimmedName = editingTextGroupNameValue.trim();
    const finalName = trimmedName || 'Text Data';

    setCurrentTextGroupName(finalName);
    setEditingTextGroupName(false);

    // Emit after React updates global state
    setTimeout(() => {
      const activeTextStep = captureTextData.find(step => step.actionId);
      if (activeTextStep?.actionId) emitForStepId(activeTextStep.actionId);
    }, 0);
  };

  const handleDeleteTextStep = (textId: number) => {
    const textStep = browserSteps.find(step => step.id === textId);
    const actionId = textStep?.actionId;

    deleteBrowserStep(textId);

    // Emit updated action to backend after deletion
    if (actionId) {
      // Small delay to ensure state update completes
      setTimeout(() => emitForStepId(actionId), 0);
    }
  };

  const handleRemoveListAction = (listId: number, actionId: string | undefined) => {
    if (!actionId) return;

    const listIndex = captureListData.findIndex(list => list.id === listId);
    const listItem = captureListData[listIndex];
    const listName = listItem?.name || `List Data ${listIndex + 1}`;
    const isActiveList = listIndex === activeListTab;

    deleteStepsByActionId(actionId);

    if (socket) {
      socket.emit('removeAction', { actionId });
    }

    if (isActiveList && captureListData.length > 1) {
      if (listIndex === captureListData.length - 1) {
        setActiveListTab(listIndex - 1);
      }
    } else if (listIndex < activeListTab) {
      setActiveListTab(activeListTab - 1);
    }

    notify('error', `List "${listName}" discarded`);
  };

  const handleRemoveScreenshotAction = (screenshotId: number, actionId: string | undefined) => {
    if (!actionId) return;

    const screenshotSteps = browserSteps.filter(step => step.type === 'screenshot' && step.screenshotData);
    const screenshotIndex = screenshotSteps.findIndex(step => step.id === screenshotId);
    const screenshotStep = screenshotSteps[screenshotIndex];
    const screenshotName = screenshotStep?.name || `Screenshot ${screenshotIndex + 1}`;
    const isActiveScreenshot = screenshotIndex === activeScreenshotTab;

    deleteStepsByActionId(actionId);

    if (socket) {
      socket.emit('removeAction', { actionId });
    }

    if (isActiveScreenshot && screenshotData.length > 1) {
      if (screenshotIndex === screenshotData.length - 1) {
        setActiveScreenshotTab(screenshotIndex - 1);
      }
    } else if (screenshotIndex < activeScreenshotTab) {
      setActiveScreenshotTab(activeScreenshotTab - 1);
    }

    notify('error', `Screenshot "${screenshotName}" discarded`);
  };

  const handleRemoveAllTextActions = () => {
    const uniqueActionIds = new Set<string>();
    captureTextData.forEach(textStep => {
      if (textStep.actionId) {
        uniqueActionIds.add(textStep.actionId);
      }
    });

    uniqueActionIds.forEach(actionId => {
      deleteStepsByActionId(actionId);

      if (socket) {
        socket.emit('removeAction', { actionId });
      }
    });

    notify('error', `Text data "${currentTextGroupName}" discarded`);
  };
  
  const checkForDuplicateName = (stepId: number, type: 'list' | 'text' | 'screenshot', newName: string): boolean => {
    const trimmedName = newName.trim();

    if (type === 'list') {
      const listSteps = browserSteps.filter(step => step.type === 'list' && step.id !== stepId);
      const duplicate = listSteps.find(step => step.name === trimmedName);
      if (duplicate) {
        notify('error', `A list with the name "${trimmedName}" already exists. Please choose a different name.`);
        return true;
      }
    } else if (type === 'screenshot') {
      const screenshotSteps = browserSteps.filter(step => step.type === 'screenshot' && step.id !== stepId);
      const duplicate = screenshotSteps.find(step => step.name === trimmedName);
      if (duplicate) {
        notify('error', `A screenshot with the name "${trimmedName}" already exists. Please choose a different name.`);
        return true;
      }
    }

    return false;
  }

  const startEdit = (stepId: number, type: 'list' | 'text' | 'screenshot', currentValue: string) => {
    setEditing({ stepId, type, value: currentValue });
  };

  const saveEdit = () => {
    const { stepId, type, value } = editing;
    if (stepId == null || !type) return;

    const finalValue = value.trim();
    if (!finalValue) {
      setEditing({ stepId: null, type: null, value: '' });
      return;
    }

    if (checkForDuplicateName(stepId, type, finalValue)) {
      return;
    }

    if (type === 'list') {
      updateListStepName(stepId, finalValue);
    } else if (type === 'text') {
      updateBrowserTextStepLabel(stepId, finalValue);
    } else if (type === 'screenshot') {
      updateScreenshotStepName(stepId, finalValue);
    }

    const step = browserSteps.find(s => s.id === stepId);
    if (step?.actionId) setTimeout(() => emitForStepId(step.actionId!), 0);

    setEditing({ stepId: null, type: null, value: '' });
  };

  const cancelEdit = () => {
    setEditing({ stepId: null, type: null, value: '' });
  };


  const previousTabsCount = useRef({ lists: 0, texts: 0, screenshots: 0 });

  const updateActiveTab = useCallback(() => {
    const availableTabs = getAvailableTabs();
    const hasNewListData = captureListData.length > previousTabsCount.current.lists;
    const hasNewTextData = captureTextData.length > previousTabsCount.current.texts;
    const hasNewScreenshotData = screenshotData.length > previousTabsCount.current.screenshots;

    previousTabsCount.current = {
      lists: captureListData.length,
      texts: captureTextData.length,
      screenshots: screenshotData.length
    };

    if (hasNewListData && availableTabs.findIndex(tab => tab.id === 'captureList') !== -1) {
      setActiveTab(availableTabs.findIndex(tab => tab.id === 'captureList'));
    } else if (hasNewTextData && availableTabs.findIndex(tab => tab.id === 'captureText') !== -1) {
      setActiveTab(availableTabs.findIndex(tab => tab.id === 'captureText'));
    } else if (hasNewScreenshotData && availableTabs.findIndex(tab => tab.id === 'captureScreenshot') !== -1) {
      setActiveTab(availableTabs.findIndex(tab => tab.id === 'captureScreenshot'));
      // Set the active screenshot tab to the latest screenshot
      setActiveScreenshotTab(screenshotData.length - 1);
    }
  }, [captureListData.length, captureTextData.length, screenshotData.length]);


  useEffect(() => {
    const textSteps = browserSteps.filter(step => step.type === 'text');
    setCaptureTextData(textSteps);

    if (!getText && previousGetText.current && textSteps.length > 0) {
      if (!hasAutoFocusedTextTab.current) {
        hasAutoFocusedTextTab.current = true;
        setTimeout(() => {
          handleStartEditTextGroupName();
        }, 300);
      }
    }

    previousGetText.current = getText;

    const listSteps = browserSteps.filter(step => step.type === 'list');
    setCaptureListData(listSteps);

    const screenshotSteps = browserSteps.filter(step =>
      step.type === 'screenshot'
    ) as Array<{ type: 'screenshot'; id: number; name?: string; fullPage: boolean; actionId?: string; screenshotData?: string }>;

    const screenshotsWithData = screenshotSteps.filter(step => step.screenshotData);
    const screenshots = screenshotsWithData.map(step => step.screenshotData!);
    setScreenshotData(screenshots);

    if (textSteps.length > 0 || listSteps.length > 0 || screenshots.length > 0) {
      setShowPreviewData(true);
    } else {
      setShowPreviewData(false);
    }

    updateActiveTab();
  }, [browserSteps, updateActiveTab, getText]);

  useEffect(() => {
    if (shouldResetInterpretationLog) {
      setCaptureListData([]);
      setCaptureTextData([]);
      setScreenshotData([]);
      setActiveTab(0);
      setShowPreviewData(false);
      autoFocusedListIds.current.clear();
      previousDataLengths.current.clear();
      autoFocusedScreenshotIndices.current.clear();
      userClosedDrawer.current = false;
      lastListDataLength.current = 0;
      lastTextDataLength.current = 0;
      lastScreenshotDataLength.current = 0;
      previousTabsCount.current = { lists: 0, texts: 0, screenshots: 0 };
      hasAutoFocusedTextTab.current = false;
      previousGetText.current = false;
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
    let shouldOpenDrawer = false;

    if (hasScrapeListAction && captureListData.length > 0 && captureListData[0]?.data?.length > 0) {
      setShowPreviewData(true);
      if (captureListData.length > lastListDataLength.current) {
        userClosedDrawer.current = false;
        shouldOpenDrawer = true;
      }
      lastListDataLength.current = captureListData.length;
    } else if (hasScrapeListAction && captureListData.length === 0) {
      lastListDataLength.current = 0;
    }

    if (hasScrapeSchemaAction && captureTextData.length > 0 && !getText) {
      setShowPreviewData(true);
      if (captureTextData.length > lastTextDataLength.current) {
        userClosedDrawer.current = false;
        shouldOpenDrawer = true;
      }
      lastTextDataLength.current = captureTextData.length;
    } else if (hasScrapeSchemaAction && captureTextData.length === 0) {
      lastTextDataLength.current = 0;
    }

    if (hasScreenshotAction && screenshotData.length > 0) {
      setShowPreviewData(true);
      if (screenshotData.length > lastScreenshotDataLength.current) {
        userClosedDrawer.current = false;
        shouldOpenDrawer = true;
      }
      lastScreenshotDataLength.current = screenshotData.length;
    } else if (hasScreenshotAction && screenshotData.length === 0) {
      lastScreenshotDataLength.current = 0;
    }

    const getLatestCaptureType = () => {
      for (let i = browserSteps.length - 1; i >= 0; i--) {
        const type = browserSteps[i].type;
        if (type === "list" || type === "text" || type === "screenshot") {
          return type;
        }
      }
      return null;
    };

    if (shouldOpenDrawer) {
      setIsOpen(true);
      const latestType = getLatestCaptureType();

      setTimeout(() => {
        if (latestType === "text") {
          const idx = getAvailableTabs().findIndex(t => t.id === "captureText");
          if (idx !== -1) setActiveTab(idx);

        } else if (latestType === "list") {
          const idx = getAvailableTabs().findIndex(t => t.id === "captureList");
          if (idx !== -1) setActiveTab(idx);

        } else if (latestType === "screenshot") {
          const screenshotTabIndex = getAvailableTabs().findIndex(tab => tab.id === "captureScreenshot");
          if (screenshotTabIndex !== -1) {
            setActiveTab(screenshotTabIndex);
            const latestIndex = screenshotData.length - 1;
            setActiveScreenshotTab(latestIndex);

            if (!autoFocusedScreenshotIndices.current.has(latestIndex)) {
              autoFocusedScreenshotIndices.current.add(latestIndex);
              setTimeout(() => {
                const screenshotSteps = browserSteps.filter(step => step.type === "screenshot");
                const latestScreenshotStep = screenshotSteps[latestIndex];
                if (latestScreenshotStep) {
                  const screenshotName = latestScreenshotStep.name || `Screenshot ${latestIndex + 1}`;
                  startEdit(latestScreenshotStep.id, 'screenshot', screenshotName);
                }
              }, 300);
            }
          }
        }
      }, 100);
    }
  }, [hasScrapeListAction, hasScrapeSchemaAction, hasScreenshotAction, captureListData, captureTextData, screenshotData, setIsOpen, getText]);

  useEffect(() => {
    if (captureListData.length > 0 && isOpen && captureStage === 'initial') {
      const latestListIndex = captureListData.length - 1;
      const latestList = captureListData[latestListIndex];
      if (latestList && latestList.data && latestList.data.length > 0  && editing.type !== 'list') {
        const previousLength = previousDataLengths.current.get(latestList.id) || 0;
        const currentLength = latestList.data.length;

        if (previousLength === 0 && currentLength > 0) {
          if (!autoFocusedListIds.current.has(latestList.id)) {
            autoFocusedListIds.current.add(latestList.id);
            setActiveListTab(latestListIndex);
            setTimeout(() => {
              startEdit(latestList.id, 'list', latestList.name || `List Data ${latestListIndex + 1}`);
            }, 300);
          }
        }

        previousDataLengths.current.set(latestList.id, currentLength);
      }
    }
  }, [captureListData.length, isOpen, captureStage]);

  useEffect(() => {
    if (screenshotData.length > 0 && isOpen) {
      const latestScreenshotIndex = screenshotData.length - 1;
      setActiveScreenshotTab(latestScreenshotIndex);
    }
  }, [screenshotData.length, isOpen]);

  const { darkMode } = useThemeMode();

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
              background: `${darkMode ? '#1d1c1cff' : 'white'}`,
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

          {!(hasScrapeListAction || hasScrapeSchemaAction || hasScreenshotAction) && !showPreviewData && availableTabs.length === 0 && (
            <Grid container justifyContent="center" alignItems="center" style={{ height: '100%' }}>
              <Grid item>
                <Typography variant="h6" gutterBottom align="left">
                  {t('interpretation_log.messages.no_selection')}
                </Typography>
              </Grid>
            </Grid>
          )}

          {showPreviewData && availableTabs.length > 0 && (
            <>
              {shouldShowTabs && (
                <Box 
                  sx={{
                    display: 'flex',
                    borderBottom: '1px solid',
                    borderColor: darkMode ? '#080808ff' : '#dee2e6',
                    backgroundColor: darkMode ? '#080808ff' : '#f8f9fa'
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
                        // borderBottom: activeTab === index ? '2px solid' : 'none',
                        borderColor: activeTab === index ? (darkMode ? '#ff00c3' : '#ff00c3') : 'transparent',
                        backgroundColor: activeTab === index ? (darkMode ? '#121111ff' : '#e9ecef') : 'transparent',
                        color: darkMode ? 'white' : 'black',
                        fontWeight: activeTab === index ? 500 : 400,
                        textAlign: 'center',
                        position: 'relative',
                        '&:hover': {
                          backgroundColor: activeTab !== index ? (darkMode ? '#121111ff' : '#e2e6ea') : undefined
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
              
              <Box sx={{ flexGrow: 1, overflow: 'hidden', p: 0, display: 'flex', flexDirection: 'column' }}>
                {(activeTab === availableTabs.findIndex(tab => tab.id === 'captureList') ||
                  singleContentType === 'captureList') &&
                  captureListData.length > 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                      {/* List Tabs */}
                      <Box
                        sx={{
                          display: 'flex',
                          pt: 2,
                          position: 'sticky',
                          top: 0,
                          zIndex: 10,
                          backgroundColor: darkMode ? '#1d1c1cff' : 'white',
                        }}
                      >
                        {captureListData.map((listItem, index) => {
                          const isEditing = editing.stepId === listItem.id && editing.type === 'list';
                          const isActive = activeListTab === index;

                          return (
                            <Tooltip
                              title="Double click to edit captured list name"
                              arrow
                              placement="top"
                            >
                              <Box
                                id={index === captureListData.length - 1 ? "list-name-tab" : undefined}
                                key={listItem.id}
                                onClick={() => {
                                  if (!isEditing) {
                                    setActiveListTab(index);
                                  }
                                }}
                                onDoubleClick={() => {
                                  startEdit(listItem.id, 'list', listItem.name || `List Data ${index + 1}`)
                                }}
                                sx={{
                                  px: 3,
                                  py: 1.25,
                                  cursor: isEditing ? 'text' : 'pointer',
                                  borderRadius: '8px 8px 0 0',
                                  backgroundColor: darkMode
                                      ? '#131313ff'
                                      : '#ffffff',
                                  color: isActive
                                    ? darkMode
                                      ? '#ffffff'
                                      : '#000000'
                                    : darkMode
                                      ? '#b0b0b0'
                                      : '#555555',
                                  fontWeight: isActive ? 600 : 400,
                                  fontSize: '0.875rem',
                                  border: '1px solid',
                                  borderColor: darkMode ? '#2a2a2a' : '#d0d0d0',
                                  borderBottom: isActive
                                    ? darkMode
                                      ? '2px solid #1c1c1c'
                                      : '2px solid #ffffff'
                                    : '2px solid transparent',
                                  transition: 'all 0.2s ease',
                                  position: 'relative',
                                  '&:hover': {
                                    backgroundColor: isActive
                                      ? undefined
                                      : darkMode
                                        ? '#161616'
                                        : '#e9ecef',
                                  },
                                  '&:hover .delete-icon': {
                                    opacity: 1
                                  },
                                }}
                              >
                                {isEditing ? (
                                  <TextField
                                    value={editing.value}
                                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                    onBlur={saveEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEdit();
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    autoFocus
                                    size="small"
                                    variant="standard"
                                    sx={{
                                      minWidth: '120px',
                                      '& .MuiInputBase-input': {
                                        color: darkMode ? '#fff' : '#000',
                                        fontSize: 'inherit',
                                        fontWeight: 'inherit',
                                        padding: 0,
                                      },
                                      '& .MuiInput-underline:before': { display: 'none' },
                                      '& .MuiInput-underline:after': { display: 'none' },
                                      '& .MuiInput-underline:hover:before': { display: 'none' },
                                    }}
                                  />
                                ) : (
                                  <>
                                    {listItem.name || `List Data ${index + 1}`}
                                    <IconButton
                                      className="delete-icon"
                                      size="small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveListAction(listItem.id, listItem.actionId);
                                      }}
                                      sx={{
                                        position: 'absolute',
                                        right: 4,
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        opacity: 0,
                                        transition: 'opacity 0.2s',
                                        color: darkMode ? '#999' : '#666',
                                        padding: '2px',
                                        '&:hover': {
                                          color: '#f44336',
                                          backgroundColor: darkMode ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'
                                        }
                                      }}
                                    >
                                      <CloseIcon sx={{ fontSize: '14px' }} />
                                    </IconButton>
                                  </>
                                )}
                              </Box>
                            </Tooltip>
                          );
                        })}
                      </Box>

                      {/* Table Below Tabs */}
                      <TableContainer
                        component={Paper}
                        sx={{
                          boxShadow: 'none',
                          borderRadius: 0,
                          flexGrow: 1,
                          overflow: 'auto',
                          '& .MuiTableHead-root': {
                            position: 'sticky',
                            top: 0,
                            zIndex: 5,
                          }
                        }}
                      >
                      <Table stickyHeader>
                        <TableHead>
                          <TableRow>
                            {Object.entries(captureListData[activeListTab]?.fields || {}).map(([fieldKey, field]: [string, any]) => {
                              const isEditing = editingField?.listId === captureListData[activeListTab]?.id && editingField?.fieldKey === fieldKey;

                              const isFirstField = Object.keys(captureListData[activeListTab]?.fields || {}).indexOf(fieldKey) === 0;

                              return (
                                <TableCell
                                  key={fieldKey}
                                  id={isFirstField ? "first-field-label" : undefined}
                                  sx={{
                                    borderBottom: '1px solid',
                                    borderColor: darkMode ? '#080808ff' : '#dee2e6',
                                    backgroundColor: `${darkMode ? '#080808ff' : '#f8f9fa'} !important`,
                                    padding: '12px 16px',
                                    position: 'sticky',
                                    top: 0,
                                    '&:hover .delete-icon': {
                                      opacity: 1
                                    },
                                  }}
                                >
                                  {isEditing ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: '200px' }}>
                                      <TextField
                                        value={editingValue}
                                        onChange={(e) => setEditingValue(e.target.value)}
                                        onBlur={handleSaveEdit}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleSaveEdit();
                                          if (e.key === 'Escape') handleCancelEdit();
                                        }}
                                        autoFocus
                                        size="small"
                                        sx={{
                                          flex: 1,
                                          minWidth: '150px',
                                          '& .MuiInputBase-root': {
                                            backgroundColor: darkMode ? '#2a2929' : '#fff'
                                          }
                                        }}
                                      />
                                      <IconButton
                                        size="small"
                                        onClick={handleSaveEdit}
                                        sx={{
                                          color: '#4caf50',
                                          padding: '4px'
                                        }}
                                      >
                                        <CheckIcon fontSize="small" />
                                      </IconButton>
                                    </Box>
                                  ) : (
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pr: 3 }}>
                                      <Tooltip title="Click to edit column name" arrow placement="top">
                                        <Typography
                                          sx={{
                                            flex: 1,
                                            cursor: 'pointer',
                                            fontWeight: 500,
                                            '&:hover': {
                                              color: darkMode ? '#fff' : '#000',
                                              textDecoration: 'underline'
                                            }
                                          }}
                                          onClick={() => handleStartEdit(captureListData[activeListTab]?.id, fieldKey, field.label)}
                                        >
                                          {field.label}
                                        </Typography>
                                      </Tooltip>
                                      <IconButton
                                        className="delete-icon"
                                        size="small"
                                        onClick={() => handleDeleteField(captureListData[activeListTab]?.id, fieldKey)}
                                        sx={{
                                          position: 'absolute',
                                          right: 4,
                                          top: '50%',
                                          transform: 'translateY(-50%)',
                                          opacity: 0,
                                          transition: 'opacity 0.2s',
                                          color: darkMode ? '#999' : '#666',
                                          padding: '4px',
                                          '&:hover': {
                                            color: '#f44336',
                                            backgroundColor: darkMode ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'
                                          }
                                        }}
                                      >
                                        <CloseIcon sx={{ fontSize: '16px' }} />
                                      </IconButton>
                                    </Box>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(captureListData[activeListTab]?.data || [])
                            .slice(0, Math.min(captureListData[activeListTab]?.limit || 10, 5))
                            .map((row: any, rowIndex: any) => (
                              <TableRow
                                key={rowIndex}
                                sx={{
                                  borderBottom: rowIndex < (Math.min((captureListData[activeListTab]?.data?.length || 0), Math.min(captureListData[activeListTab]?.limit || 10, 5))
                                  ) - 1 ? '1px solid' : 'none',
                                  borderColor: darkMode ? '#080808ff' : '#dee2e6'
                                }}
                              >
                                {Object.values(captureListData[activeListTab]?.fields || {}).map((field: any, colIndex) => (
                                  <TableCell 
                                    key={colIndex}
                                    sx={{ 
                                      borderBottom: 'none',
                                      py: 2
                                    }}
                                  >
                                    {typeof row[field.label] === 'object' ? JSON.stringify(row[field.label]) : String(row[field.label] || '')}
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
                  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Screenshot Tabs */}
                    <Box
                      sx={{
                        display: 'flex',
                        pt: 2,
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                        backgroundColor: darkMode ? '#1d1c1cff' : 'white',
                      }}
                    >
                      {(() => {
                        const screenshotSteps = browserSteps.filter(step => step.type === 'screenshot' && step.screenshotData) as Array<{ id: number; name?: string; type: 'screenshot'; fullPage: boolean; actionId?: string; screenshotData?: string }>;
                        return screenshotData.map((screenshot, index) => {
                          const screenshotStep = screenshotSteps[index];
                          if (!screenshotStep) return null;

                          const isActive = activeScreenshotTab === index;
                          const isEditing = editing.stepId === screenshotStep.id && editing.type === 'screenshot';
                          const screenshotName = screenshotStep.name || `Screenshot ${index + 1}`;

                          return (
                            <Tooltip
                              key={screenshotStep.id}
                              title="Double click to edit screenshot name"
                              arrow
                              placement="top"
                            >
                              <Box
                                onClick={() => {
                                  if (!isEditing) {
                                    setActiveScreenshotTab(index);
                                  }
                                }}
                                onDoubleClick={() => startEdit(screenshotStep.id, 'screenshot', screenshotName)}
                              sx={{
                                px: 3,
                                py: 1.25,
                                cursor: isEditing ? 'text' : 'pointer',
                                borderRadius: '8px 8px 0 0',
                                backgroundColor: darkMode ? '#131313ff' : '#ffffff',
                                color: isActive
                                  ? darkMode
                                    ? '#ffffff'
                                    : '#000000'
                                  : darkMode
                                    ? '#b0b0b0'
                                    : '#555555',
                                fontWeight: isActive ? 600 : 400,
                                fontSize: '0.875rem',
                                border: '1px solid',
                                borderColor: darkMode ? '#2a2a2a' : '#d0d0d0',
                                borderBottom: isActive
                                  ? darkMode
                                    ? '2px solid #1c1c1c'
                                    : '2px solid #ffffff'
                                  : '2px solid transparent',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                '&:hover': {
                                  backgroundColor: isActive
                                    ? undefined
                                    : darkMode
                                      ? '#161616'
                                      : '#e9ecef',
                                },
                                '&:hover .delete-icon': {
                                  opacity: 1
                                },
                              }}
                            >
                              {isEditing ? (
                                <TextField
                                  value={editing.value}
                                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                  onBlur={saveEdit}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEdit();
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                  autoFocus
                                  size="small"
                                  variant="standard"
                                  sx={{
                                    minWidth: '120px',
                                    '& .MuiInputBase-input': {
                                      color: darkMode ? '#fff' : '#000',
                                      fontSize: 'inherit',
                                      fontWeight: 'inherit',
                                      padding: 0,
                                    },
                                    '& .MuiInput-underline:before': { display: 'none' },
                                    '& .MuiInput-underline:after': { display: 'none' },
                                    '& .MuiInput-underline:hover:before': { display: 'none' },
                                  }}
                                />
                              ) : (
                                <>
                                  {screenshotName}
                                  <IconButton
                                    className="delete-icon"
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveScreenshotAction(screenshotStep.id, screenshotStep.actionId);
                                    }}
                                    sx={{
                                      position: 'absolute',
                                      right: 4,
                                      top: '50%',
                                      transform: 'translateY(-50%)',
                                      opacity: 0,
                                      transition: 'opacity 0.2s',
                                      color: darkMode ? '#999' : '#666',
                                      padding: '2px',
                                      '&:hover': {
                                        color: '#f44336',
                                        backgroundColor: darkMode ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'
                                      }
                                    }}
                                  >
                                    <CloseIcon sx={{ fontSize: '14px' }} />
                                  </IconButton>
                                </>
                              )}
                            </Box>
                          </Tooltip>
                        );
                      });
                      })()}
                    </Box>

                    {/* Screenshot Image */}
                    <Box sx={{
                      p: 3,
                      overflow: 'auto',
                      flexGrow: 1,
                      backgroundColor: darkMode ? '#131313ff' : '#ffffff',
                    }}>
                      <img
                        src={screenshotData[activeScreenshotTab]}
                        alt={`Screenshot ${activeScreenshotTab + 1}`}
                        style={{ maxWidth: '100%', borderRadius: '4px' }}
                      />
                    </Box>
                  </Box>
                )}

                {(activeTab === availableTabs.findIndex(tab => tab.id === 'captureText') || singleContentType === 'captureText') && captureTextData.length > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <Box
                      sx={{
                        display: 'flex',
                        pt: 2,
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                        backgroundColor: darkMode ? '#1d1c1cff' : 'white',
                      }}
                    >
                      <Tooltip
                        title="Double click to edit captured text name"
                        arrow
                        placement="top"
                      >
                        <Box
                          onDoubleClick={handleStartEditTextGroupName}
                          sx={{
                            px: 3,
                            py: 1.25,
                            cursor: editingTextGroupName ? 'text' : 'pointer',
                            borderRadius: '8px 8px 0 0',
                            backgroundColor: darkMode ? '#131313ff' : '#ffffff',
                            color: darkMode ? '#ffffff' : '#000000',
                            fontWeight: 600,
                            fontSize: '0.875rem',
                            border: '1px solid',
                            borderColor: darkMode ? '#2a2a2a' : '#d0d0d0',
                            borderBottom: darkMode ? '2px solid #1c1c1c' : '2px solid #ffffff',
                            transition: 'all 0.2s ease',
                            position: 'relative',
                            '&:hover .delete-icon': {
                              opacity: 1
                            },
                          }}
                        >
                          {editingTextGroupName ? (
                            <TextField
                              value={editingTextGroupNameValue}
                              onChange={(e) => setEditingTextGroupNameValue(e.target.value)}
                              onBlur={handleSaveTextGroupName}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveTextGroupName();
                                if (e.key === 'Escape') {
                                  setEditingTextGroupName(false);
                                  setEditingTextGroupNameValue(currentTextGroupName);
                                }
                              }}
                              autoFocus
                              size="small"
                              variant="standard"
                              sx={{
                                minWidth: '120px',
                                '& .MuiInputBase-input': {
                                  color: darkMode ? '#fff' : '#000',
                                  fontSize: 'inherit',
                                  fontWeight: 'inherit',
                                  padding: 0,
                                },
                                '& .MuiInput-underline:before': { display: 'none' },
                                '& .MuiInput-underline:after': { display: 'none' },
                                '& .MuiInput-underline:hover:before': { display: 'none' },
                              }}
                            />
                          ) : (
                            <>
                              {currentTextGroupName}
                              <IconButton
                                className="delete-icon"
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveAllTextActions();
                                }}
                                sx={{
                                  position: 'absolute',
                                  right: 4,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  opacity: 0,
                                  transition: 'opacity 0.2s',
                                  color: darkMode ? '#999' : '#666',
                                  padding: '2px',
                                  '&:hover': {
                                    color: '#f44336',
                                    backgroundColor: darkMode ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'
                                  }
                                }}
                              >
                                <CloseIcon sx={{ fontSize: '14px' }} />
                              </IconButton>
                            </>
                          )}
                        </Box>
                      </Tooltip>
                    </Box>

                    <TableContainer
                      component={Paper}
                      sx={{
                        boxShadow: 'none',
                        borderRadius: 0,
                        flexGrow: 1,
                        overflow: 'auto',
                        '& .MuiTableHead-root': {
                          position: 'sticky',
                          top: 0,
                          zIndex: 5,
                        }
                      }}
                    >
                      <Table stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell
                              sx={{
                                borderBottom: '1px solid',
                                borderColor: darkMode ? '#080808ff' : '#dee2e6',
                                backgroundColor: `${darkMode ? '#080808ff' : '#f8f9fa'} !important`,
                                position: 'sticky',
                                top: 0,
                              }}
                            >
                              Label
                            </TableCell>
                            <TableCell
                              sx={{
                                borderBottom: '1px solid',
                                borderColor: darkMode ? '#080808ff' : '#dee2e6',
                                backgroundColor: `${darkMode ? '#080808ff' : '#f8f9fa'} !important`,
                                position: 'sticky',
                                top: 0,
                              }}
                            >
                              Value
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {captureTextData.map((textStep: any, index) => {
                            const isEditing = editing.stepId === textStep.id && editing.type === 'text';

                            return (
                              <TableRow
                                key={textStep.id}
                                sx={{
                                  borderBottom: index < captureTextData.length - 1 ? '1px solid' : 'none',
                                  borderColor: darkMode ? '#080808ff' : '#dee2e6'
                                }}
                              >
                                <TableCell
                                  sx={{
                                    borderBottom: 'none',
                                    py: 2,
                                    fontWeight: 500,
                                    position: 'relative',
                                    '&:hover .delete-icon': {
                                      opacity: 1
                                    }
                                  }}
                                >
                                  {isEditing ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: '200px' }}>
                                      <TextField
                                        value={editing.value}
                                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                        onBlur={saveEdit}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEdit();
                                          if (e.key === 'Escape') cancelEdit();
                                        }}
                                        autoFocus
                                        size="small"
                                        sx={{
                                          flex: 1,
                                          minWidth: '150px',
                                          '& .MuiInputBase-root': {
                                            backgroundColor: darkMode ? '#2a2929' : '#fff'
                                          }
                                        }}
                                      />
                                      <IconButton
                                        size="small"
                                        onClick={saveEdit}
                                        sx={{
                                          color: '#4caf50',
                                          padding: '4px'
                                        }}
                                      >
                                        <CheckIcon fontSize="small" />
                                      </IconButton>
                                    </Box>
                                  ) : (
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pr: 3 }}>
                                      <Tooltip title="Click to edit label" arrow placement="top">
                                        <Typography
                                          sx={{
                                            flex: 1,
                                            cursor: 'pointer',
                                            fontWeight: 500,
                                            '&:hover': {
                                              color: darkMode ? '#fff' : '#000',
                                              textDecoration: 'underline'
                                            }
                                          }}
                                          onClick={() => startEdit(textStep.id, 'text', textStep.label)}
                                        >
                                          {textStep.label}
                                        </Typography>
                                      </Tooltip>
                                      <IconButton
                                        className="delete-icon"
                                        size="small"
                                        onClick={() => handleDeleteTextStep(textStep.id)}
                                        sx={{
                                          position: 'absolute',
                                          right: 4,
                                          top: '50%',
                                          transform: 'translateY(-50%)',
                                          opacity: 0,
                                          transition: 'opacity 0.2s',
                                          color: darkMode ? '#999' : '#666',
                                          padding: '4px',
                                          '&:hover': {
                                            color: '#f44336',
                                            backgroundColor: darkMode ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'
                                          }
                                        }}
                                      >
                                        <CloseIcon sx={{ fontSize: '16px' }} />
                                      </IconButton>
                                    </Box>
                                  )}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    borderBottom: 'none',
                                    py: 2
                                  }}
                                >
                                  {typeof textStep.data === 'object' ? JSON.stringify(textStep.data) : String(textStep.data || '')}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
              </Box>
            </>
          )}
          <div style={{ float: 'left', clear: 'both' }} ref={logEndRef} />
        </SwipeableDrawer>
      </Grid>
    </Grid>
  );
};