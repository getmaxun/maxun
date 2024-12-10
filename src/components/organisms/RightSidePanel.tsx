import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Paper, Box, TextField, IconButton } from "@mui/material";
import EditIcon from '@mui/icons-material/Edit';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import { SimpleBox } from "../atoms/Box";
import { WorkflowFile } from "maxun-core";
import Typography from "@mui/material/Typography";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { PaginationType, useActionContext, LimitType } from '../../context/browserActions';
import { useBrowserSteps } from '../../context/browserSteps';
import { useSocketStore } from '../../context/socket';
import { ScreenshotSettings } from '../../shared/types';
import InputAdornment from '@mui/material/InputAdornment';
import { SidePanelHeader } from '../molecules/SidePanelHeader';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { emptyWorkflow } from "../../shared/constants";
import { getActiveWorkflow } from "../../api/workflow";
import DeleteIcon from '@mui/icons-material/Delete';
import ActionDescriptionBox from '../molecules/ActionDescriptionBox';

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

// TODO: 
// 1. Add description for each browser step
// 2. Handle non custom action steps
interface RightSidePanelProps {
  onFinishCapture: () => void;
}

export const RightSidePanel: React.FC<RightSidePanelProps> = ({ onFinishCapture }) => {
  const [workflow, setWorkflow] = useState<WorkflowFile>(emptyWorkflow);
  const [textLabels, setTextLabels] = useState<{ [id: string]: string }>({});
  const [errors, setErrors] = useState<{ [id: string]: string }>({});
  const [confirmedTextSteps, setConfirmedTextSteps] = useState<{ [id: string]: boolean }>({});
  const [confirmedListTextFields, setConfirmedListTextFields] = useState<{ [listId: string]: { [fieldKey: string]: boolean } }>({});
  const [showPaginationOptions, setShowPaginationOptions] = useState(false);
  const [showLimitOptions, setShowLimitOptions] = useState(false);
  const [showCaptureList, setShowCaptureList] = useState(true);
  const [showCaptureScreenshot, setShowCaptureScreenshot] = useState(true);
  const [showCaptureText, setShowCaptureText] = useState(true);
  const [hoverStates, setHoverStates] = useState<{ [id: string]: boolean }>({});
  const [browserStepIdList, setBrowserStepIdList] = useState<number[]>([]);

  const { lastAction, notify, currentWorkflowActionsState, setCurrentWorkflowActionsState } = useGlobalInfoStore();
  const { getText, startGetText, stopGetText, getScreenshot, startGetScreenshot, stopGetScreenshot, getList, startGetList, stopGetList, startPaginationMode, stopPaginationMode, paginationType, updatePaginationType, limitType, customLimit, updateLimitType, updateCustomLimit, stopLimitMode, startLimitMode, captureStage, setCaptureStage } = useActionContext();
  const { browserSteps, updateBrowserTextStepLabel, deleteBrowserStep, addScreenshotStep, updateListTextFieldLabel, removeListTextField } = useBrowserSteps();
  const { id, socket } = useSocketStore();

  const workflowHandler = useCallback((data: WorkflowFile) => {
    setWorkflow(data);
    //setRecordingLength(data.workflow.length);
  }, [workflow])

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

    const shouldHideActions = hasScrapeListAction || hasScrapeSchemaAction || hasScreenshotAction;

    setShowCaptureList(!shouldHideActions);
    setShowCaptureScreenshot(!shouldHideActions);
    setShowCaptureText(!(hasScrapeListAction || hasScreenshotAction));
  }, [workflow]);

  const handleMouseEnter = (id: number) => {
    setHoverStates(prev => ({ ...prev, [id]: true }));
  };

  const handleMouseLeave = (id: number) => {
    setHoverStates(prev => ({ ...prev, [id]: false }));
  };

  const handlePairDelete = () => { }

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
      setErrors(prevErrors => ({ ...prevErrors, [id]: 'Label cannot be empty' }));
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
      setErrors(prevErrors => ({ ...prevErrors, [id]: 'Label cannot be empty' }));
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
      notify('error', 'Please confirm all text fields');
      return;
    }
    stopGetText();
    const settings = getTextSettingsObject();
    console.log("SETTINGS", settings);
    const hasTextSteps = browserSteps.some(step => step.type === 'text');
    if (hasTextSteps) {
      socket?.emit('action', { action: 'scrapeSchema', settings });
    }
    onFinishCapture();
  }, [stopGetText, getTextSettingsObject, socket, browserSteps, confirmedTextSteps]);

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
  }, [updatePaginationType, updateLimitType, updateCustomLimit]);

  const handleStopGetList = useCallback(() => {
    stopGetList();
    resetListState();
  }, [stopGetList, resetListState]);

  const stopCaptureAndEmitGetListSettings = useCallback(() => {
    const settings = getListSettingsObject();
    if (settings) {
      socket?.emit('action', { action: 'scrapeList', settings });
    } else {
      notify('error', 'Unable to create list settings. Make sure you have defined a field for the list.');
    }
    handleStopGetList();
    onFinishCapture();
  }, [stopGetList, getListSettingsObject, socket, notify, handleStopGetList]);

  const hasUnconfirmedListTextFields = browserSteps.some(step => step.type === 'list' && Object.values(step.fields).some(field => !confirmedListTextFields[step.id]?.[field.id]));

  const handleConfirmListCapture = useCallback(() => {
    switch (captureStage) {
      case 'initial':
        startPaginationMode();
        setShowPaginationOptions(true);
        setCaptureStage('pagination');
        break;

      case 'pagination':
        if (!paginationType) {
          notify('error', 'Please select a pagination type.');
          return;
        }
        const settings = getListSettingsObject();
        const paginationSelector = settings.pagination?.selector;
        if (['clickNext', 'clickLoadMore'].includes(paginationType) && !paginationSelector) {
          notify('error', 'Please select the pagination element first.');
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
          notify('error', 'Please select a limit or enter a custom limit.');
          return;
        }
        const limit = limitType === 'custom' ? parseInt(customLimit) : parseInt(limitType);
        if (isNaN(limit) || limit <= 0) {
          notify('error', 'Please enter a valid limit.');
          return;
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
  }, [captureStage, paginationType, limitType, customLimit, startPaginationMode, stopPaginationMode, startLimitMode, stopLimitMode, notify, stopCaptureAndEmitGetListSettings, getListSettingsObject]);

  const handlePaginationSettingSelect = (option: PaginationType) => {
    updatePaginationType(option);
  };

  const discardGetText = useCallback(() => {
    stopGetText();
    browserSteps.forEach(step => {
      if (step.type === 'text') {
        deleteBrowserStep(step.id);
      }
    });
    setTextLabels({});
    setErrors({});
    setConfirmedTextSteps({});
    notify('error', 'Capture Text Discarded');
  }, [browserSteps, stopGetText, deleteBrowserStep]);

  const discardGetList = useCallback(() => {
    stopGetList();
    browserSteps.forEach(step => {
      if (step.type === 'list') {
        deleteBrowserStep(step.id);
      }
    });
    resetListState();
    setShowPaginationOptions(false);
    setShowLimitOptions(false);
    setCaptureStage('initial');
    setConfirmedListTextFields({});
    notify('error', 'Capture List Discarded');
  }, [browserSteps, stopGetList, deleteBrowserStep, resetListState]);


  const captureScreenshot = (fullPage: boolean) => {
    const screenshotSettings: ScreenshotSettings = {
      fullPage,
      type: 'png',
      timeout: 30000,
      animations: 'allow',
      caret: 'hide',
      scale: 'device',
    };
    socket?.emit('action', { action: 'screenshot', settings: screenshotSettings });
    addScreenshotStep(fullPage);
    stopGetScreenshot();
  };

  const isConfirmCaptureDisabled = useMemo(() => {
    // Check if we are in the initial stage and if there are no browser steps or no valid list selectors with fields
    if (captureStage !== 'initial') return false;
  
    const hasValidListSelector = browserSteps.some(step => 
      step.type === 'list' && 
      step.listSelector && 
      Object.keys(step.fields).length > 0
    );
  
     // Disable the button if there are no valid list selectors or if there are unconfirmed list text fields
    return !hasValidListSelector || hasUnconfirmedListTextFields;
  }, [captureStage, browserSteps, hasUnconfirmedListTextFields]);

  return (
    <Paper sx={{ height: '520px', width: 'auto', alignItems: "center", background: 'inherit' }} id="browser-actions" elevation={0}>
      {/* <SimpleBox height={60} width='100%' background='lightGray' radius='0%'>
        <Typography sx={{ padding: '10px' }}>Last action: {` ${lastAction}`}</Typography>
      </SimpleBox> */}
      <ActionDescriptionBox />
      <Box display="flex" flexDirection="column" gap={2} style={{ margin: '13px' }}>
        {!getText && !getScreenshot && !getList && showCaptureList && <Button variant="contained" onClick={startGetList}>Capture List</Button>}
        {getList && (
          <>
            <Box display="flex" justifyContent="space-between" gap={2} style={{ margin: '15px' }}>
              <Button
                variant="outlined"
                onClick={handleConfirmListCapture}
                disabled={captureStage === 'initial' ? isConfirmCaptureDisabled : hasUnconfirmedListTextFields}
              >
                {captureStage === 'initial' ? 'Confirm Capture' :
                  captureStage === 'pagination' ? 'Confirm Pagination' :
                    captureStage === 'limit' ? 'Confirm Limit' : 'Finish Capture'}
              </Button>
              <Button variant="outlined" color="error" onClick={discardGetList}>Discard</Button>
            </Box>
          </>
        )}
        {showPaginationOptions && (
          <Box display="flex" flexDirection="column" gap={2} style={{ margin: '13px' }}>
            <Typography>How can we find the next list item on the page?</Typography>
            <Button variant={paginationType === 'clickNext' ? "contained" : "outlined"} onClick={() => handlePaginationSettingSelect('clickNext')}>Click on next to navigate to the next page</Button>
            <Button variant={paginationType === 'clickLoadMore' ? "contained" : "outlined"} onClick={() => handlePaginationSettingSelect('clickLoadMore')}>Click on load more to load more items</Button>
            <Button variant={paginationType === 'scrollDown' ? "contained" : "outlined"} onClick={() => handlePaginationSettingSelect('scrollDown')}>Scroll down to load more items</Button>
            <Button variant={paginationType === 'scrollUp' ? "contained" : "outlined"} onClick={() => handlePaginationSettingSelect('scrollUp')}>Scroll up to load more items</Button>
            <Button variant={paginationType === 'none' ? "contained" : "outlined"} onClick={() => handlePaginationSettingSelect('none')}>No more items to load</Button>
          </Box>
        )}
        {showLimitOptions && (
          <FormControl>
            <FormLabel>
              <h4>What is the maximum number of rows you want to extract?</h4>
            </FormLabel>
            <RadioGroup
              value={limitType}
              onChange={(e) => updateLimitType(e.target.value as LimitType)}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                width: '500px'
              }}
            >
              <FormControlLabel value="10" control={<Radio />} label="10" />
              <FormControlLabel value="100" control={<Radio />} label="100" />
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <FormControlLabel value="custom" control={<Radio />} label="Custom" />
                {limitType === 'custom' && (
                  <TextField
                  type="number"
                  value={customLimit}
                  onChange={(e) => updateCustomLimit(e.target.value)}
                  placeholder="Enter number"
                  sx={{
                    marginLeft: '10px',
                    '& input': {
                    padding: '10px',
                    background: 'white',
                    },
                    width: '150px', // Ensure the text field does not go outside the panel
                  }}
                  />
                )}
              </div>
            </RadioGroup>
          </FormControl>
        )}
        {!getText && !getScreenshot && !getList && showCaptureText && <Button variant="contained" onClick={startGetText}>Capture Text</Button>}
        {getText &&
          <>
            <Box display="flex" justifyContent="space-between" gap={2} style={{ margin: '15px' }}>
              <Button variant="outlined" onClick={stopCaptureAndEmitGetTextSettings} >Confirm</Button>
              <Button variant="outlined" color="error" onClick={discardGetText} >Discard</Button>
            </Box>
          </>
        }
        {!getText && !getScreenshot && !getList && showCaptureScreenshot && <Button variant="contained" onClick={startGetScreenshot}>Capture Screenshot</Button>}
        {getScreenshot && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Button variant="contained" onClick={() => captureScreenshot(true)}>Capture Fullpage</Button>
            <Button variant="contained" onClick={() => captureScreenshot(false)}>Capture Visible Part</Button>
            <Button variant="outlined" color="error" onClick={stopGetScreenshot}>Discard</Button>
          </Box>
        )}
      </Box>
      <Box>
        {browserSteps.map(step => (
          <Box key={step.id} onMouseEnter={() => handleMouseEnter(step.id)} onMouseLeave={() => handleMouseLeave(step.id)} sx={{ padding: '10px', margin: '11px', borderRadius: '5px', position: 'relative', background: 'white' }}>
            {
              step.type === 'text' && (
                <>
                  <TextField
                    label="Label"
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
                  />
                  <TextField
                    label="Data"
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
                  {!confirmedTextSteps[step.id] && (
                    <Box display="flex" justifyContent="space-between" gap={2}>
                      <Button variant="contained" onClick={() => handleTextStepConfirm(step.id)} disabled={!textLabels[step.id]?.trim()}>Confirm</Button>
                      <Button variant="contained" color="error" onClick={() => handleTextStepDiscard(step.id)}>Discard</Button>
                    </Box>
                  )}
                </>
              )}
            {step.type === 'screenshot' && (
              <Box display="flex" alignItems="center">
                <DocumentScannerIcon sx={{ mr: 1 }} />
                <Typography>
                  {`Take ${step.fullPage ? 'Fullpage' : 'Visible Part'} Screenshot`}
                </Typography>
              </Box>
            )}
            {step.type === 'list' && (
              <>
                <Typography>List Selected Successfully</Typography>
                {Object.entries(step.fields).map(([key, field]) => (
                  <Box key={key}>
                    <TextField
                      label="Field Label"
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
                      label="Field Data"
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
                          Confirm
                        </Button>
                        <Button
                          variant="contained"
                          color="error"
                          onClick={() => handleListTextFieldDiscard(step.id, key)}
                        >
                          Discard
                        </Button>
                      </Box>
                    )}
                  </Box>
                ))}
              </>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
};