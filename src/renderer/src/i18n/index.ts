/**
 * i18next setup (VRX-14)
 *
 * Wires i18next + react-i18next for the renderer. Translation resources are
 * bundled (imported JSON), so they resolve synchronously — no async backend and
 * therefore no React Suspense to manage. The initial language comes from the OS
 * via the renderer's only available signal, `navigator.language` (Electron sets it
 * from the OS locale); anything unsupported falls back to English. When the IPC
 * layer lands (VRX-18/20), this can move to the main process's `app.getLocale()`
 * for a more authoritative locale.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/translation.json'
import ja from '../locales/ja/translation.json'

// `navigator` is absent under the node test env — default to English there.
const osLanguage = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'en'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja }
  },
  lng: osLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false // React already escapes interpolated values against XSS
  }
})

export default i18n
