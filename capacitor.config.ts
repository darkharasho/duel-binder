import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The iOS app: the phone app's `--mode ios` build (vite.phone.config.ts) inside a native shell.
 * Build it with `npm run build:ios`, then open ios/App in Xcode or let .github/workflows/ios.yml
 * archive it.
 */
const config: CapacitorConfig = {
  appId: 'com.darkharasho.duelbinder',
  appName: 'Duel Binder',
  webDir: 'out/ios-web',
  backgroundColor: '#111113',
  ios: {
    // The page lays itself out under the status bar and home indicator (viewport-fit=cover).
    contentInset: 'never',
    scheme: 'capacitor'
  }
}

export default config
