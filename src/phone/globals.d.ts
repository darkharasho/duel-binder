export {}

declare global {
  /** The app's version from package.json, set by the phone build's `define`. */
  const __APP_VERSION__: string
}
