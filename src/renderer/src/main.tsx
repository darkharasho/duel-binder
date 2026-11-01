import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'

import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { installErrorReports } from '@/lib/errorReports'
import { isWeb } from '@/lib/platform'

// The scan window is this same bundle at #scan: the camera and overlays, none of the app.
// eslint-disable-next-line react-refresh/only-export-components -- an entry file, not hot-reloaded
const ScanWindowApp = lazy(() =>
  import('./features/scan/window/ScanWindowApp').then((m) => ({ default: m.ScanWindowApp }))
)

// Data a page left stays for an hour, so going back shows it at once and refetches behind it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 60 * 60_000, refetchOnWindowFocus: false }
  }
})

// The app has one dark theme; `dark` keeps shadcn's dark: variants in step with it.
document.documentElement.classList.add('dark')

installErrorReports()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {!isWeb() && location.hash === '#scan' ? (
        <Suspense fallback={null}>
          <ScanWindowApp />
        </Suspense>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>
)
