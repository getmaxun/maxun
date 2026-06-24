import React from 'react';
import { Grid } from "@mui/material";
import { RunsTable } from "./RunsTable";

interface RunsProps {
  currentInterpretationLog: string;
  abortRunHandler: (runId: string, robotName: string, browserId: string) => void;
  rerunHandler: (robotMetaId: string, robotName: string, interpreterSettings: any) => void;
  runId: string;
  runningRecordingName: string;
}

export const Runs = (
  { currentInterpretationLog, abortRunHandler, rerunHandler, runId, runningRecordingName }: RunsProps) => {

  return (
    <Grid container direction="column" sx={{ padding: '30px' }}>
      <Grid item xs>
        <RunsTable
          currentInterpretationLog={currentInterpretationLog}
          abortRunHandler={abortRunHandler}
          rerunHandler={rerunHandler}
          runId={runId}
          runningRecordingName={runningRecordingName}
        />
      </Grid>
    </Grid>
  );
}
