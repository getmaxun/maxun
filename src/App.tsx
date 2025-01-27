import React from "react";
import { Routes, Route } from "react-router-dom";
import { GlobalInfoProvider } from "./context/globalInfo";
import { PageWrapper } from "./pages/PageWrapper";
import i18n from "./i18n";
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
