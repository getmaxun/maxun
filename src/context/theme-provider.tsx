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
      main: "#ff00c3",
      contrastText: "#ffffff",
    },
    error: {
      main: '#f44336',
      light: '#e57373',
      dark: '#d32f2f',
      contrastText: '#ffffff',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
    text: {
      primary: '#ffffff',
      secondary: '#b3b3b3',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          color: '#ffffff',
          '&.MuiButton-outlined': {
            borderColor: '#ffffff',
            color: '#ffffff',
            "&:hover": {
              borderColor: '#ffffff',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
            },
          },
        },
        containedPrimary: {
          "&:hover": {
            backgroundColor: "#ff66d9",
          },
        },
        outlined: {
          // Dark mode outlined buttons
          backgroundColor: '#1e1e1e',
          borderColor: '#ff00c3',
          color: '#ff00c3',
          "&:hover": {
            backgroundColor: 'rgba(255, 0, 195, 0.08)',
            borderColor: '#ff66d9',
          },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          color: '#ff66d9',
          "&:hover": {
            color: "#ff00c3",
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: '#ffffff',
          "&:hover": {
            backgroundColor: 'rgba(255, 0, 195, 0.08)',
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          color: '#ffffff',
          "&.Mui-selected": {
            color: '#ff00c3',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardInfo: {
          backgroundColor: "rgba(255, 0, 195, 0.15)",
          color: "#ff66d9",
          "& .MuiAlert-icon": {
            color: "#ff66d9",
          },
        },
      },
    },
    MuiAlertTitle: {
      styleOverrides: {
        root: {
          "& .MuiAlert-icon": {
            color: "#ff66d9",
          },
        },
      },
    },
    // Additional dark mode specific components
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: '#1e1e1e',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#121212',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#121212',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(255, 255, 255, 0.12)',
        },
      },
    },
  },
});

const ThemeModeContext = createContext({
  toggleTheme: () => { },
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
