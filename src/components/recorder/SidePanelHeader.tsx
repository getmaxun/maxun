import React, { FC, useState } from 'react';
import { InterpretationButtons } from "../run/InterpretationButtons";
import { useSocketStore } from "../../context/socket";

interface SidePanelHeaderProps {
  onPreviewClick?: () => void;
}

export const SidePanelHeader = ({ onPreviewClick }: SidePanelHeaderProps) => {

  const [steppingIsDisabled, setSteppingIsDisabled] = useState(true);

  const { socket } = useSocketStore();

  const handleStep = () => {
    socket?.emit('step');
  };

  return (
    <div style={{ width: 'inherit' }}>
      <InterpretationButtons 
        enableStepping={(isPaused) => setSteppingIsDisabled(!isPaused)} 
        onPreviewComplete={onPreviewClick}
      />
      {/* <Button
       variant='outlined'
       disabled={steppingIsDisabled}
       onClick={handleStep}
       sx={{marginLeft:'15px'}}
     >
       step
       <FastForward/>
     </Button> */}
    </div>
  );
};
