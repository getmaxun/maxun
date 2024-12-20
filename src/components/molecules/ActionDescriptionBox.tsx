import React from 'react';
import styled from 'styled-components';
import { Typography, FormControlLabel, Checkbox, Box } from '@mui/material';
import { useActionContext } from '../../context/browserActions';
import MaxunLogo from "../../assets/maxunlogo.png";
import { useTranslation } from 'react-i18next';

const CustomBoxContainer = styled.div`
  position: relative;
  min-width: 250px;
  width: auto;
  min-height: 100px;
  height: auto;
  // border: 2px solid #ff00c3;
  border-radius: 5px;
  background-color: white;
  margin: 80px 13px 25px 13px;
`;

const Triangle = styled.div`
  position: absolute;
  top: -15px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 20px solid transparent;
  border-right: 20px solid transparent;
  border-bottom: 20px solid white;
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

const ActionDescriptionBox = () => {
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
                  />
                }
                label={<Typography variant="body2" gutterBottom>{text}</Typography>}
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
    <CustomBoxContainer>
      <Logo src={MaxunLogo} alt={t('common.maxun_logo')} />
      <Triangle />
      <Content>
        {renderActionDescription()}
      </Content>
    </CustomBoxContainer>
  );
};

export default ActionDescriptionBox;