/**
 * Fingerprint of a phone app's native shell. A web bundle may only go to shells with the same
 * fingerprint, so it changes whenever native code, native config or a Capacitor/Capgo plugin changes.
 *
 * Run: `npx tsx scripts/live-update/fingerprint.ts <ios|android>` prints 64 hex characters.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIGRATIONS } from '../../src/main/db/schema'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

type Platform = 'ios' | 'android'

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (name.endsWith(ext)) out.push(p)
  }
  return out
}

/** The native files that make up a platform's shell, as repo-relative paths, sorted. */
export function nativeFiles(platform: Platform): string[] {
  const rel = (abs: string[]): string[] => abs.map((p) => relative(ROOT, p).split('\\').join('/'))
  const files =
    platform === 'ios'
      ? [
          ...rel(walk(join(ROOT, 'ios/App/App'), '.swift')),
          'ios/App/App/Info.plist',
          'ios/App/App/App.entitlements',
          'ios/App/CapApp-SPM/Package.swift',
          'capacitor.config.ts'
        ]
      : [
          ...rel(walk(join(ROOT, 'android/app/src/main/java'), '')),
          'android/app/src/main/AndroidManifest.xml',
          'android/app/build.gradle',
          'android/capacitor.settings.gradle',
          'capacitor.config.ts'
        ]
  return files.sort()
}

/** Resolved versions of every @capacitor/* and @capgo/* package in package-lock.json. */
export function lockPackages(): Record<string, string> {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>
  }
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(lock.packages)) {
    const m = /(?:^|\/)node_modules\/((?:@capacitor|@capgo)\/[^/]+)$/.exec(key)
    if (m && v.version) out[key] = v.version
  }
  return out
}

/** SHA-256 over the files (sorted by path: path, NUL, bytes) and the plugin versions. */
export function fingerprint(
  files: { path: string; bytes: Uint8Array }[],
  lockPackages: Record<string, string>
): string {
  const h = createHash('sha256')
  const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  for (const f of [...files].sort((a, b) => byPath(a.path, b.path))) {
    h.update(f.path)
    h.update('\0')
    h.update(f.bytes)
  }
  h.update('\0packages\0')
  for (const k of Object.keys(lockPackages).sort(byPath)) h.update(`${k}@${lockPackages[k]}\n`)
  return h.digest('hex')
}

/** The newest data schema version this build's migrations reach. */
export function schemaVersion(): number {
  return MIGRATIONS.at(-1)!.version
}

/** Fingerprint of a platform's shell as it is in the working tree. */
export function platformFingerprint(platform: Platform): string {
  const files = nativeFiles(platform).map((path) => ({ path, bytes: readFileSync(join(ROOT, path)) }))
  return fingerprint(files, lockPackages())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2]
  if (platform !== 'ios' && platform !== 'android') {
    console.error('Usage: npx tsx scripts/live-update/fingerprint.ts <ios|android>')
    process.exit(2)
  }
  console.log(platformFingerprint(platform))
}
