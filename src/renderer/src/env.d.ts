/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'

interface ImportMetaEnv {
  /** The portal's origin in the iOS app's build; unset elsewhere (see lib/portal.ts). */
  readonly VITE_PORTAL_ORIGIN?: string
}

declare global {
  interface Window {
    api: Api
  }
}
