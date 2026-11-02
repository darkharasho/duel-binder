import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './phone.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_PLATFORM, isNativeApp } from '@/lib/portal'
import { installErrorReports } from '@/lib/errorReports'
import { trackOpen } from '@/lib/usage'
import { App } from './App'
import { listenForBack } from './backButton'
import { createBrowserOcr } from './ocr'
import { createPhoneRuntime, type WorkerLike } from './runtime'

/** The data worker; in dev, `?demo` swaps in the sample-data store (stripped from production). */
async function dataWorker(): Promise<WorkerLike> {
  // Its own block: the production build drops it, the dynamic import and the demo chunk with it.
  if (import.meta.env.DEV) {
    if (new URLSearchParams(location.search).has('demo'))
      return (await import('./demo')).demoWorker()
  }
  return new Worker(new URL('./data/worker.ts', import.meta.url), { type: 'module' })
}

async function start(): Promise<void> {
  const runtime = createPhoneRuntime({
    worker: await dataWorker(),
    ocr: createBrowserOcr(import.meta.env.BASE_URL)
  })
  window.api = runtime.api
  installErrorReports()
  trackOpen()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={runtime.store} onFatal={runtime.onFatal} />
    </StrictMode>
  )
}

void start()

// Android's back button closes what's open, then goes Home, then leaves (see backButton.ts).
if (APP_PLATFORM === 'android') void listenForBack()

// The page, the service worker and every app file are under /scan/ (see vite.phone.config.ts).
// The iOS and Android apps ship their files inside the app and have no service worker.
if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator)
  navigator.serviceWorker.register('/scan/sw.js', { scope: '/scan/' }).catch((err: unknown) => {
    console.warn('Service worker registration failed:', err)
  })
