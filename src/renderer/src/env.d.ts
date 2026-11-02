/// <reference types="vite/client" />
import type { Api } from '@shared/ipc'

interface ImportMetaEnv {
  /** The portal's origin in the iOS and Android apps' builds; unset elsewhere (see lib/portal.ts). */
  readonly VITE_PORTAL_ORIGIN?: string
  /** 'ios' or 'android' in the apps' builds; unset elsewhere. */
  readonly VITE_APP_PLATFORM?: string
  /** 'play' in the Google Play build of the Android app; unset elsewhere. */
  readonly VITE_ANDROID_CHANNEL?: string
}

declare global {
  interface Window {
    api: Api
  }
}
