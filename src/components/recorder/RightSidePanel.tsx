import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Paper, Box, TextField, IconButton, Tooltip } from "@mui/material";
import { WorkflowFile } from "maxun-core";
import Typography from "@mui/material/Typography";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { PaginationType, useActionContext, LimitType } from '../../context/browserActions';
import { BrowserStep, useBrowserSteps } from '../../context/browserSteps';
import { useSocketStore } from '../../context/socket';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { getActiveWorkflow } from "../../api/workflow";
import ActionDescriptionBox from '../action/ActionDescriptionBox';
import { useThemeMode } from '../../context/theme-provider';
import { useTranslation } from 'react-i18next';
import { useBrowserDimensionsStore } from '../../context/browserDimensions';
import { emptyWorkflow } from '../../shared/constants';
import { clientListExtractor } from '../../helpers/clientListExtractor';
import { clientSelectorGenerator } from '../../helpers/clientSelectorGenerator';

const fetchWorkflow = (id: string, callback: (response: WorkflowFile) => void) => {
  getActiveWorkflow(id).then(
    (response) => {
      if (response) {
        callback(response);
      } else {
        throw new Error("No workflow found");
      }
    }
  ).catch((error) => { console.log(`Failed to fetch workflow:`,error.message) })
};

interface RightSidePanelProps {
  onFinishCapture: () => void;
}

export const RightSidePanel: React.FC<RightSidePanelProps> = ({ onFinishCapture }) => {
  const [textLabels, setTextLabels] = useState<{ [id: string]: string }>({});
  const [errors, setErrors] = useState<{ [id: string]: string }>({});
  const [confirmedTextSteps, setConfirmedTextSteps] = useState<{ [id: string]: boolean }>({});
  const [confirmedListTextFields, setConfirmedListTextFields] = useState<{ [listId: string]: { [fieldKey: string]: boolean } }>({});
  const [showCaptureList, setShowCaptureList] = useState(true);
  const [showCaptureScreenshot, setShowCaptureScreenshot] = useState(true);
  const [showCaptureText, setShowCaptureText] = useState(true);
  const { panelHeight } = useBrowserDimensionsStore();

  const { lastAction, notify, currentWorkflowActionsState, setCurrentWorkflowActionsState, resetInterpretationLog, currentListActionId, setCurrentListActionId, currentTextActionId, setCurrentTextActionId, currentScreenshotActionId, setCurrentScreenshotActionId, isDOMMode, setIsDOMMode, currentSnapshot, setCurrentSnapshot, updateDOMMode, initialUrl, setRecordingUrl, currentTextGroupName } = useGlobalInfoStore();  
  const { 
    getText, startGetText, stopGetText, 
    getList, startGetList, stopGetList, 
    getScreenshot, startGetScreenshot, stopGetScreenshot, 
    startPaginationMode, stopPaginationMode, 
    paginationType, updatePaginationType, 
    limitType, customLimit, updateLimitType, updateCustomLimit, 
    stopLimitMode, startLimitMode, 
    captureStage, setCaptureStage, 
    showPaginationOptions, setShowPaginationOptions, 
    showLimitOptions, setShowLimitOptions, 
    workflow, setWorkflow, 
    activeAction, setActiveAction, 
    startAction, finishAction 
  } = useActionContext();
  
  const { browserSteps, updateBrowserTextStepLabel, deleteBrowserStep, addScreenshotStep, updateListTextFieldLabel, removeListTextField, updateListStepLimit, deleteStepsByActionId, updateListStepData, updateScreenshotStepData, emitActionForStep } = useBrowserSteps();
  const { id, socket } = useSocketStore();
  const { t } = useTranslation();

  const isAnyActionActive = activeAction !== 'none';

  const workflowHandler = useCallback((data: WorkflowFile) => {
    setWorkflow(data);
  }, [setWorkflow]);

  useEffect(() => {
    if (socket) {
      const domModeHandler = (data: any) => {
        if (!data.userId || data.userId === id) {
          updateDOMMode(true);
        }
      };

      const domcastHandler = (data: any) => {
        if (!data.userId || data.userId === id) {
          if (data.snapshotData && data.snapshotData.snapshot) {
            updateDOMMode(true, data.snapshotData);
          }
        }
      };

      socket.on("dom-mode-enabled", domModeHandler);
      socket.on("domcast", domcastHandler);

      return () => {
        socket.off("dom-mode-enabled", domModeHandler);
        socket.off("domcast", domcastHandler);
      };
    }
  }, [socket, id, updateDOMMode]);

  useEffect(() => {
    if (socket) {
      socket.on("workflow", workflowHandler);
    }
    // fetch the workflow every time the id changes
    if (id) {
      fetchWorkflow(id, workflowHandler);
    }
    // fetch workflow in 15min intervals
    let interval = setInterval(() => {
      if (id) {
        fetchWorkflow(id, workflowHandler);
      }
    }, (1000 * 60 * 15));
    return () => {
      socket?.off("workflow", workflowHandler);
      clearInterval(interval);
    };
  }, [id, socket, workflowHandler]);

  useEffect(() => {
    const hasPairs = workflow.workflow.length > 0;
    if (!hasPairs) {
      setShowCaptureList(true);
      setShowCaptureScreenshot(true);
      setShowCaptureText(true);
      return;
    }

    const hasScrapeListAction = workflow.workflow.some(pair =>
      pair.what.some(action => action.action === 'scrapeList')
    );
    const hasScreenshotAction = workflow.workflow.some(pair =>
      pair.what.some(action => action.action === 'screenshot')
    );
    const hasScrapeSchemaAction = workflow.workflow.some(pair =>
      pair.what.some(action => action.action === 'scrapeSchema')
    );

    setCurrentWorkflowActionsState({
      hasScrapeListAction,
      hasScreenshotAction,
      hasScrapeSchemaAction,
    });

    setShowCaptureList(true);
    setShowCaptureScreenshot(true);
    setShowCaptureText(true);
  }, [workflow, setCurrentWorkflowActionsState]);

  useEffect(() => {
    if (socket) {
      socket.on('listDataExtracted', (response) => {
        if (!isDOMMode) {
          const { currentListId, data } = response;
          updateListStepData(currentListId, data);
        }
      });
    }
    
    return () => {
      socket?.off('listDataExtracted');
    };
  }, [socket, updateListStepData, isDOMMode]);

  useEffect(() => {
    if (socket) {
      const handleDirectScreenshot = (data: any) => {
        const screenshotSteps = browserSteps.filter(step => 
          step.type === 'screenshot' && step.actionId === currentScreenshotActionId
        );
        
        if (screenshotSteps.length > 0) {
          const latestStep = screenshotSteps[screenshotSteps.length - 1];          
          updateScreenshotStepData(latestStep.id, data.screenshot);
          emitActionForStep(latestStep);
        }
        
        setCurrentScreenshotActionId('');
      };

      socket.on('directScreenshotCaptured', handleDirectScreenshot);

      return () => {
        socket.off('directScreenshotCaptured', handleDirectScreenshot);
      };
    }
  }, [socket, id, notify, t, currentScreenshotActionId, updateScreenshotStepData, setCurrentScreenshotActionId, emitActionForStep, browserSteps]);

  const extractDataClientSide = useCallback(
    (
      listSelector: string,
      fields: Record<string, any>,
      currentListId: number
    ) => {
      if (isDOMMode && currentSnapshot) {
        try {
          let iframeElement = document.querySelector(
            "#dom-browser-iframe"
          ) as HTMLIFrameElement;

          if (!iframeElement) {
            iframeElement = document.querySelector(
              "#browser-window iframe"
            ) as HTMLIFrameElement;
          }

          if (!iframeElement) {
            const browserWindow = document.querySelector("#browser-window");
            if (browserWindow) {
              iframeElement = browserWindow.querySelector(
                "iframe"
              ) as HTMLIFrameElement;
            }
          }

          if (!iframeElement) {
            console.error(
              "Could not find the DOM iframe element for extraction"
            );
            return;
          }

          const iframeDoc = iframeElement.contentDocument;
          if (!iframeDoc) {
            console.error("Failed to get iframe document");
            return;
          }

          const extractedData = clientListExtractor.extractListData(
            iframeDoc,
            listSelector,
            fields,
            5 
          );

          updateListStepData(currentListId, extractedData);
          
          if (extractedData.length === 0) {
            console.warn("⚠️ No data extracted - this might indicate selector issues");
            notify("warning", "No data was extracted. Please verify your selections.");
          }
        } catch (error) {
          console.error("Error in client-side data extraction:", error);
          notify("error", "Failed to extract data client-side");
        }
      } else {
        if (!socket) {
          console.error("Socket not available for backend extraction");
          return;
        }

        try {
          socket.emit("extractListData", {
            listSelector,
            fields,
            currentListId,
            pagination: { type: "", selector: "" },
          });
        } catch (error) {
          console.error("Error in backend data extraction:", error);
        }
      }
    },
    [isDOMMode, currentSnapshot, updateListStepData, socket, notify, currentWorkflowActionsState]
  );

  useEffect(() => {
    if (!getList) return;

    const currentListStep = browserSteps.find(
      step => step.type === 'list' && step.actionId === currentListActionId
    ) as (BrowserStep & { type: 'list'; listSelector?: string; fields?: Record<string, any> }) | undefined;

    if (!currentListStep || !currentListStep.listSelector || !currentListStep.fields) return;

    const fieldCount = Object.keys(currentListStep.fields).length;

    if (fieldCount > 0) {
      extractDataClientSide(
        currentListStep.listSelector,
        currentListStep.fields,
        currentListStep.id
      );

      setCurrentWorkflowActionsState({
        ...currentWorkflowActionsState,
        hasScrapeListAction: true
      });
    }
  }, [browserSteps, currentListActionId, getList, extractDataClientSide, setCurrentWorkflowActionsState, currentWorkflowActionsState]);

  const handleStartGetText = () => {
    const newActionId = `text-${crypto.randomUUID()}`;
    setCurrentTextActionId(newActionId);
    startGetText();
  }

  const handleStartGetList = () => {
    const newActionId = `list-${crypto.randomUUID()}`;
    setCurrentListActionId(newActionId);
    startGetList();
  }

  const handleStartGetScreenshot = () => {
    const newActionId = `screenshot-${crypto.randomUUID()}`;
    setCurrentScreenshotActionId(newActionId);
    startGetScreenshot();
  };

  const stopCaptureAndEmitGetTextSettings = useCallback(() => {
    const currentTextActionStep = browserSteps.find(step => step.type === 'text' && step.actionId === currentTextActionId);
    if (!currentTextActionStep) {
      notify('error', t('right_panel.errors.no_text_captured'));
      return;
    }
    
    stopGetText();
    if (currentTextActionStep) {
      emitActionForStep(currentTextActionStep);
    }
    setCurrentTextActionId('');
    resetInterpretationLog();
    finishAction('text'); 
    onFinishCapture();
    clientSelectorGenerator.cleanup();
  }, [stopGetText, socket, browserSteps, resetInterpretationLog, finishAction, notify, onFinishCapture, t, currentTextActionId, currentTextGroupName, emitActionForStep]);


  const resetListState = useCallback(() => {
    setShowPaginationOptions(false);
    updatePaginationType('');
    setShowLimitOptions(false);
    updateLimitType('');
    updateCustomLimit('');
  }, [updatePaginationType, updateLimitType, updateCustomLimit]);

  const handleStopGetList = useCallback(() => {
    stopGetList();
    resetListState();
  }, [stopGetList, resetListState]);

  const stopCaptureAndEmitGetListSettings = useCallback(() => {
    const latestListStep = getLatestListStep(browserSteps);
    if (latestListStep) {
      extractDataClientSide(latestListStep.listSelector!, latestListStep.fields, latestListStep.id);

      setCurrentWorkflowActionsState({
        ...currentWorkflowActionsState,
        hasScrapeListAction: true
      });
      
      emitActionForStep(latestListStep);

      handleStopGetList();
      setCurrentListActionId('');
      resetInterpretationLog();
      finishAction('list');
      onFinishCapture();
      clientSelectorGenerator.cleanup();
    } else {
      notify('error', t('right_panel.errors.unable_create_settings'));
      handleStopGetList();
      setCurrentListActionId('');
      resetInterpretationLog();
      finishAction('list');
      onFinishCapture();
      clientSelectorGenerator.cleanup();
    }
  }, [socket, notify, handleStopGetList, resetInterpretationLog, finishAction, onFinishCapture, t, browserSteps, extractDataClientSide, setCurrentWorkflowActionsState, currentWorkflowActionsState, emitActionForStep]);

  const getLatestListStep = (steps: BrowserStep[]) => {
    const listSteps = steps.filter(step => step.type === 'list');
    if (listSteps.length === 0) return null;
    
    return listSteps.sort((a, b) => b.id - a.id)[0];
  };

  const handleConfirmListCapture = useCallback(() => {
    switch (captureStage) {
      case 'initial':
        const hasValidListSelectorForCurrentAction = browserSteps.some(step =>
          step.type === 'list' &&
          step.actionId === currentListActionId &&
          step.listSelector &&
          Object.keys(step.fields).length > 0
        );
        
        if (!hasValidListSelectorForCurrentAction) {
          notify('error', t('right_panel.errors.capture_list_first'));
          return;
        }
        
        startPaginationMode();
        setShowPaginationOptions(true);
        setCaptureStage('pagination');
        break;

      case 'pagination':
        if (!paginationType) {
          notify('error', t('right_panel.errors.select_pagination'));
          return;
        }
        
        const currentListStepForPagination = browserSteps.find(
          step => step.type === 'list' && step.actionId === currentListActionId
        ) as (BrowserStep & { type: 'list' }) | undefined;

        if (currentListStepForPagination) {
          const paginationSelector = currentListStepForPagination.pagination?.selector;
          if (['clickNext', 'clickLoadMore'].includes(paginationType) && !paginationSelector) {
            notify('error', t('right_panel.errors.select_pagination_element'));
            return;
          }
        }
        stopPaginationMode();
        setShowPaginationOptions(false);
        startLimitMode();
        setShowLimitOptions(true);
        setCaptureStage('limit');
        break;

      case 'limit':
        if (!limitType || (limitType === 'custom' && !customLimit)) {
          notify('error', t('right_panel.errors.select_limit'));
          return;
        }
        const limit = limitType === 'custom' ? parseInt(customLimit) : parseInt(limitType);
        if (isNaN(limit) || limit <= 0) {
          notify('error', t('right_panel.errors.invalid_limit'));
          return;
        }

        const latestListStep = getLatestListStep(browserSteps);
        if (latestListStep) {
          updateListStepLimit(latestListStep.id, limit);
        }

        stopLimitMode();
        setShowLimitOptions(false);
        stopCaptureAndEmitGetListSettings();
        setCaptureStage('complete');
        break;

      case 'complete':
        setCaptureStage('initial');
        break;
    }
  }, [captureStage, paginationType, limitType, customLimit, startPaginationMode, setShowPaginationOptions, setCaptureStage, notify, stopPaginationMode, startLimitMode, setShowLimitOptions, stopLimitMode, stopCaptureAndEmitGetListSettings, t, browserSteps, currentListActionId, updateListStepLimit]);

  const handleBackCaptureList = useCallback(() => {
    switch (captureStage) {
      case 'limit':
        stopLimitMode();
        setShowLimitOptions(false);
        startPaginationMode();
        setShowPaginationOptions(true);
        setCaptureStage('pagination');
        break;
      case 'pagination':
        stopPaginationMode();
        setShowPaginationOptions(false);
        setCaptureStage('initial');
        break;
    }
  }, [captureStage, stopLimitMode, startPaginationMode, stopPaginationMode]);

  const handlePaginationSettingSelect = (option: PaginationType) => {
    updatePaginationType(option);
  };

  const discardGetText = useCallback(() => {
    stopGetText();
    
    if (currentTextActionId) {     
      deleteStepsByActionId(currentTextActionId);
      
      if (socket) {
        socket.emit('removeAction', { actionId: currentTextActionId });
      }
    }
    
    setCurrentTextActionId('');
    clientSelectorGenerator.cleanup();
    notify('error', t('right_panel.errors.capture_text_discarded'));
  }, [currentTextActionId, browserSteps, stopGetText, deleteStepsByActionId, notify, t, socket]);

  const discardGetList = useCallback(() => {
    stopGetList();
    
    if (currentListActionId) {
      deleteStepsByActionId(currentListActionId);
      
      if (socket) {
        socket.emit('removeAction', { actionId: currentListActionId });
      }
    }
    
    resetListState();
    stopPaginationMode();
    stopLimitMode();
    setShowPaginationOptions(false);
    setShowLimitOptions(false);
    setCaptureStage('initial');
    setCurrentListActionId('');
    clientSelectorGenerator.cleanup();
    notify('error', t('right_panel.errors.capture_list_discarded'));
  }, [currentListActionId, browserSteps, stopGetList, deleteStepsByActionId, resetListState, setShowPaginationOptions, setShowLimitOptions, setCaptureStage, notify, t, stopPaginationMode, stopLimitMode, socket]);

  const captureScreenshot = (fullPage: boolean) => {
    const screenshotCount = browserSteps.filter(s => s.type === 'screenshot').length + 1;
    const screenshotName = `Screenshot ${screenshotCount}`;
    
    const screenshotSettings = {
      fullPage,
      type: 'png' as const,
      timeout: 30000,
      animations: 'allow' as const,
      caret: 'hide' as const,
      scale: 'device' as const,
      name: screenshotName,
      actionId: currentScreenshotActionId
    };
    socket?.emit('captureDirectScreenshot', screenshotSettings);   
    addScreenshotStep(fullPage, currentScreenshotActionId);
    stopGetScreenshot();
    resetInterpretationLog();
    finishAction('screenshot');
    onFinishCapture();
    clientSelectorGenerator.cleanup();
  };

  const theme = useThemeMode();
  const isDarkMode = theme.darkMode;

  return (
    <Paper sx={{ height: panelHeight, width: 'auto', alignItems: "center", background: 'inherit', position: "relative", border: "none" }} id="browser-actions" elevation={0}>
      <ActionDescriptionBox isDarkMode={isDarkMode} />
      <Box display="flex" flexDirection="column" gap={2} style={{ margin: '13px' }}>
        {!isAnyActionActive && (
          <>
            {showCaptureList && (
              <Button 
                variant="contained" 
                onClick={handleStartGetList}
              >
                {t('right_panel.buttons.capture_list')}
              </Button>
            )}

            {showCaptureText && (
              <Button 
                variant="contained" 
                onClick={handleStartGetText}
              >
                {t('right_panel.buttons.capture_text')}
              </Button>
            )}

            {showCaptureScreenshot && (
              <Button 
                variant="contained" 
                onClick={handleStartGetScreenshot}
              >
                {t('right_panel.buttons.capture_screenshot')}
              </Button>
            )}
          </>
        )}

        {getList && (
          <Box>
            <Box display="flex" justifyContent="space-between" gap={2} style={{ margin: '15px' }}>
              {(captureStage === 'pagination' || captureStage === 'limit') && (
                <Button
                  variant="outlined"
                  onClick={handleBackCaptureList}
                  sx={{
                    color: '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: 'whitesmoke !important',
                  }}
                >
                  {t('right_panel.buttons.back')}
                </Button>
              )}
              <Button
                variant="outlined"
                onClick={handleConfirmListCapture}
                sx={{
                  color: '#ff00c3 !important',
                  borderColor: '#ff00c3 !important',
                  backgroundColor: 'whitesmoke !important',
                }}
              >
                {captureStage === 'initial' ? t('right_panel.buttons.confirm_capture') :
                  captureStage === 'pagination' ? t('right_panel.buttons.confirm_pagination') :
                    captureStage === 'limit' ? t('right_panel.buttons.confirm_limit') :
                      t('right_panel.buttons.finish_capture')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={discardGetList}
                sx={{
                  color: 'red !important',
                  borderColor: 'red !important',
                  backgroundColor: 'whitesmoke !important',
                }}
              >
                {t('right_panel.buttons.discard')}
              </Button>
            </Box>
          
            {showPaginationOptions && (
              <Box display="flex" flexDirection="column" gap={2} style={{ margin: '13px' }}>
                <Typography>{t('right_panel.pagination.title')}</Typography>
                <Button
                  variant={paginationType === 'clickNext' ? "contained" : "outlined"}
                  onClick={() => handlePaginationSettingSelect('clickNext')}
                  sx={{
                    color: paginationType === 'clickNext' ? 'whitesmoke !important' : '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: paginationType === 'clickNext' ? '#ff00c3 !important' : 'whitesmoke !important',
                  }}>
                  {t('right_panel.pagination.click_next')}
                </Button>
                <Button
                  variant={paginationType === 'clickLoadMore' ? "contained" : "outlined"}
                  onClick={() => handlePaginationSettingSelect('clickLoadMore')}
                  sx={{
                    color: paginationType === 'clickLoadMore' ? 'whitesmoke !important' : '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: paginationType === 'clickLoadMore' ? '#ff00c3 !important' : 'whitesmoke !important',
                  }}>
                  {t('right_panel.pagination.click_load_more')}
                </Button>
                <Button
                  variant={paginationType === 'scrollDown' ? "contained" : "outlined"}
                  onClick={() => handlePaginationSettingSelect('scrollDown')}
                  sx={{
                    color: paginationType === 'scrollDown' ? 'whitesmoke !important' : '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: paginationType === 'scrollDown' ? '#ff00c3 !important' : 'whitesmoke !important',
                  }}>
                  {t('right_panel.pagination.scroll_down')}
                </Button>
                <Button
                  variant={paginationType === 'scrollUp' ? "contained" : "outlined"}
                  onClick={() => handlePaginationSettingSelect('scrollUp')}
                  sx={{
                    color: paginationType === 'scrollUp' ? 'whitesmoke !important' : '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: paginationType === 'scrollUp' ? '#ff00c3 !important' : 'whitesmoke !important',
                  }}>
                  {t('right_panel.pagination.scroll_up')}
                </Button>
                <Button
                  variant={paginationType === 'none' ? "contained" : "outlined"}
                  onClick={() => handlePaginationSettingSelect('none')}
                  sx={{
                    color: paginationType === 'none' ? 'whitesmoke !important' : '#ff00c3 !important',
                    borderColor: '#ff00c3 !important',
                    backgroundColor: paginationType === 'none' ? '#ff00c3 !important' : 'whitesmoke !important',
                  }}>
                  {t('right_panel.pagination.none')}</Button>
              </Box>
            )}
          
            {showLimitOptions && (
              <FormControl>
                <Typography variant="h6" sx={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold',
                  mb: 1,
                  whiteSpace: 'normal', 
                  wordBreak: 'break-word' 
                }}>
                  {t('right_panel.limit.title')}
                </Typography>
                <RadioGroup
                  value={limitType}
                  onChange={(e) => updateLimitType(e.target.value as LimitType)}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                  }}
                >
                  <FormControlLabel value="10" control={<Radio />} label="10" />
                  <FormControlLabel value="100" control={<Radio />} label="100" />
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <FormControlLabel value="custom" control={<Radio />} label={t('right_panel.limit.custom')} />
                    {limitType === 'custom' && (
                      <TextField
                        type="number"
                        value={customLimit}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const value = parseInt(e.target.value);
                          if (e.target.value === '' || value >= 1) {
                            updateCustomLimit(e.target.value);
                          }
                        }}
                        inputProps={{
                          min: 1,
                          onKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => {
                            const value = (e.target as HTMLInputElement).value + e.key;
                            if (parseInt(value) < 1) {
                              e.preventDefault();
                            }
                          }
                        }}
                        placeholder={t('right_panel.limit.enter_number')}
                        sx={{
                          marginLeft: '10px',
                          '& input': {
                            padding: '10px',
                          },
                          width: '150px',
                          background: isDarkMode ? "#1E2124" : 'white',
                          color: isDarkMode ? "white" : 'black',
                        }}
                      />
                    )}
                  </div>
                </RadioGroup>
              </FormControl>
            )}
          </Box>
        )}
        
        {getText && (
          <Box>
            <Box display="flex" justifyContent="space-between" gap={2} style={{ margin: '15px' }}>
              <Button
                variant="outlined"
                onClick={stopCaptureAndEmitGetTextSettings}
                sx={{
                  color: '#ff00c3 !important',
                  borderColor: '#ff00c3 !important',
                  backgroundColor: 'whitesmoke !important',
                }}
              >
                {t('right_panel.buttons.confirm')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={discardGetText}
                sx={{
                  color: '#ff00c3 !important',
                  borderColor: '#ff00c3 !important',
                  backgroundColor: 'whitesmoke !important',
                }}
              >
                {t('right_panel.buttons.discard')}
              </Button>
            </Box>
          </Box>
        )}
        
        {getScreenshot && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Button variant="contained" onClick={() => captureScreenshot(true)}>
              {t('right_panel.screenshot.capture_fullpage')}
            </Button>
            <Button variant="contained" onClick={() => captureScreenshot(false)}>
              {t('right_panel.screenshot.capture_visible')}
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => {
                stopGetScreenshot();
                setActiveAction('none');
              }}
              sx={{
                color: '#ff00c3 !important',
                borderColor: '#ff00c3 !important',
                backgroundColor: 'whitesmoke !important',
              }}
            >
              {t('right_panel.buttons.discard')}
            </Button>
          </Box>
        )}
      </Box>
    </Paper>
  );
};
