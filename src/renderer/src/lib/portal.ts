/**
 * The portal's address for calls and images. Empty in the builds the portal serves itself (the web
 * and phone pages at app.duelbinder.com use relative paths); the iOS app's build sets it, since its
 * pages load from capacitor://localhost (see vite.phone.config.ts).
 */
export const PORTAL_ORIGIN: string = import.meta.env.VITE_PORTAL_ORIGIN ?? ''

/** True in the iOS app, whose pages aren't on the portal. */
export const isNativeApp = (): boolean => PORTAL_ORIGIN !== ''
