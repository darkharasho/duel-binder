/**
 * Fingerprint of a phone app's native shell. A web bundle may only go to shells with the same
 * fingerprint, so it changes whenever native code, native config or a Capacitor/Capgo plugin changes.
 *
 * Run: `npx tsx scripts/live-update/fingerprint.ts <ios|android> [git-ref]` prints 64 hex characters:
 * the working tree's fingerprint, or the committed shell's at git-ref (e.g. a native/ios/<NAME+NUMBER>
 * tag, so .github/workflows/ota.yml can check that nothing native changed since that build).
 */
import { execFileSync } from 'node:child_process'
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
  return nativeFileList(platform, (dir, ext) => rel(walk(join(ROOT, dir), ext)))
}

/** The native file list, given a lister of the files under a directory that end in ext. */
function nativeFileList(
  platform: Platform,
  list: (dir: string, ext: string) => string[]
): string[] {
  const files =
    platform === 'ios'
      ? [
          ...list('ios/App/App', '.swift'),
          'ios/App/App/Info.plist',
          'ios/App/App/App.entitlements',
          'ios/App/CapApp-SPM/Package.swift',
          'capacitor.config.ts'
        ]
      : [
          ...list('android/app/src/main/java', ''),
          'android/app/src/main/AndroidManifest.xml',
          'android/app/build.gradle',
          'android/capacitor.settings.gradle',
          'capacitor.config.ts'
        ]
  return files.sort()
}

/** Resolved versions of every @capacitor/* and @capgo/* package in package-lock.json (or the given text of one). */
export function lockPackages(
  lockText: string = readFileSync(join(ROOT, 'package-lock.json'), 'utf8')
): Record<string, string> {
  const lock = JSON.parse(lockText) as {
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
  const files = nativeFiles(platform).map((path) => ({
    path,
    bytes: readFileSync(join(ROOT, path))
  }))
  return fingerprint(files, lockPackages())
}

/** Fingerprint of a platform's shell as committed at a git ref (a tag, a commit). */
export function platformFingerprintAt(platform: Platform, ref: string): string {
  const git = (args: string[]): Buffer =>
    execFileSync('git', args, {
      cwd: ROOT,
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'inherit']
    })
  const list = (dir: string, ext: string): string[] =>
    git(['ls-tree', '-r', '--name-only', '-z', ref, '--', `${dir}/`])
      .toString('utf8')
      .split('\0')
      .filter((p) => p && p.endsWith(ext))
  const files = nativeFileList(platform, list).map((path) => ({
    path,
    bytes: git(['show', `${ref}:${path}`])
  }))
  return fingerprint(
    files,
    lockPackages(git(['show', `${ref}:package-lock.json`]).toString('utf8'))
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [platform, ref] = process.argv.slice(2)
  if (platform !== 'ios' && platform !== 'android') {
    console.error('Usage: npx tsx scripts/live-update/fingerprint.ts <ios|android> [git-ref]')
    process.exit(2)
  }
  console.log(ref ? platformFingerprintAt(platform, ref) : platformFingerprint(platform))
}
