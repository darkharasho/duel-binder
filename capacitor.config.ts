import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The iOS and Android apps: the phone app's `--mode ios` / `--mode android` build
 * (vite.phone.config.ts) inside a native shell. Build with `npm run build:ios` (then Xcode or
 * .github/workflows/ios.yml) or `npm run build:android` (then Gradle in android/ or
 * .github/workflows/android.yml). Capacitor takes one webDir, so the Android build sets
 * CAP_PLATFORM=android to pick its own.
 */
const config: CapacitorConfig = {
  appId: 'com.darkharasho.duelbinder',
  appName: 'Duel Binder',
  webDir: process.env.CAP_PLATFORM === 'android' ? 'out/android-web' : 'out/ios-web',
  backgroundColor: '#111113',
  android: {
    backgroundColor: '#111113'
  },
  plugins: {
    // Android: light status and gesture bar icons on the dark app. With a WebView that passes the
    // insets through, the page lays itself out with env(safe-area-inset-*) as on iOS; with an older
    // one, Capacitor pads the window instead and the dark window background shows behind the bars.
    SystemBars: { style: 'DARK', insetsHandling: 'css' }
  },
  ios: {
    // The page lays itself out under the status bar and home indicator (viewport-fit=cover).
    contentInset: 'never',
    scheme: 'capacitor'
  }
}

export default config
