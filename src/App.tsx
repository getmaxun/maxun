import React from 'react';
import { Routes, Route } from 'react-router-dom';
import {  createTheme } from "@mui/material/styles";
import { GlobalInfoProvider } from "./context/globalInfo";
import { PageWrapper } from "./pages/PageWrappper";
import ThemeModeProvider from './context/theme-provider';




function App() {
  return (
    <ThemeModeProvider>
      <GlobalInfoProvider>
        <Routes>
          <Route path="/*" element={<PageWrapper />} />
        </Routes>
      </GlobalInfoProvider>
    </ThemeModeProvider>
  );
}

export default App;
