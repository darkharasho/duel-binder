import './assets/main.css'
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (dark: boolean): void => {
  document.documentElement.classList.toggle('dark', dark)
}
applyTheme(media.matches)
media.addEventListener('change', (e) => applyTheme(e.matches))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
