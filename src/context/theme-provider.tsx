import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const lightTheme = createTheme({
  palette: {
    primary: {
      main: "#ff00c3",
      contrastText: "#ffffff",
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          // Default styles for all buttons (optional)
          textTransform: "none",
        },
        containedPrimary: {
          // Styles for 'contained' variant with 'primary' color
          "&:hover": {
            backgroundColor: "#ff66d9",
          },
        },
        outlined: {
          // Apply white background for all 'outlined' variant buttons
          backgroundColor: "#ffffff",
          "&:hover": {
            backgroundColor: "#f0f0f0", // Optional lighter background on hover
          },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          "&:hover": {
            color: "#ff00c3",
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          // '&:hover': {
          //   color: "#ff66d9",
          // },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardInfo: {
          backgroundColor: "#fce1f4",
          color: "#ff00c3",
          "& .MuiAlert-icon": {
            color: "#ff00c3",
          },
        },
      },
    },
    MuiAlertTitle: {
      styleOverrides: {
        root: {
          "& .MuiAlert-icon": {
            color: "#ffffff",
          },
        },
      },
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ff00c3', // Pink as the primary color
    },
    background: {
      default: '#121212',
      paper: '#1e2124',
    },
    text: {
      primary: '#ffffff',
    },
  },
  components: {
    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: '#ff00c3', // Pink for tab indicators
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          backgroundColor: '#ff00c3', // Pink button background
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#e600b3', // Slightly darker pink on hover
          },
        },
      },
    },
  },
});

const ThemeModeContext = createContext({
  toggleTheme: () => {},
  darkMode: false,
});

export const useThemeMode = () => useContext(ThemeModeContext);

const ThemeModeProvider = ({ children }: { children: React.ReactNode }) => {
  // Load saved mode from localStorage or default to light mode
  const [darkMode, setDarkMode] = useState(() => {
    const savedMode = localStorage.getItem('darkMode');
    return savedMode ? JSON.parse(savedMode) : false;
  });

  const toggleTheme = () => {
    setDarkMode((prevMode: any) => {
      const newMode = !prevMode;
      localStorage.setItem('darkMode', JSON.stringify(newMode)); // Save new mode to localStorage
      return newMode;
    });
  };

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode)); // Save initial mode
  }, [darkMode]);

  return (
    <ThemeModeContext.Provider value={{ toggleTheme, darkMode }}>
      <ThemeProvider theme={darkMode ? darkTheme : lightTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export default ThemeModeProvider;
