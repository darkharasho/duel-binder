import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (dark: boolean): void => {
  document.documentElement.classList.toggle('dark', dark)
}
applyTheme(media.matches)
media.addEventListener('change', (e) => applyTheme(e.matches))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
