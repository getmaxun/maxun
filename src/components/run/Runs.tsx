import React, { useEffect } from 'react';
import { Grid } from "@mui/material";
import { RunsTable } from "./RunsTable";

interface RunsProps {
  currentInterpretationLog: string;
  abortRunHandler: () => void;
  runId: string;
  runningRecordingName: string;
}

export const Runs = (
  { currentInterpretationLog, abortRunHandler, runId, runningRecordingName }: RunsProps) => {

  return (
    <Grid container direction="column" sx={{ padding: '30px' }}>
      <Grid item xs>
        <RunsTable
          currentInterpretationLog={currentInterpretationLog}
          abortRunHandler={abortRunHandler}
          runId={runId}
          runningRecordingName={runningRecordingName}
        />
      </Grid>
    </Grid>
  );
}
