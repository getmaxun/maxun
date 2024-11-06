import React, { createContext, useContext, useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1e88e5',
    },
    background: {
      default: '#ffffff',
      paper: '#f5f5f5',
    },
    text: {
      primary: '#000000',
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    background: {
      default: '#121212',
      paper: '#1e2124',
    },
    text: {
      primary: '#ffffff',
    },
  },
});

// Create context for theme mode with state for current mode
// In theme-provider.tsx

const ThemeModeContext = createContext({
  toggleTheme: () => {},
  darkMode: false, // Add darkMode to context
});

export const useThemeMode = () => useContext(ThemeModeContext);

const ThemeModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [darkMode, setDarkMode] = useState(false);

  const toggleTheme = () => {
    setDarkMode((prevMode) => !prevMode);
  };

  return (
    <ThemeModeContext.Provider value={{ toggleTheme, darkMode }}> {/* Pass darkMode here */}
      <ThemeProvider theme={darkMode ? darkTheme : lightTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export default ThemeModeProvider;
