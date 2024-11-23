import React from 'react';
import styled from 'styled-components';
import { Typography, FormControlLabel, Checkbox, Box } from '@mui/material';
import { useActionContext } from '../../context/browserActions';
import MaxunLogo from "../../assets/maxunlogo.png";

interface CustomBoxContainerProps {
  isDarkMode: boolean;
}

const CustomBoxContainer = styled.div<CustomBoxContainerProps>`
  position: relative;
  min-width: 250px;
  width: auto;
  min-height: 100px;
  height: auto;
  border-radius: 5px;
  background-color: ${({ isDarkMode }) => (isDarkMode ? '#313438' : 'white')};
  color: ${({ isDarkMode }) => (isDarkMode ? 'white' : 'black')};
  margin: 80px 13px 25px 13px;
  box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
`;

const Triangle = styled.div<CustomBoxContainerProps>`
  position: absolute;
  top: -15px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 20px solid transparent;
  border-right: 20px solid transparent;
  border-bottom: 20px solid ${({ isDarkMode }) => (isDarkMode ? '#313438' : 'white')};
`;

const Logo = styled.img`
  position: absolute;
  top: -80px;
  left: 50%;
  transform: translateX(-50%);
  width: 70px;
  height: auto;
  border-radius: 5px;
`;

const Content = styled.div`
  padding: 20px;
  text-align: left;
`;

const ActionDescriptionBox = ({ isDarkMode }: { isDarkMode: boolean }) => {
  const { getText, getScreenshot, getList, captureStage } = useActionContext() as {
    getText: boolean;
    getScreenshot: boolean;
    getList: boolean;
    captureStage: 'initial' | 'pagination' | 'limit' | 'complete';
  };

  const messages = [
    { stage: 'initial', text: 'Select the list you want to extract along with the texts inside it' },
    { stage: 'pagination', text: 'Select how the robot can capture the rest of the list' },
    { stage: 'limit', text: 'Choose the number of items to extract' },
    { stage: 'complete', text: 'Capture is complete' },
  ];

  const stages = messages.map(({ stage }) => stage);
  const currentStageIndex = stages.indexOf(captureStage);

  const renderActionDescription = () => {
    if (getText) {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>Capture Text</Typography>
          <Typography variant="body2" gutterBottom>Hover over the texts you want to extract and click to select them</Typography>
        </>
      );
    } else if (getScreenshot) {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>Capture Screenshot</Typography>
          <Typography variant="body2" gutterBottom>Capture a partial or full page screenshot of the current page.</Typography>
        </>
      );
    } else if (getList) {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>Capture List</Typography>
          <Typography variant="body2" gutterBottom>
            Hover over the list you want to extract. Once selected, you can hover over all texts inside the list you selected. Click to select them.
          </Typography>
          <Box>
            {messages.map(({ stage, text }, index) => (
              <FormControlLabel
                key={stage}
                control={
                  <Checkbox
                    checked={index < currentStageIndex}
                    disabled
                    sx={{
                      color: isDarkMode ? 'white' : 'default',
                      '&.Mui-checked': {
                        color: isDarkMode ? '#90caf9' : '#1976d2',
                      },
                    }}
                  />
                }
                label={
                  <Typography variant="body2" gutterBottom color={isDarkMode ? 'white' : 'textPrimary'}>
                    {text}
                  </Typography>
                }
              />
            ))}
          </Box>
        </>
      );
    } else {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>What data do you want to extract?</Typography>
          <Typography variant="body2" gutterBottom>A robot is designed to perform one action at a time. You can choose any of the options below.</Typography>
        </>
      );
    }
  };

  return (
    <CustomBoxContainer isDarkMode={isDarkMode}>
      <Logo src={MaxunLogo} alt="Maxun Logo" />
      <Triangle isDarkMode={isDarkMode} />
      <Content>
        {renderActionDescription()}
      </Content>
    </CustomBoxContainer>
  );
};

export default ActionDescriptionBox;
