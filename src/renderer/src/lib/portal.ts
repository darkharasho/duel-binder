/**
 * The portal's address for calls and images. Empty in the builds the portal serves itself (the web
 * and phone pages at app.duelbinder.com use relative paths); the iOS and Android apps' builds set
 * it, since their pages load from the app itself (see vite.phone.config.ts).
 */
export const PORTAL_ORIGIN: string = import.meta.env.VITE_PORTAL_ORIGIN ?? ''

/** Where this build runs: a page the portal serves, or the iOS or Android app. */
export type AppPlatform = 'web' | 'ios' | 'android'
export const APP_PLATFORM: AppPlatform =
  (import.meta.env.VITE_APP_PLATFORM as AppPlatform | undefined) ?? 'web'

/** How the Android app was installed: the APK from GitHub releases, or Google Play. */
export const ANDROID_CHANNEL: 'apk' | 'play' =
  import.meta.env.VITE_ANDROID_CHANNEL === 'play' ? 'play' : 'apk'

/** True in the iOS and Android apps, whose pages aren't on the portal. */
export const isNativeApp = (): boolean => PORTAL_ORIGIN !== ''
