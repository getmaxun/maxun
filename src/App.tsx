import React from "react";
import { Routes, Route } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { GlobalInfoProvider } from "./context/globalInfo";
import { PageWrapper } from "./pages/PageWrappper";
import i18n from "./i18n";
import ThemeModeProvider from './context/theme-provider';


const theme = createTheme({
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

function App() {
  return (
    <ThemeModeProvider>
      <GlobalInfoProvider>
        <Routes>
          <Route path="/*" element={<PageWrapper />} />
        </Routes>
      </GlobalInfoProvider>
    </ThemeModeProvider>

<!--     <ThemeProvider theme={theme}>
      
        <GlobalInfoProvider>
          <Routes>
            <Route path="/*" element={<PageWrapper />} />
          </Routes>
        </GlobalInfoProvider>
     
    </ThemeProvider> -->
  );
}

export default App;
