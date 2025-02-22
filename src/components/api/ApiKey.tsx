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
        notify('success', t('apikey.notifications.success.fetch'));
      } catch (error: any) {
        const status = error.response?.status;
        let errorKey = 'unknown';
    
        switch (status) {
          case 401:
            errorKey = 'unauthorized';
            break;
          case 404:
            errorKey = 'not_found';
            break;
          case 500:
            errorKey = 'server';
            break;
          default:
            if (error.message?.includes('Network Error')) {
              errorKey = 'network';
            }
        }
    
        notify(
          'error',
          t(`apikey.notifications.errors.fetch.${errorKey}`, {
            error: error.response?.data?.message || error.message
          })
        );
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
      if (data.ok && data.api_key) {
        setApiKey(data.api_key);
        notify('success', t('apikey.notifications.success.generate'));
      }
    } catch (error: any) {
      const status = error.response?.status;
      let errorKey = 'unknown';
  
      switch (status) {
        case 401:
          errorKey = 'unauthorized';
          break;
        case 403:
          errorKey = 'limit_reached';
          break;
        case 500:
          errorKey = 'server';
          break;
        default:
          if (error.message?.includes('Network Error')) {
            errorKey = 'network';
          }
      }
  
      notify(
        'error',
        t(`apikey.notifications.errors.generate.${errorKey}`, {
          error: error.response?.data?.message || error.message
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const deleteApiKey = async () => {
    setLoading(true);
    try {
      const response = await axios.delete(`${apiUrl}/auth/delete-api-key`);
      if (response.data.ok) {
        setApiKey(null);
        notify('success', t('apikey.notifications.success.delete'));
      }
    } catch (error: any) {
      const status = error.response?.status;
      let errorKey = 'unknown';
  
      switch (status) {
        case 401:
          errorKey = 'unauthorized';
          break;
        case 404:
          errorKey = 'not_found';
          break;
        case 500:
          errorKey = 'server';
          break;
        default:
          if (error.message?.includes('Network Error')) {
            errorKey = 'network';
          }
      }
  
      notify(
        'error',
        t(`apikey.notifications.errors.delete.${errorKey}`, {
          error: error.response?.data?.message || error.message
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!apiKey) return;
  
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopySuccess(true);
      notify('success', t('apikey.notifications.success.copy'));
      
      // Reset copy success state after 2 seconds
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      notify('error', t('apikey.notifications.errors.copy.failed'));
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
                      {showKey ? <VisibilityOff /> : <Visibility />}
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