import { Box, Paper, Tab, Tabs } from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { getActiveWorkflow, getParamsOfActiveWorkflow } from "../../api/workflow";
import { useSocketStore } from '../../context/socket';
import { WhereWhatPair, WorkflowFile } from "maxun-core";
import { SidePanelHeader } from "./SidePanelHeader";
import { emptyWorkflow } from "../../shared/constants";
import { LeftSidePanelContent } from "../molecules/LeftSidePanelContent";
import { useBrowserDimensionsStore } from "../../context/browserDimensions";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { TabContext, TabPanel } from "@mui/lab";
import { LeftSidePanelSettings } from "../molecules/LeftSidePanelSettings";
import { RunSettings } from "../run/RunSettings";

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

interface LeftSidePanelProps {
  sidePanelRef: HTMLDivElement | null;
  alreadyHasScrollbar: boolean;
  recordingName: string;
  handleSelectPairForEdit: (pair: WhereWhatPair, index: number) => void;
}

export const LeftSidePanel = (
  { sidePanelRef, alreadyHasScrollbar, recordingName, handleSelectPairForEdit }: LeftSidePanelProps) => {

  const [workflow, setWorkflow] = useState<WorkflowFile>(emptyWorkflow);
  const [hasScrollbar, setHasScrollbar] = useState<boolean>(alreadyHasScrollbar);
  const [tab, setTab] = useState<string>('recording');
  const [params, setParams] = useState<string[]>([]);
  const [settings, setSettings] = React.useState<RunSettings>({
    maxConcurrency: 1,
    maxRepeats: 1,
    debug: false,
  });

  const { id, socket } = useSocketStore();
  const { setWidth, width } = useBrowserDimensionsStore();
  const { setRecordingLength } = useGlobalInfoStore();

  const workflowHandler = useCallback((data: WorkflowFile) => {
    setWorkflow(data);
    setRecordingLength(data.workflow.length);
  }, [workflow])

  useEffect(() => {
    // fetch the workflow every time the id changes
    if (id) {
      fetchWorkflow(id, workflowHandler);
    }
    // fetch workflow in 15min intervals
    let interval = setInterval(() => {
      if (id) {
        fetchWorkflow(id, workflowHandler);
      }
    }, (900 * 60 * 15));
    return () => clearInterval(interval)
  }, [id]);

  useEffect(() => {
    if (socket) {
      socket.on("workflow", workflowHandler);
    }

    if (sidePanelRef) {
      const workflowListHeight = sidePanelRef.clientHeight;
      const innerHeightWithoutNavbar = window.innerHeight - 70;
      if (innerHeightWithoutNavbar <= workflowListHeight) {
        if (!hasScrollbar) {
          setWidth(width - 10);
          setHasScrollbar(true);
        }
      } else {
        if (hasScrollbar && !alreadyHasScrollbar) {
          setWidth(width + 10);
          setHasScrollbar(false);
        }
      }
    }

    return () => {
      socket?.off('workflow', workflowHandler);
    }
  }, [socket, workflowHandler]);

  return (
    <Paper
      sx={{
        height: '100%',
        width: '100%',
        backgroundColor: 'lightgray',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'column',
      }}
    >
      {/* <SidePanelHeader /> */}
      <TabContext value={tab}>
        <Tabs value={tab} onChange={(e, newTab) => setTab(newTab)}>
          <Tab label="Recording" value='recording' />
          <Tab label="Settings" value='settings' onClick={() => {
            getParamsOfActiveWorkflow(id).then((response) => {
              if (response) {
                setParams(response);
              }
            })
          }} />
        </Tabs>
        <TabPanel value='recording' sx={{ padding: '0px' }}>
          <LeftSidePanelContent
            workflow={workflow}
            updateWorkflow={setWorkflow}
            recordingName={recordingName}
            handleSelectPairForEdit={handleSelectPairForEdit}
          />
        </TabPanel>
        <TabPanel value='settings'>
          <LeftSidePanelSettings params={params}
            settings={settings} setSettings={setSettings} />
        </TabPanel>
      </TabContext>
    </Paper>
  );

};
