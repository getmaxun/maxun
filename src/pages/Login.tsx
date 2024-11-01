import axios from 'axios';
import { useState, useContext, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AuthContext } from '../context/auth';
import {
    Box,
    Typography,
    TextField,
    Button,
    CircularProgress,
} from '@mui/material';
import { useGlobalInfoStore } from "../context/globalInfo";
import { apiUrl } from "../apiConfig";

const Login = () => {
    const [form, setForm] = useState({
        email: '',
        password: '',
    });
    const [loading, setLoading] = useState(false);
    const { notify } = useGlobalInfoStore();
    const { email, password } = form;

    const { state, dispatch } = useContext(AuthContext);
    const { user } = state;

    const navigate = useNavigate();

    useEffect(() => {
        if (user) {
            navigate('/');
        }
    }, [user, navigate]);

    const handleChange = (e: any) => {
        const { name, value } = e.target;
        setForm({ ...form, [name]: value });
    };

    const submitForm = async (e: any) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { data } = await axios.post(`${apiUrl}/auth/login`, { email, password });
            dispatch({ type: 'LOGIN', payload: data });
            notify('success', 'Welcome to Maxun!');
            window.localStorage.setItem('user', JSON.stringify(data));
            navigate('/');
        } catch (err: any) {
            notify('error', err.response.data || 'Login Failed. Please try again.');
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                mt: 5,
            }}
        >
            <Typography variant="h4" gutterBottom>
                Welcome Back!
            </Typography>
            <Box component="form" onSubmit={submitForm} sx={{ maxWidth: 400, width: '100%' }}>
                <TextField
                    fullWidth
                    label="Email"
                    name="email"
                    value={email}
                    onChange={handleChange}
                    margin="normal"
                    variant="outlined"
                    required
                />
                <TextField
                    fullWidth
                    label="Password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={handleChange}
                    margin="normal"
                    variant="outlined"
                    required
                />

                <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    color="primary"
                    sx={{ mt: 2, mb: 2 }}
                    disabled={loading || !email || !password}
                >
                    {loading ? (
                        <>
                            <CircularProgress size={20} sx={{ mr: 2 }} />
                            Loading
                        </>
                    ) : (
                        'Login'
                    )}
                </Button>

                <Typography variant="body2" align="center">
                    Don’t have an account?{' '}
                    <Link to="/register" style={{ textDecoration: 'none'}}>
                        Register
                    </Link>
                </Typography>
            </Box>
        </Box>
    );
};

export default Login;
