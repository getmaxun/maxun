import React, { useState, useEffect } from 'react';
import { styled } from '@mui/system';
import { 
    Alert, 
    AlertTitle, 
    TextField, 
    Button, 
    Switch, 
    FormControlLabel, 
    Box, 
    Typography, 
    Tabs, 
    Tab, 
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
import { useThemeMode } from '../../context/theme-provider';
import { useTranslation } from 'react-i18next';

const FormContainer = styled(Box)({
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginLeft: '30px'
});

const FormControl = styled(Box)({
    marginBottom: '16px',
});

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
    const [tabIndex, setTabIndex] = useState(0);
    const [isProxyConfigured, setIsProxyConfigured] = useState(false);
    const [proxy, setProxy] = useState({ proxy_url: '', auth: false });

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
                notify('success', t('proxy.notifications.config_success'));
            } else {
                notify('error', t('proxy.notifications.config_error'));
                console.log(`${t('proxy.notifications.config_error')} ${response}`)
            }
        } catch (error: any) {
            notify('error', `${error} : ${t('proxy.notifications.config_error')}`);
        }
    };

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
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

    useEffect(() => {
        fetchProxyConfig();
    }, []);

    const theme = useThemeMode();
    const isDarkMode = theme.darkMode;

    return (
        <>
            <FormContainer>
                <Typography variant="h6" gutterBottom component="div" style={{ marginTop: '20px' }}>
                    {t('proxy.title')}
                </Typography>
                 <Tabs value={tabIndex} onChange={handleTabChange}>
                    <Tab label={t('proxy.tab_standard')} />
                    <Tab label={t('proxy.tab_rotation')} />
                </Tabs> 

                {tabIndex === 0 && (
                    isProxyConfigured ? (
                        <Box sx={{ maxWidth: 600, width: '100%', marginTop: '5px' }}>
                            <TableContainer component={Paper} sx={{ marginBottom: '20px' }}>
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
                            <Button variant="outlined" color="error" onClick={removeProxy} sx={{ marginLeft: '10px' }}>
                                {t('proxy.remove_proxy')}
                            </Button>
                        </Box>
                    ) : (
                        <Box component="form" onSubmit={handleSubmit} sx={{ maxWidth: 400, width: '100%' }}>
                            <FormControl>
                                <TextField
                                    label={t('proxy.server_url')}
                                    name="server_url"
                                    value={proxyConfigForm.server_url}
                                    onChange={handleChange}
                                    fullWidth
                                    required
                                    error={!!errors.server_url}
                                    helperText={errors.server_url || t('proxy.server_url_helper')}
                                />
                            </FormControl>
                            <FormControl>
                                <FormControlLabel
                                    control={<Switch checked={requiresAuth} onChange={handleAuthToggle} />}
                                    label={t('proxy.requires_auth')}
                                />
                            </FormControl>
                            {requiresAuth && (
                                <>
                                    <FormControl>
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
                                    </FormControl>
                                    <FormControl>
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
                                    </FormControl>
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
                    ))}
                {tabIndex === 1 && (
                    <Box sx={{ maxWidth: 400, width: '100%', textAlign: 'center', marginTop: '20px' }}>
                        <>
                            <Typography variant="body1" gutterBottom component="div">
                                {t('proxy.coming_soon')}
                            </Typography>

                             {/* <Button variant="contained" color="primary" sx={{ marginTop: '20px',backgroundColor: '#ff00c3' }}>
                                <a style={{ color: 'white', textDecoration: 'none' }} href="https://forms.gle/hXjgqDvkEhPcaBW76">Join Maxun Cloud Waitlist</a>  */}

                            <Button variant="contained" color="primary" sx={{ marginTop: '20px' }}>
                                <a style={{ color: 'white', textDecoration: 'none' }} href="https://forms.gle/hXjgqDvkEhPcaBW76">{t('proxy.join_waitlist')}</a>

                            </Button>
                        </>
                    </Box>
                )}
            </FormContainer>

            <Alert severity="info" sx={{ marginTop: '80px', marginLeft: '50px', height: '230px', width: '600px', border: '1px solid #ff00c3' }}>
                <AlertTitle>{t('proxy.alert.title')}</AlertTitle>
                <br />
                <b>{t('proxy.alert.right_way')}</b>
                <br />
                {t('proxy.alert.proxy_url')} http://proxy.com:1337
                <br />
                {t('proxy.alert.username')} myusername
                <br />
                {t('proxy.alert.password')} mypassword
                <br />
                <br />
                <b>{t('proxy.alert.wrong_way')}</b>
                <br />

                {t('proxy.alert.proxy_url')} http://myusername:mypassword@proxy.com:1337
            </Alert>
        </>
    );
};

export default ProxyForm;