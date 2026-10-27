/** `window.api` can be absent (e.g. art rendered before the preload bridge exists), so read it defensively. */
const platform = (): string | undefined => window.api?.window.platform

/**
 * True in the browser builds at app.duelbinder.com: the web app (platform `'web'`) and the phone
 * app (`'phone'`), so pages take their web paths and images come from the Worker's `/img/`.
 */
export const isWeb = (): boolean => platform() === 'web' || platform() === 'phone'

/** True only in the phone app at app.duelbinder.com/scan/. */
export const isPhone = (): boolean => platform() === 'phone'

/** True on macOS; on the web, judged from the browser's user agent. */
export const isMac = (): boolean =>
  isWeb() ? /Mac|iPhone|iPad/.test(navigator.userAgent) : platform() === 'darwin'
