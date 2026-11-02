/**
 * The Android app's version numbers, from package.json's version: versionName is the version
 * itself, versionCode is major*1_000_000 + minor*1_000 + patch, so it grows with every release for
 * the APK and Google Play alike (Play refuses a versionCode it has seen, and caps it at
 * 2_100_000_000).
 *
 * Run: `node scripts/android-version.ts` prints `<versionName> <versionCode>` for package.json
 * (.github/workflows/android.yml passes them to Gradle).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/

export function versionCode(version: string): number {
  const m = VERSION_RE.exec(version)
  if (!m) throw new Error(`Can't number Android version ${version}`)
  const [major, minor, patch] = m.slice(1).map(Number)
  if (minor >= 1000 || patch >= 1000 || major >= 2100)
    throw new Error(`Android version ${version} is out of range`)
  return major * 1_000_000 + minor * 1_000 + patch
}

export function versionName(version: string): string {
  versionCode(version)
  return version
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string }
  console.log(`${versionName(version)} ${versionCode(version)}`)
}
