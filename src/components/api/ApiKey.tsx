import React, { useState } from 'react';
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const [apiKeyName, setApiKeyName] = useState<string>(t('apikey.default_name'));
  const [showKey, setShowKey] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const { notify } = useGlobalInfoStore();
  const queryClient = useQueryClient();

  // Fetch API key with React Query
  const { data: apiKey, isLoading } = useQuery({
    queryKey: ['api-key'],
    queryFn: async () => {
      const { data } = await axios.get(`${apiUrl}/auth/api-key`);
      return data.api_key as string | null;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Generate mutation
  const { mutate: generateApiKey, isPending: isGenerating } = useMutation({
    mutationFn: async () => {
      const { data } = await axios.post(`${apiUrl}/auth/generate-api-key`);
      return data.api_key as string;
    },
    onSuccess: (newKey) => {
      queryClient.setQueryData(['api-key'], newKey);
      notify('success', t('apikey.notifications.generate_success'));
    },
    onError: (error: any) => {
      notify('error', t('apikey.notifications.generate_error', { error: error.message }));
    },
  });

  // Delete mutation
  const { mutate: deleteApiKey, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      await axios.delete(`${apiUrl}/auth/delete-api-key`);
    },
    onSuccess: () => {
      queryClient.setQueryData(['api-key'], null);
      notify('success', t('apikey.notifications.delete_success'));
    },
    onError: (error: any) => {
      notify('error', t('apikey.notifications.delete_error', { error: error.message }));
    },
  });

  const copyToClipboard = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      notify('info', t('apikey.notifications.copy_success'));
    }
  };

  if (isLoading) {
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
      <Typography variant="body1" sx={{ marginTop: '10px', marginBottom: '40px' }}>
        Start by creating an API key below. Then,
        <a href={`${apiUrl}/api-docs/`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', marginLeft: '5px', marginRight: '5px' }}>
          test your API
        </a>
        or read the <a href="https://docs.maxun.dev/category/api-docs" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          API documentation
        </a> for setup instructions.
      </Typography>
      <Typography
        variant="h6"
        gutterBottom
        component="div"
        style={{ marginBottom: '20px', textAlign: 'left', width: '100%' }}
      >
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
                    <IconButton onClick={() => deleteApiKey()} color="error" disabled={isDeleting}>
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
          <Button onClick={() => generateApiKey()} variant="contained" color="primary" sx={{ marginTop: '20px' }} disabled={isGenerating}>
            {t('apikey.generate_button')}
          </Button>
        </>
      )}
    </Container>
  );
};

export default ApiKeyManager;