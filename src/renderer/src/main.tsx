import './assets/main.css'
import './i18n' // initialize i18next before any component calls useTranslation

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import App from './App'
import AppBackdrop from './components/AppBackdrop'
import ErrorBoundary from './components/ErrorBoundary'
import { queryClient } from './queries/queryClient'
import { buildPersistOptions, onPersistRestore, persistQueryCacheOnPageHide } from './queries/cache'
import { installDocumentDropGuard } from './installDocumentDropGuard'

installDocumentDropGuard(document)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={buildPersistOptions()}
      onSuccess={() => {
        // Armed only once the saved roster is back in memory (see the helper).
        persistQueryCacheOnPageHide(queryClient)
        onPersistRestore(queryClient)
      }}
      onError={() => persistQueryCacheOnPageHide(queryClient)}
    >
      <ErrorBoundary>
        <AppBackdrop />
        <App />
      </ErrorBoundary>
    </PersistQueryClientProvider>
  </StrictMode>
)
