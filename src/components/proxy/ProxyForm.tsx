import React, { useState, useEffect } from 'react';
import {
    TextField,
    Button,
    Switch,
    FormControlLabel,
    Box,
    Typography,
    Table,
    TableContainer,
    TableHead,
    TableRow,
    TableBody,
    TableCell,
    Paper
} from '@mui/material';
import { sendProxyConfig, getProxyConfig, testProxyConfig, deleteProxyConfig } from '../../api/proxy';
import { useGlobalInfoStore } from '../../context/globalInfo';
import { useTranslation } from 'react-i18next';

const RECOMMENDED_PROXIES_STATUS_URL = 'https://docs.maxun.dev/proxy-sponsors-status.json';
const RECOMMENDED_PROXIES_URL = 'https://docs.maxun.dev/byop#recommended-proxy-providers';

const ProxyForm: React.FC = () => {
    const { t } = useTranslation();
    const [proxyConfigForm, setProxyConfigForm] = useState({
        server_url: '',
        username: '',
        password: '',
    });
    const [requiresAuth, setRequiresAuth] = useState<boolean>(false);
    const [errors, setErrors] = useState({
        server_url: '',
        username: '',
        password: '',
    });
    const [isProxyConfigured, setIsProxyConfigured] = useState(false);
    const [proxy, setProxy] = useState({ proxy_url: '', auth: false });
    const [recommendedProxiesAvailable, setRecommendedProxiesAvailable] = useState(false);

    const { notify } = useGlobalInfoStore();

    const validateForm = () => {
        let valid = true;
        let errorMessages = { server_url: '', username: '', password: '' };

        if (!proxyConfigForm.server_url) {
            errorMessages.server_url = 'Server URL is required';
            valid = false;
        }

        if (requiresAuth) {
            if (!proxyConfigForm.username) {
                errorMessages.username = 'Username is required for authenticated proxies';
                valid = false;
            }
            if (!proxyConfigForm.password) {
                errorMessages.password = 'Password is required for authenticated proxies';
                valid = false;
            }
        }

        setErrors(errorMessages);
        return valid;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setProxyConfigForm({ ...proxyConfigForm, [name]: value });
    };

    const handleAuthToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRequiresAuth(e.target.checked);
        if (!e.target.checked) {
            setProxyConfigForm({ ...proxyConfigForm, username: '', password: '' });
            setErrors({ ...errors, username: '', password: '' });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) {
            return;
        }

        try {
            const response = await sendProxyConfig(proxyConfigForm);
            if (response) {
                setIsProxyConfigured(true);
                setProxy({ proxy_url: proxyConfigForm.server_url, auth: requiresAuth });
                notify('success', t('proxy.notifications.config_success'));
                fetchProxyConfig();
            } else {
                notify('error', t('proxy.notifications.config_error'));
                console.log(`${t('proxy.notifications.config_error')} ${response}`)
            }
        } catch (error: any) {
            notify('error', `${error} : ${t('proxy.notifications.config_error')}`);
        }
    };

    const testProxy = async () => {
        await testProxyConfig().then((response) => {
            if (response.success) {
                notify('success', t('proxy.notifications.test_success'));
            } else {
                notify('error', t('proxy.notifications.test_error'));
            }
        });
    };

    const fetchProxyConfig = async () => {
        try {
            const response = await getProxyConfig();
            if (response.proxy_url) {
                setIsProxyConfigured(true);
                setProxy(response);
                notify('success', t('proxy.notifications.fetch_success'));
            }
        } catch (error: any) {
            notify('error', error);
        }
    };

    const removeProxy = async () => {
        await deleteProxyConfig().then((response) => {
            if (response) {
                notify('success', t('proxy.notifications.remove_success'));
                setIsProxyConfigured(false);
                setProxy({ proxy_url: '', auth: false });
            } else {
                notify('error', t('proxy.notifications.remove_error'));
            }
        });
    }

    const checkRecommendedProxiesAvailability = async () => {
        try {
            const response = await fetch(RECOMMENDED_PROXIES_STATUS_URL, { cache: 'no-store' });
            if (!response.ok) {
                setRecommendedProxiesAvailable(false);
                return;
            }
            const data = await response.json();
            setRecommendedProxiesAvailable(Boolean(data?.available));
        } catch (error) {
            // Offline self-hosted instance, CORS issue, status file missing, etc.
            // Fail closed — never show a link we can't confirm is live.
            setRecommendedProxiesAvailable(false);
        }
    };

    useEffect(() => {
        fetchProxyConfig();
        checkRecommendedProxiesAvailability();
    }, []);

    return (
        <Box sx={{
            display: 'flex',
            gap: 4,
            p: 5,
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box'
        }}>
            <Box sx={{
                flex: 1,
                minWidth: 0,
                maxWidth: 600
            }}>
                <Typography variant="h6" gutterBottom component="div">
                    {t('proxy.title')}
                </Typography>
                {recommendedProxiesAvailable && (
                    <>
                        <br />
                        <a
                            href={RECOMMENDED_PROXIES_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#ff00c3', textDecoration: 'none', marginLeft: '3.6px' }}
                        >
                            Check out our recommended proxy providers with discounts specific for Maxun!
                        </a>
                    </>
                )}
                {
                    isProxyConfigured ? (
                        <Box sx={{ width: '100%', mt: 3 }}>
                            <TableContainer component={Paper} sx={{ mb: 2 }}>
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell><strong>{t('proxy.table.proxy_url')}</strong></TableCell>
                                            <TableCell><strong>{t('proxy.table.requires_auth')}</strong></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        <TableRow>
                                            <TableCell>{proxy.proxy_url}</TableCell>
                                            <TableCell>{proxy.auth ? 'Yes' : 'No'}</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <Button variant="outlined" color="primary" onClick={testProxy}>
                                {t('proxy.test_proxy')}
                            </Button>
                            <Button variant="outlined" color="error" onClick={removeProxy} sx={{ ml: 1 }}>
                                {t('proxy.remove_proxy')}
                            </Button>
                        </Box>
                    ) : (
                        <Box component="form" onSubmit={handleSubmit} sx={{ width: '100%', mt: 3 }}>
                            <Box sx={{ mb: 2 }}>
                                <TextField
                                    label={t('proxy.server_url')}
                                    name="server_url"
                                    value={proxyConfigForm.server_url}
                                    onChange={handleChange}
                                    fullWidth
                                    required
                                    error={!!errors.server_url}
                                    helperText={
                                        <span style={{ display: 'block', marginLeft: '-10px', marginTop: '5px' }}>
                                            {errors.server_url || t('proxy.server_url_helper')}
                                        </span>
                                    }
                                />
                                <a
                                    href="https://docs.maxun.dev/byop#authenticated-proxies"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: '0.8rem', color: '#ff00c3', textDecoration: 'none', marginLeft: '3.6px' }}
                                >
                                    Learn how to configure authenticated proxies here.
                                </a>
                            </Box>
                            <Box sx={{ mb: 2 }}>
                                <FormControlLabel
                                    control={<Switch checked={requiresAuth} onChange={handleAuthToggle} />}
                                    label={t('proxy.requires_auth')}
                                />
                            </Box>
                            {requiresAuth && (
                                <>
                                    <Box sx={{ mb: 2 }}>
                                        <TextField
                                            label={t('proxy.username')}
                                            name="username"
                                            value={proxyConfigForm.username}
                                            onChange={handleChange}
                                            fullWidth
                                            required={requiresAuth}
                                            error={!!errors.username}
                                            helperText={errors.username || ''}
                                        />
                                    </Box>
                                    <Box sx={{ mb: 2 }}>
                                        <TextField
                                            label={t('proxy.password')}
                                            name="password"
                                            value={proxyConfigForm.password}
                                            onChange={handleChange}
                                            type="password"
                                            fullWidth
                                            required={requiresAuth}
                                            error={!!errors.password}
                                            helperText={errors.password || ''}
                                        />
                                    </Box>
                                </>
                            )}
                            <Button
                                variant="contained"
                                color="primary"
                                type="submit"
                                fullWidth
                                disabled={!proxyConfigForm.server_url || (requiresAuth && (!proxyConfigForm.username || !proxyConfigForm.password))}
                            >
                                {t('proxy.add_proxy')}
                            </Button>
                        </Box>
                    )}
            </Box>
        </Box>
    );
};


export default ProxyForm;