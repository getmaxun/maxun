import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  IconButton,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Paper,
} from '@mui/material';
import { ContentCopy, Visibility, VisibilityOff, Delete } from '@mui/icons-material';
import styled from 'styled-components';
import axios from 'axios';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { apiUrl } from '../../apiConfig';
import { useTranslation } from 'react-i18next';

const Container = styled(Box)`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 50px;
  margin-left: 50px;
`;

const ApiKeyManager = () => {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyName, setApiKeyName] = useState<string>(t('apikey.default_name'));
  const [loading, setLoading] = useState<boolean>(true);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const { notify } = useGlobalInfoStore();

  useEffect(() => {
    const fetchApiKey = async () => {
      try {
        const { data } = await axios.get(`${apiUrl}/auth/api-key`);
        setApiKey(data.api_key);
      } catch (error: any) {
        notify('error', t('apikey.notifications.fetch_error', { error: error.message }));
      } finally {
        setLoading(false);
      }
    };

    fetchApiKey();

  }, []);

  const generateApiKey = async () => {
    setLoading(true);
    try {
      const { data } = await axios.post(`${apiUrl}/auth/generate-api-key`);
      setApiKey(data.api_key);

      notify('success', t('apikey.notifications.generate_success'));
    } catch (error: any) {
      notify('error', t('apikey.notifications.generate_error', { error: error.message }));
    } finally {
      setLoading(false);
    }
  };

  const deleteApiKey = async () => {
    setLoading(true);
    try {
      await axios.delete(`${apiUrl}/auth/delete-api-key`);
      setApiKey(null);
      notify('success', t('apikey.notifications.delete_success'));
    } catch (error: any) {
      notify('error', t('apikey.notifications.delete_error', { error: error.message }));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      notify('info', t('apikey.notifications.copy_success'));
    }
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          width: '100vw',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container sx={{ alignSelf: 'flex-start' }}>
      <Typography variant="h6" gutterBottom component="div" style={{ marginBottom: '20px' }}>
        {t('apikey.title')}
      </Typography>
      {apiKey ? (
        <TableContainer component={Paper} sx={{ width: '100%', overflow: 'hidden' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('apikey.table.name')}</TableCell>
                <TableCell>{t('apikey.table.key')}</TableCell>
                <TableCell>{t('apikey.table.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>{apiKeyName}</TableCell>
                <TableCell>
                  <Box sx={{ fontFamily: 'monospace', width: '10ch' }}>
                    {showKey ? `${apiKey?.substring(0, 10)}...` : '**********'}
                  </Box>
                </TableCell>
                <TableCell>
                  <Tooltip title={t('apikey.actions.copy')}>
                    <IconButton onClick={copyToClipboard}>
                      <ContentCopy />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={showKey ? t('apikey.actions.hide') : t('apikey.actions.show')}>
                    <IconButton onClick={() => setShowKey(!showKey)}>
                      {showKey ? <Visibility /> : <VisibilityOff />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('apikey.actions.delete')}>
                    <IconButton onClick={deleteApiKey} color="error">
                      <Delete />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <>
          <Typography>{t('apikey.no_key_message')}</Typography>
          <Button onClick={generateApiKey} variant="contained" color="primary" sx={{ marginTop: '15px' }}>
            {t('apikey.generate_button')}
          </Button>
        </>
      )}
    </Container>
  );
};

export default ApiKeyManager;