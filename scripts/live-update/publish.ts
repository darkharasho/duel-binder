/**
 * Publishes a phone web bundle to the portal for live (over-the-air) updates.
 *
 *   npx tsx scripts/live-update/publish.ts upload <ios|android-apk|android-play> <webDir> <out.json>
 *     Hashes every file, uploads the ones the portal lacks, records the builtins entry and writes
 *     the unsigned release draft to out.json.
 *   npx tsx scripts/live-update/publish.ts release <out.json>
 *     Signs the draft and publishes the release.
 *   npx tsx scripts/live-update/publish.ts apk <version> <url>
 *     Records where the android-apk build of that version can be downloaded.
 *
 * Env: PORTAL_URL (default https://app.duelbinder.com), PORTAL_ADMIN_TOKEN, and for `release`
 * LIVE_UPDATE_SIGNING_KEY (PKCS8 PEM, ECDSA P-256).
 */
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isBundleTarget,
  signedMessage,
  type BundleTarget,
  type ManifestEntry,
  type ReleaseRecord
} from '../../src/shared/appBundles'
import { platformFingerprint, schemaVersion } from './fingerprint'

const CONCURRENCY = 4
const SKIP = 'ota-builtin-hashes.json'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const listFiles = (dir: string, prefix = ''): string[] =>
  readdirSync(join(dir, prefix)).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name
    return statSync(join(dir, rel)).isDirectory() ? listFiles(dir, rel) : [rel]
  })

/** One manifest entry per file under webDir, named by its `/`-separated relative path. */
export function buildManifest(webDir: string, origin: string): ManifestEntry[] {
  return listFiles(webDir)
    .filter((f) => f !== SKIP)
    .sort()
    .map((file_name) => {
      const file_hash = sha256(readFileSync(join(webDir, file_name)))
      return { file_name, file_hash, download_url: `${origin}/api/app-bundles/files/${file_hash}` }
    })
}

/** ECDSA P-256 SHA-256 signature, IEEE P1363 encoded, base64url. */
export function sign(message: Uint8Array, pkcs8Pem: string): string {
  return cryptoSign('sha256', message, {
    key: createPrivateKey(pkcs8Pem),
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
}

const origin = (): string => (process.env.PORTAL_URL ?? 'https://app.duelbinder.com').replace(/\/+$/, '')

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

async function call(method: string, path: string, body?: BodyInit, json = false): Promise<Response> {
  const res = await fetch(`${origin()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${need('PORTAL_ADMIN_TOKEN')}`,
      ...(json ? { 'content-type': 'application/json' } : {})
    },
    body
  })
  if (method !== 'HEAD' && !res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  return res
}

const adminPath = (target: BundleTarget, rest: string): string => `/api/admin/app-bundles/${target}/${rest}`

async function inBatches<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
}

const appVersion = (): string =>
  (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string })
    .version

async function upload(target: BundleTarget, webDir: string, outFile: string): Promise<void> {
  const manifest = buildManifest(webDir, origin())
  const version = appVersion()
  const fingerprint = platformFingerprint(target === 'ios' ? 'ios' : 'android')
  const schema = schemaVersion()
  let uploaded = 0
  await inBatches(manifest, async (m) => {
    const head = await call('HEAD', `/api/app-bundles/files/${m.file_hash}`)
    if (head.ok) return
    await call('PUT', `/api/admin/app-bundles/files/${m.file_hash}`, readFileSync(join(webDir, m.file_name)))
    uploaded++
  })
  await call('PUT', adminPath(target, `builtins/${version}`), JSON.stringify({ fingerprint, schema }), true)
  const draft: Omit<ReleaseRecord, 'signature' | 'createdAt'> = {
    target,
    version,
    fingerprint,
    schema,
    manifest
  }
  writeFileSync(outFile, JSON.stringify(draft, null, 2))
  console.log(`${target} ${version}: ${manifest.length} files, ${uploaded} uploaded, schema ${schema}`)
}

async function release(draftFile: string): Promise<void> {
  const draft = JSON.parse(readFileSync(draftFile, 'utf8')) as Omit<ReleaseRecord, 'signature' | 'createdAt'>
  if (!isBundleTarget(draft.target)) throw new Error(`Bad target in ${draftFile}`)
  const signature = sign(
    signedMessage(draft.target, draft.version, draft.manifest),
    need('LIVE_UPDATE_SIGNING_KEY')
  )
  const record: ReleaseRecord = { ...draft, signature, createdAt: new Date().toISOString() }
  await call('PUT', adminPath(draft.target, `releases/${draft.version}`), JSON.stringify(record), true)
  console.log(`Released ${draft.target} ${draft.version}`)
}

async function apk(version: string, url: string): Promise<void> {
  await call('POST', adminPath('android-apk', `releases/${version}/apk`), JSON.stringify({ url }), true)
  console.log(`Recorded APK url for ${version}`)
}

async function main(args: string[]): Promise<void> {
  const [cmd, a, b, c] = args
  if (cmd === 'upload' && isBundleTarget(a) && b && c) return upload(a, b, c)
  if (cmd === 'release' && a) return release(a)
  if (cmd === 'apk' && a && b) return apk(a, b)
  console.error(
    'Usage: npx tsx scripts/live-update/publish.ts upload <target> <webDir> <out.json>\n' +
      '       npx tsx scripts/live-update/publish.ts release <out.json>\n' +
      '       npx tsx scripts/live-update/publish.ts apk <version> <url>'
  )
  process.exit(2)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
