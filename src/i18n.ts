import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: import.meta.env.DEV,
    supportedLngs: ['en', 'es', 'ja', 'zh', 'de', 'tr', 'ko', 'he'],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    backend: {
      loadPath: '/locales/{{lng}}.json',
    },
  });

// Keep document direction in sync with the active language (Hebrew is RTL).
const RTL_LANGUAGES = ['he'];

// Compare on the base subtag: i18next emits whatever was requested, so a
// regional code like 'he-IL' must still count as Hebrew.
export const isRtlLanguage = (lng?: string) =>
  RTL_LANGUAGES.includes(
    (lng || i18n.resolvedLanguage || i18n.language || 'en').split('-')[0]
  );

const applyDirection = (lng?: string) => {
  const lang = lng || i18n.resolvedLanguage || i18n.language || 'en';
  document.documentElement.dir = isRtlLanguage(lang) ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
};

i18n.on('languageChanged', applyDirection);
i18n.on('initialized', () => applyDirection());

export default i18n;