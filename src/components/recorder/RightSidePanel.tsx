import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Paper, Box, TextField, IconButton } from "@mui/material";
import EditIcon from '@mui/icons-material/Edit';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import { WorkflowFile } from "maxun-core";
import Typography from "@mui/material/Typography";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { PaginationType, useActionContext, LimitType } from '../../context/browserActions';
import { BrowserStep, useBrowserSteps } from '../../context/browserSteps';
import { useSocketStore } from '../../context/socket';
import { ScreenshotSettings } from '../../shared/types';
import InputAdornment from '@mui/material/InputAdornment';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { getActiveWorkflow } from "../../api/workflow";
import ActionDescriptionBox from '../action/ActionDescriptionBox';
import { useThemeMode } from '../../context/theme-provider';
import { useTranslation } from 'react-i18next';
import { useBrowserDimensionsStore } from '../../context/browserDimensions';
import { clientListExtractor } from '../../helpers/clientListExtractor';

const fetchWorkflow = (id: string, callback: (response: WorkflowFile) => void) => {
  getActiveWorkflow(id).then(
    (response) => {
      if (response) {
        callback(response);
      } else {
        throw new Error("No workflow found");
      }
    }
  ).catch((error) => { console.log(error.message) })
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
  const [hoverStates, setHoverStates] = useState<{ [id: string]: boolean }>({});
  const [browserStepIdList, setBrowserStepIdList] = useState<number[]>([]);
  const [isCaptureTextConfirmed, setIsCaptureTextConfirmed] = useState(false);
  const [isCaptureListConfirmed, setIsCaptureListConfirmed] = useState(false);
  const { panelHeight } = useBrowserDimensionsStore();
  const [isDOMMode, setIsDOMMode] = useState(false);
  const [currentSnapshot, setCurrentSnapshot] = useState<any>(null);

  const { lastAction, notify, currentWorkflowActionsState, setCurrentWorkflowActionsState, resetInterpretationLog, currentListActionId, setCurrentListActionId, currentTextActionId, setCurrentTextActionId, currentScreenshotActionId, setCurrentScreenshotActionId } = useGlobalInfoStore();  
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
  
  const { browserSteps, updateBrowserTextStepLabel, deleteBrowserStep, addScreenshotStep, updateListTextFieldLabel, removeListTextField, updateListStepLimit, deleteStepsByActionId, updateListStepData, updateScreenshotStepData } = useBrowserSteps();
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
          setIsDOMMode(true);
        }
      };

      const screenshotModeHandler = (data: any) => {
        if (!data.userId || data.userId === id) {
          setIsDOMMode(false);
          setCurrentSnapshot(null);
        }
      };

      const domcastHandler = (data: any) => {
        if (!data.userId || data.userId === id) {
          if (data.snapshotData && data.snapshotData.snapshot) {
            setCurrentSnapshot(data.snapshotData);
            setIsDOMMode(true);
          }
        }
      };

      socket.on("dom-mode-enabled", domModeHandler);
      socket.on("screenshot-mode-enabled", screenshotModeHandler);
      socket.on("domcast", domcastHandler);

      return () => {
        socket.off("dom-mode-enabled", domModeHandler);
        socket.off("screenshot-mode-enabled", screenshotModeHandler);
        socket.off("domcast", domcastHandler);
      };
    }
  }, [socket, id]);

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
        }
        
        setCurrentScreenshotActionId('');
      };

      socket.on('directScreenshotCaptured', handleDirectScreenshot);

      return () => {
        socket.off('directScreenshotCaptured', handleDirectScreenshot);
      };
    }
  }, [socket, id, notify, t, currentScreenshotActionId, updateScreenshotStepData, setCurrentScreenshotActionId]);

  const extractDataClientSide = useCallback(
    (
      listSelector: string,
      fields: Record<string, any>,
      currentListId: number
    ) => {
      if (isDOMMode && currentSnapshot) {
        try {
          // Find the DOM iframe element
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

          // Use client-side extraction
          const extractedData = clientListExtractor.extractListData(
            iframeDoc,
            listSelector,
            fields,
            5 // limit for preview
          );

          updateListStepData(currentListId, extractedData);
          console.log("✅ Client-side extraction completed:", extractedData);
        } catch (error) {
          console.error("Error in client-side data extraction:", error);
          notify("error", "Failed to extract data client-side");
        }
      } else {
        // Fallback to socket-based extraction for screenshot mode
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

          console.log("📤 Sent extraction request to backend");
        } catch (error) {
          console.error("Error in backend data extraction:", error);
        }
      }
    },
    [isDOMMode, currentSnapshot, updateListStepData, socket, notify]
  );

  const handleMouseEnter = (id: number) => {
    setHoverStates(prev => ({ ...prev, [id]: true }));
  };

  const handleMouseLeave = (id: number) => {
    setHoverStates(prev => ({ ...prev, [id]: false }));
  };

  const handleStartGetText = () => {
    setIsCaptureTextConfirmed(false);
    const newActionId = `text-${crypto.randomUUID()}`;
    setCurrentTextActionId(newActionId);
    startGetText();
  }

  const handleStartGetList = () => {
    setIsCaptureListConfirmed(false);
    const newActionId = `list-${crypto.randomUUID()}`;
    setCurrentListActionId(newActionId);
    startGetList();
  }

  const handleStartGetScreenshot = () => {
    const newActionId = `screenshot-${crypto.randomUUID()}`;
    setCurrentScreenshotActionId(newActionId);
    startGetScreenshot();
  };

  const handleTextLabelChange = (id: number, label: string, listId?: number, fieldKey?: string) => {
    if (listId !== undefined && fieldKey !== undefined) {
      // Prevent editing if the field is confirmed
      if (confirmedListTextFields[listId]?.[fieldKey]) {
        return;
      }
      updateListTextFieldLabel(listId, fieldKey, label);
    } else {
      setTextLabels(prevLabels => ({ ...prevLabels, [id]: label }));
    }
    if (!label.trim()) {
      setErrors(prevErrors => ({ ...prevErrors, [id]: t('right_panel.errors.label_required') }));
    } else {
      setErrors(prevErrors => ({ ...prevErrors, [id]: '' }));
    }
  };

  const handleTextStepConfirm = (id: number) => {
    const label = textLabels[id]?.trim();
    if (label) {
      updateBrowserTextStepLabel(id, label);
      setConfirmedTextSteps(prev => ({ ...prev, [id]: true }));
    } else {
      setErrors(prevErrors => ({ ...prevErrors, [id]: t('right_panel.errors.label_required') }));
    }
  };

  const handleTextStepDiscard = (id: number) => {
    deleteBrowserStep(id);
    setTextLabels(prevLabels => {
      const { [id]: _, ...rest } = prevLabels;
      return rest;
    });
    setErrors(prevErrors => {
      const { [id]: _, ...rest } = prevErrors;
      return rest;
    });
  };

  const handleTextStepDelete = (id: number) => {
    deleteBrowserStep(id);
    setTextLabels(prevLabels => {
      const { [id]: _, ...rest } = prevLabels;
      return rest;
    });
    setConfirmedTextSteps(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setErrors(prevErrors => {
      const { [id]: _, ...rest } = prevErrors;
      return rest;
    });
  };

  const handleListTextFieldConfirm = (listId: number, fieldKey: string) => {
    setConfirmedListTextFields(prev => ({
      ...prev,
      [listId]: {
        ...(prev[listId] || {}),
        [fieldKey]: true
      }
    }));
  };

  const handleListTextFieldDiscard = (listId: number, fieldKey: string) => {
    removeListTextField(listId, fieldKey);
    setConfirmedListTextFields(prev => {
      const updatedListFields = { ...(prev[listId] || {}) };
      delete updatedListFields[fieldKey];
      return {
        ...prev,
        [listId]: updatedListFields
      };
    });
    setErrors(prev => {
      const { [fieldKey]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleListTextFieldDelete = (listId: number, fieldKey: string) => {
    removeListTextField(listId, fieldKey);
    setConfirmedListTextFields(prev => {
      const updatedListFields = { ...(prev[listId] || {}) };
      delete updatedListFields[fieldKey];
      return {
        ...prev,
        [listId]: updatedListFields
      };
    });
    setErrors(prev => {
      const { [fieldKey]: _, ...rest } = prev;
      return rest;
    });
  };

  const getTextSettingsObject = useCallback(() => {
    const settings: Record<string, { selector: string; tag?: string;[key: string]: any }> = {};
    browserSteps.forEach(step => {
      if (browserStepIdList.includes(step.id)) {
        return;
      }

      if (step.type === 'text' && step.label && step.selectorObj?.selector) {
        settings[step.label] = step.selectorObj;
      }
      setBrowserStepIdList(prevList => [...prevList, step.id]);
    });

    return settings;
  }, [browserSteps, browserStepIdList]);

  const stopCaptureAndEmitGetTextSettings = useCallback(() => {
    const hasUnconfirmedTextSteps = browserSteps.some(step => step.type === 'text' && !confirmedTextSteps[step.id]);
    if (hasUnconfirmedTextSteps) {
      notify('error', t('right_panel.errors.confirm_text_fields'));
      return;
    }
    stopGetText();
    const settings = getTextSettingsObject();
    const hasTextSteps = browserSteps.some(step => step.type === 'text');
    if (hasTextSteps) {
      socket?.emit('action', { action: 'scrapeSchema', settings });
    }
    setIsCaptureTextConfirmed(true);
    setCurrentTextActionId('');
    resetInterpretationLog();
    finishAction('text'); 
    onFinishCapture();
  }, [stopGetText, getTextSettingsObject, socket, browserSteps, confirmedTextSteps, resetInterpretationLog, finishAction, notify, onFinishCapture, t]);

  const getListSettingsObject = useCallback(() => {
    let settings: {
      listSelector?: string;
      fields?: Record<string, { selector: string; tag?: string;[key: string]: any }>;
      pagination?: { type: string; selector?: string };
      limit?: number;
    } = {};

    browserSteps.forEach(step => {
      if (step.type === 'list' && step.listSelector && Object.keys(step.fields).length > 0) {
        const fields: Record<string, { selector: string; tag?: string;[key: string]: any }> = {};

        Object.entries(step.fields).forEach(([id, field]) => {
          if (field.selectorObj?.selector) {
            fields[field.label] = {
              selector: field.selectorObj.selector,
              tag: field.selectorObj.tag,
              attribute: field.selectorObj.attribute,
            };
          }
        });

        settings = {
          listSelector: step.listSelector,
          fields: fields,
          pagination: { type: paginationType, selector: step.pagination?.selector },
          limit: parseInt(limitType === 'custom' ? customLimit : limitType),
        };
      }
    });

    return settings;
  }, [browserSteps, paginationType, limitType, customLimit]);

  const resetListState = useCallback(() => {
    setShowPaginationOptions(false);
    updatePaginationType('');
    setShowLimitOptions(false);
    updateLimitType('');
    updateCustomLimit('');
  }, [setShowPaginationOptions, updatePaginationType, setShowLimitOptions, updateLimitType, updateCustomLimit]);

  const handleStopGetList = useCallback(() => {
    stopGetList();
    resetListState();
  }, [stopGetList, resetListState]);

  const stopCaptureAndEmitGetListSettings = useCallback(() => {
    const settings = getListSettingsObject();
    
    const latestListStep = getLatestListStep(browserSteps);
    if (latestListStep && settings) {
      extractDataClientSide(latestListStep.listSelector!, latestListStep.fields, latestListStep.id);
      
      socket?.emit('action', { action: 'scrapeList', settings });
    } else {
      notify('error', t('right_panel.errors.unable_create_settings'));
    }
    
    handleStopGetList();
    setCurrentListActionId('');
    resetInterpretationLog();
    finishAction('list');
    onFinishCapture();
  }, [getListSettingsObject, socket, notify, handleStopGetList, resetInterpretationLog, finishAction, onFinishCapture, t, browserSteps, extractDataClientSide]);

  const hasUnconfirmedListTextFields = browserSteps.some(step =>
    step.type === 'list' &&
    Object.entries(step.fields).some(([fieldKey]) =>
      !confirmedListTextFields[step.id]?.[fieldKey]
    )
  );

  const getLatestListStep = (steps: BrowserStep[]) => {
    const listSteps = steps.filter(step => step.type === 'list');
    if (listSteps.length === 0) return null;
    
    return listSteps.sort((a, b) => b.id - a.id)[0];
  };

  const handleConfirmListCapture = useCallback(() => {
    switch (captureStage) {
      case 'initial':
        startPaginationMode();
        setShowPaginationOptions(true);
        setCaptureStage('pagination');
        break;

      case 'pagination':
        if (!paginationType) {
          notify('error', t('right_panel.errors.select_pagination'));
          return;
        }
        const settings = getListSettingsObject();
        const paginationSelector = settings.pagination?.selector;
        if (['clickNext', 'clickLoadMore'].includes(paginationType) && !paginationSelector) {
          notify('error', t('right_panel.errors.select_pagination_element'));
          return;
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
        setIsCaptureListConfirmed(true);
        stopCaptureAndEmitGetListSettings();
        setCaptureStage('complete');
        break;

      case 'complete':
        setCaptureStage('initial');
        break;
    }
  }, [captureStage, paginationType, limitType, customLimit, startPaginationMode, setShowPaginationOptions, setCaptureStage, getListSettingsObject, notify, stopPaginationMode, startLimitMode, setShowLimitOptions, stopLimitMode, setIsCaptureListConfirmed, stopCaptureAndEmitGetListSettings, t]);

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
  }, [captureStage, stopLimitMode, setShowLimitOptions, startPaginationMode, setShowPaginationOptions, setCaptureStage, stopPaginationMode]);

  const handlePaginationSettingSelect = (option: PaginationType) => {
    updatePaginationType(option);
  };

  const discardGetText = useCallback(() => {
    stopGetText();
    
    if (currentTextActionId) {
      const stepsToDelete = browserSteps
        .filter(step => step.type === 'text' && step.actionId === currentTextActionId)
        .map(step => step.id);
      
      deleteStepsByActionId(currentTextActionId);
      
      setTextLabels(prevLabels => {
        const newLabels = { ...prevLabels };
        stepsToDelete.forEach(id => {
          delete newLabels[id];
        });
        return newLabels;
      });
      
      setErrors(prevErrors => {
        const newErrors = { ...prevErrors };
        stepsToDelete.forEach(id => {
          delete newErrors[id];
        });
        return newErrors;
      });
      
      setConfirmedTextSteps(prev => {
        const newConfirmed = { ...prev };
        stepsToDelete.forEach(id => {
          delete newConfirmed[id];
        });
        return newConfirmed;
      });
    }
    
    setCurrentTextActionId('');
    setIsCaptureTextConfirmed(false);
    notify('error', t('right_panel.errors.capture_text_discarded'));
  }, [currentTextActionId, browserSteps, stopGetText, deleteStepsByActionId, notify, t]);

  const discardGetList = useCallback(() => {
    stopGetList();
    
    if (currentListActionId) {
      const listStepsToDelete = browserSteps
        .filter(step => step.type === 'list' && step.actionId === currentListActionId)
        .map(step => step.id);
      
      deleteStepsByActionId(currentListActionId);
      
      setConfirmedListTextFields(prev => {
        const newConfirmed = { ...prev };
        listStepsToDelete.forEach(id => {
          delete newConfirmed[id];
        });
        return newConfirmed;
      });
    }
    
    resetListState();
    stopPaginationMode();
    stopLimitMode();
    setShowPaginationOptions(false);
    setShowLimitOptions(false);
    setCaptureStage('initial');
    setCurrentListActionId('');
    setIsCaptureListConfirmed(false);
    notify('error', t('right_panel.errors.capture_list_discarded'));
  }, [currentListActionId, browserSteps, stopGetList, deleteStepsByActionId, resetListState, setShowPaginationOptions, setShowLimitOptions, setCaptureStage, notify, t]);

  const captureScreenshot = (fullPage: boolean) => {
    const screenshotSettings = {
      fullPage,
      type: 'png' as const,
      timeout: 30000,
      animations: 'allow' as const,
      caret: 'hide' as const,
      scale: 'device' as const,
    };
    socket?.emit('captureDirectScreenshot', screenshotSettings);   
    socket?.emit('action', { action: 'screenshot', settings: screenshotSettings });
    addScreenshotStep(fullPage, currentScreenshotActionId);
    stopGetScreenshot();
    resetInterpretationLog();
    finishAction('screenshot');
    onFinishCapture();
  };

  const isConfirmCaptureDisabled = useMemo(() => {
    if (captureStage !== 'initial') return false;

    const hasValidListSelector = browserSteps.some(step =>
      step.type === 'list' &&
      step.listSelector &&
      Object.keys(step.fields).length > 0
    );

    return !hasValidListSelector || hasUnconfirmedListTextFields;
  }, [captureStage, browserSteps, hasUnconfirmedListTextFields]);

  const theme = useThemeMode();
  const isDarkMode = theme.darkMode;

  return (
    <Paper sx={{ height: panelHeight, width: 'auto', alignItems: "center", background: 'inherit' }} id="browser-actions" elevation={0}>
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
                disabled={captureStage === 'initial' ? isConfirmCaptureDisabled : hasUnconfirmedListTextFields}
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
                <FormLabel>
                  <Typography variant="h6" sx={{ 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    mb: 1,
                    whiteSpace: 'normal', 
                    wordBreak: 'break-word' 
                  }}>
                    {t('right_panel.limit.title')}
                  </Typography>
                </FormLabel>
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
      
      <Box>
        {browserSteps.map(step => (
          <Box key={step.id} onMouseEnter={() => handleMouseEnter(step.id)} onMouseLeave={() => handleMouseLeave(step.id)} sx={{ padding: '10px', margin: '11px', borderRadius: '5px', position: 'relative', background: isDarkMode ? "#1E2124" : 'white', color: isDarkMode ? "white" : 'black' }}>
            {
              step.type === 'text' && (
                <>
                  <TextField
                    label={t('right_panel.fields.label')}
                    value={textLabels[step.id] || step.label || ''}
                    onChange={(e) => handleTextLabelChange(step.id, e.target.value)}
                    fullWidth
                    size="small"
                    margin="normal"
                    error={!!errors[step.id]}
                    helperText={errors[step.id]}
                    InputProps={{
                      readOnly: confirmedTextSteps[step.id],
                      startAdornment: (
                        <InputAdornment position="start">
                          <EditIcon />
                        </InputAdornment>
                      )
                    }}
                    sx={{ background: isDarkMode ? "#1E2124" : 'white', color: isDarkMode ? "white" : 'black' }}
                  />
                  <TextField
                    label={t('right_panel.fields.data')}
                    value={step.data}
                    fullWidth
                    margin="normal"
                    InputProps={{
                      readOnly: confirmedTextSteps[step.id],
                      startAdornment: (
                        <InputAdornment position="start">
                          <TextFieldsIcon />
                        </InputAdornment>
                      )
                    }}
                  />
                  {!confirmedTextSteps[step.id] ? (
                    <Box display="flex" justifyContent="space-between" gap={2}>
                      <Button variant="contained" onClick={() => handleTextStepConfirm(step.id)} disabled={!textLabels[step.id]?.trim()}>{t('right_panel.buttons.confirm')}</Button>
                      <Button variant="contained" color="error" onClick={() => handleTextStepDiscard(step.id)}>{t('right_panel.buttons.discard')}</Button>
                    </Box>
                  ) : !isCaptureTextConfirmed && (
                    <Box display="flex" justifyContent="flex-end" gap={2}>
                      <Button
                        variant="contained"
                        color="error"
                        onClick={() => handleTextStepDelete(step.id)}
                      >
                        {t('right_panel.buttons.delete')}
                      </Button>
                    </Box>
                  )}
                </>
              )}
            {step.type === 'screenshot' && (
              <Box display="flex" alignItems="center">
                <DocumentScannerIcon sx={{ mr: 1 }} />
                <Typography>
                  {step.fullPage ?
                    t('right_panel.screenshot.display_fullpage') :
                    t('right_panel.screenshot.display_visible')}
                </Typography>
              </Box>
            )}
            {step.type === 'list' && (
              Object.entries(step.fields).length === 0 ? (
                <Typography>{t('right_panel.messages.list_empty')}</Typography>
              ) : (
                <>
                  <Typography>{t('right_panel.messages.list_selected')}</Typography>
                  {Object.entries(step.fields).map(([key, field]) => (
                    <Box key={key}>
                      <TextField
                        label={t('right_panel.fields.field_label')}
                        value={field.label || ''}
                        onChange={(e) => handleTextLabelChange(field.id, e.target.value, step.id, key)}
                        fullWidth
                        margin="normal"
                        InputProps={{
                          readOnly: confirmedListTextFields[field.id]?.[key],
                          startAdornment: (
                            <InputAdornment position="start">
                              <EditIcon />
                            </InputAdornment>
                          )
                        }}
                      />
                      <TextField
                        label={t('right_panel.fields.field_data')}
                        value={field.data || ''}
                        fullWidth
                        margin="normal"
                        InputProps={{
                          readOnly: true,
                          startAdornment: (
                            <InputAdornment position="start">
                              <TextFieldsIcon />
                            </InputAdornment>
                          )
                        }}
                      />
                      {!confirmedListTextFields[step.id]?.[key] && (
                        <Box display="flex" justifyContent="space-between" gap={2}>
                          <Button
                            variant="contained"
                            onClick={() => handleListTextFieldConfirm(step.id, key)}
                            disabled={!field.label?.trim()}
                          >
                            {t('right_panel.buttons.confirm')}
                          </Button>
                          <Button
                            variant="contained"
                            color="error"
                            onClick={() => handleListTextFieldDiscard(step.id, key)}
                          >
                            {t('right_panel.buttons.discard')}
                          </Button>
                        </Box>
                      )}
                    </Box>
                  ))}
                </>
              )
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
};