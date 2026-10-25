/** `window.api` can be absent (e.g. art rendered before the preload bridge exists), so read it defensively. */
const platform = (): string | undefined => window.api?.window.platform

/** True in the web build at app.duelbinder.com, where the platform is reported as `'web'`. */
export const isWeb = (): boolean => platform() === 'web'

/** True on macOS; on the web, judged from the browser's user agent. */
export const isMac = (): boolean =>
  isWeb() ? /Mac|iPhone|iPad/.test(navigator.userAgent) : platform() === 'darwin'
