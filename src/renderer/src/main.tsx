import './assets/main.css'
import './i18n' // initialize i18next before any component calls useTranslation

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { queryClient } from './queries/queryClient'
import {
  buildCacheBuster,
  createQueryCachePersister,
  MAX_QUERY_AGE_MS,
  shouldDehydrateQuery
} from './queries/cache'

const persister = createQueryCachePersister()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: buildCacheBuster(),
        maxAge: MAX_QUERY_AGE_MS,
        dehydrateOptions: { shouldDehydrateQuery }
      }}
    >
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PersistQueryClientProvider>
  </StrictMode>
)
