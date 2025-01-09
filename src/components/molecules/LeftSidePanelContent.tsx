import React, { useCallback, useEffect, useState } from 'react';
import Box from "@mui/material/Box";
import { Pair } from "./Pair";
import { WhereWhatPair, WorkflowFile } from "maxun-core";
import { useSocketStore } from "../../context/socket";
import { Add } from "@mui/icons-material";
import { Socket } from "socket.io-client";
import { AddButton } from "../atoms/buttons/AddButton";
import { AddPair } from "../../api/workflow";
import { GenericModal } from "../atoms/GenericModal";
import { PairEditForm } from "./PairEditForm";
import { Fab, Tooltip, Typography } from "@mui/material";

interface LeftSidePanelContentProps {
  workflow: WorkflowFile;
  updateWorkflow: (workflow: WorkflowFile) => void;
  recordingName: string;
  handleSelectPairForEdit: (pair: WhereWhatPair, index: number) => void;
}

export const LeftSidePanelContent = ({ workflow, updateWorkflow, recordingName, handleSelectPairForEdit }: LeftSidePanelContentProps) => {
  const [activeId, setActiveId] = React.useState<number>(0);
  const [breakpoints, setBreakpoints] = React.useState<boolean[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);

  const { socket } = useSocketStore();

  const activePairIdHandler = useCallback((data: string, socket: Socket) => {
    setActiveId(parseInt(data) + 1);
    // -1 is specially emitted when the interpretation finishes
    if (parseInt(data) === -1) {
      return;
    }
    socket.emit('activeIndex', data);
  }, [activeId])

  const addPair = (pair: WhereWhatPair, index: number) => {
    AddPair((index - 1), pair).then((updatedWorkflow) => {
      updateWorkflow(updatedWorkflow);
    }).catch((error) => {
      console.error(error);
    });
    setShowEditModal(false);
  };

  useEffect(() => {
    socket?.on("activePairId", (data) => activePairIdHandler(data, socket));
    return () => {
      socket?.off("activePairId", (data) => activePairIdHandler(data, socket));
    }
  }, [socket, setActiveId]);


  const handleBreakpointClick = (id: number) => {
    setBreakpoints(oldBreakpoints => {
      const newArray = [...oldBreakpoints, ...Array(workflow.workflow.length - oldBreakpoints.length).fill(false)];
      newArray[id] = !newArray[id];
      socket?.emit("breakpoints", newArray);
      return newArray;
    });
  };

  const handleAddPair = () => {
    setShowEditModal(true);
  };

  return (
    <div>
      <Tooltip title='Add pair' placement='left' arrow>
        <div style={{ float: 'right' }}>
          <AddButton
            handleClick={handleAddPair}
            title=''
            hoverEffect={false}
            style={{ color: 'white', background: '#1976d2' }}
          />
        </div>
      </Tooltip>
      <GenericModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
      >
        <PairEditForm
          onSubmitOfPair={addPair}
          numberOfPairs={workflow.workflow.length}
        />
      </GenericModal>
      <div>
        {
          workflow.workflow.map((pair, i, workflow,) =>
            <Pair
              handleBreakpoint={() => handleBreakpointClick(i)}
              isActive={activeId === i + 1}
              key={workflow.length - i}
              index={workflow.length - i}
              pair={pair}
              updateWorkflow={updateWorkflow}
              numberOfPairs={workflow.length}
              handleSelectPairForEdit={handleSelectPairForEdit}
            />)
        }
      </div>
    </div>
  );
};
