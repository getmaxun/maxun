import { useReducer, createContext, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from "../apiConfig";

interface AuthProviderProps {
    children: React.ReactNode;
}

interface ActionType {
    type: 'LOGIN' | 'LOGOUT';
    payload?: any;
}

type InitialStateType = {
    user: any;
    lastActivityTime?: number;
};

const initialState = {
    user: null,
    lastActivityTime: Date.now(),
};

const AUTO_LOGOUT_TIME = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

const AuthContext = createContext<{
    state: InitialStateType;
    dispatch: React.Dispatch<ActionType>;
}>({
    state: initialState,
    dispatch: () => null,
});

const reducer = (state: InitialStateType, action: ActionType) => {
    switch (action.type) {
        case 'LOGIN':
            return {
                ...state,
                user: action.payload,
                lastActivityTime: Date.now(),
            };
        case 'LOGOUT':
            return {
                ...state,
                user: null,
                lastActivityTime: undefined,
            };
        default:
            return state;
    }
};

const AuthProvider = ({ children }: AuthProviderProps) => {
    const [state, dispatch] = useReducer(reducer, initialState);
    const navigate = useNavigate();
    axios.defaults.withCredentials = true;

    const handleLogout = useCallback(async () => {
        try {
            await axios.get(`${apiUrl}/auth/logout`);
            dispatch({ type: 'LOGOUT' });
            window.localStorage.removeItem('user');
            navigate('/login');
        } catch (err) {
            console.error('Logout error:', err);
        }
    }, [navigate]);

    const checkAutoLogout = useCallback(() => {
        if (state.user && state.lastActivityTime) {
            const currentTime = Date.now();
            const timeSinceLastActivity = currentTime - state.lastActivityTime;
            
            if (timeSinceLastActivity >= AUTO_LOGOUT_TIME) {
                handleLogout();
            }
        }
    }, [state.user, state.lastActivityTime, handleLogout]);

    // Update last activity time on user interactions
    const updateActivityTime = useCallback(() => {
        if (state.user) {
            dispatch({
                type: 'LOGIN',
                payload: state.user // Reuse existing user data
            });
        }
    }, [state.user]);

    // Initialize user from localStorage
    useEffect(() => {
        const storedUser = window.localStorage.getItem('user');
        if (storedUser) {
            dispatch({ type: 'LOGIN', payload: JSON.parse(storedUser) });
        }
    }, []);

    // Set up activity listeners
    useEffect(() => {
        if (state.user) {
            // List of events to track for user activity
            const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
            
            // Throttled event handler
            let timeoutId: NodeJS.Timeout;
            const handleActivity = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(updateActivityTime, 1000);
            };

            // Add event listeners
            events.forEach(event => {
                window.addEventListener(event, handleActivity);
            });

            // Set up periodic check for auto logout
            const checkInterval = setInterval(checkAutoLogout, 60000); // Check every minute

            // Cleanup
            return () => {
                events.forEach(event => {
                    window.removeEventListener(event, handleActivity);
                });
                clearInterval(checkInterval);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            };
        }
    }, [state.user, updateActivityTime, checkAutoLogout]);

    axios.interceptors.response.use(
        function (response) {
            return response;
        },
        function (error) {
            const res = error.response;
            if (res?.status === 401 && res.config && !res.config.__isRetryRequest) {
                return new Promise((_, reject) => {
                    handleLogout()
                        .then(() => {
                            console.log('/401 error > logout');
                            reject(error);
                        })
                        .catch((err) => {
                            console.error('AXIOS INTERCEPTORS ERROR:', err);
                            reject(error);
                        });
                });
            }
            return Promise.reject(error);
        }
    );
    
    return (
        <AuthContext.Provider value={{ state, dispatch }}>
            {children}
        </AuthContext.Provider>
    );
};

export { AuthContext, AuthProvider };
