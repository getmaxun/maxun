import React from 'react';
import styled from 'styled-components';
import { Typography, FormControlLabel, Checkbox, Box } from '@mui/material';
import { useActionContext } from '../../context/browserActions';
import MaxunLogo from "../../assets/maxunlogo.png";
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const { getText, getScreenshot, getList, captureStage } = useActionContext() as {
    getText: boolean;
    getScreenshot: boolean;
    getList: boolean;
    captureStage: 'initial' | 'pagination' | 'limit' | 'complete';
  };

  const messages = [
    { stage: 'initial' as const, text: t('action_description.list_stages.initial') },
    { stage: 'pagination' as const, text: t('action_description.list_stages.pagination') },
    { stage: 'limit' as const, text: t('action_description.list_stages.limit') },
    { stage: 'complete' as const, text: t('action_description.list_stages.complete') },
  ];

  const stages = messages.map(({ stage }) => stage);
  const currentStageIndex = stages.indexOf(captureStage);

  const renderActionDescription = () => {
    if (getText) {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>{t('action_description.text.title')}</Typography>
          <Typography variant="body2" gutterBottom>{t('action_description.text.description')}</Typography>
        </>
      );
    } else if (getScreenshot) {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>{t('action_description.screenshot.title')}</Typography>
          <Typography variant="body2" gutterBottom>{t('action_description.screenshot.description')}</Typography>
        </>
      );
    } else if (getList) {
      return (
        <>
          <Typography variant="subtitle2" gutterBottom>{t('action_description.list.title')}</Typography>
          <Typography variant="body2" gutterBottom>
            {t('action_description.list.description')}
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
          <Typography variant="subtitle2" gutterBottom>{t('action_description.default.title')}</Typography>
          <Typography variant="body2" gutterBottom>{t('action_description.default.description')}</Typography>
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