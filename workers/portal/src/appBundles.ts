import {
  isBundleTarget,
  pickRelease,
  pickShellUpdate,
  type AppUpdateAnswer,
  type BundleTarget,
  type IndexEntry,
  type ReleaseRecord
} from '../../../src/shared/appBundles'
import type { SnapshotBucket } from './catalogSnapshot'
import { adminAuthorized } from './thumbs'

/** The parts of R2 the live update routes use. */
export type AppBundleBucket = Pick<SnapshotBucket, 'get' | 'head' | 'put'>

const ROOT = 'app-bundles/'
const VERSION_RE = /^\d+\.\d+\.\d+$/
const HASH_RE = /^[0-9a-f]{64}$/
const UPDATE_PATH = '/api/app-update'
const FILES_PREFIX = '/api/app-bundles/files/'
const ADMIN_PREFIX = '/api/admin/app-bundles/'

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra }
  })

const fileKey = (hash: string): string => `${ROOT}files/${hash}`
const indexKey = (t: BundleTarget): string => `${ROOT}${t}/index.json`
const releaseKey = (t: BundleTarget, v: string): string => `${ROOT}${t}/releases/${v}.json`
const builtinKey = (t: BundleTarget, v: string): string => `${ROOT}${t}/builtins/${v}.json`

async function readJson<T>(bucket: AppBundleBucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key)
  if (!obj) return null
  try {
    return JSON.parse(await new Response(obj.body).text()) as T
  } catch {
    return null
  }
}

const readIndex = async (b: AppBundleBucket, t: BundleTarget): Promise<IndexEntry[]> =>
  (await readJson<IndexEntry[]>(b, indexKey(t))) ?? []

const entryOf = (r: ReleaseRecord): IndexEntry => ({
  version: r.version,
  fingerprint: r.fingerprint,
  schema: r.schema,
  ...(r.withdrawn ? { withdrawn: true as const } : {}),
  ...(r.apkUrl ? { apkUrl: r.apkUrl } : {})
})

async function writeRecord(b: AppBundleBucket, r: ReleaseRecord): Promise<void> {
  await b.put(releaseKey(r.target, r.version), JSON.stringify(r))
  const index = (await readIndex(b, r.target)).filter((x) => x.version !== r.version)
  index.push(entryOf(r))
  await b.put(indexKey(r.target), JSON.stringify(index))
}

async function appUpdate(
  req: Request,
  bucket: AppBundleBucket,
  cache: Cache | null
): Promise<Response> {
  const url = new URL(req.url)
  const target = url.searchParams.get('target')
  const builtin = url.searchParams.get('builtin') ?? ''
  const current = url.searchParams.get('current') ?? ''
  if (!isBundleTarget(target) || !VERSION_RE.test(builtin) || !VERSION_RE.test(current))
    return json({ error: 'bad-query' }, 400)

  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const hit = await cache?.match(cacheKey)
  if (hit) return hit

  const answer = await buildAnswer(bucket, target, builtin, current)
  const res = json(answer, 200, { 'cache-control': 'public, max-age=60' })
  await cache?.put(cacheKey, res.clone())
  return res
}

async function buildAnswer(
  bucket: AppBundleBucket,
  target: BundleTarget,
  builtin: string,
  current: string
): Promise<AppUpdateAnswer> {
  const built = await readJson<{ fingerprint: string; schema: number }>(
    bucket,
    builtinKey(target, builtin)
  )
  if (!built) return { version: null }
  const index = await readIndex(bucket, target)
  const shell =
    target === 'android-apk'
      ? pickShellUpdate(index, { fingerprint: built.fingerprint, builtin })
      : null
  const picked = pickRelease(index, { fingerprint: built.fingerprint, current })
  const record = picked
    ? await readJson<ReleaseRecord>(bucket, releaseKey(target, picked.version))
    : null
  const extra = shell ? { shellUpdate: shell } : {}
  if (!record) return { version: null, ...extra }
  return {
    version: record.version,
    manifest: record.manifest,
    signature: record.signature,
    ...extra
  }
}

async function serveFile(req: Request, bucket: AppBundleBucket, hash: string): Promise<Response> {
  if (!HASH_RE.test(hash)) return new Response('not found', { status: 404 })
  if (req.method === 'HEAD') {
    const h = await bucket.head(fileKey(hash))
    return new Response(null, { status: h ? 200 : 404 })
  }
  const obj = await bucket.get(fileKey(hash))
  if (!obj) return new Response('not found', { status: 404 })
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable'
    }
  })
}

const hex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

async function putFile(req: Request, bucket: AppBundleBucket, hash: string): Promise<Response> {
  if (!HASH_RE.test(hash)) return json({ error: 'bad-hash' }, 400)
  const body = await req.arrayBuffer()
  if (hex(await crypto.subtle.digest('SHA-256', body)) !== hash)
    return json({ error: 'hash-mismatch' }, 400)
  await bucket.put(fileKey(hash), body)
  return json({ ok: true })
}

async function putRelease(
  req: Request,
  bucket: AppBundleBucket,
  target: BundleTarget,
  version: string
): Promise<Response> {
  let r: ReleaseRecord
  try {
    r = (await req.json()) as ReleaseRecord
  } catch {
    return json({ error: 'bad-body' }, 400)
  }
  if (!r || r.target !== target || r.version !== version) return json({ error: 'mismatch' }, 400)
  if (
    typeof r.fingerprint !== 'string' ||
    typeof r.schema !== 'number' ||
    typeof r.signature !== 'string' ||
    !Array.isArray(r.manifest)
  )
    return json({ error: 'bad-body' }, 400)
  for (const m of r.manifest) {
    if (!m || !HASH_RE.test(m.file_hash)) return json({ error: 'bad-body' }, 400)
    if (!(await bucket.head(fileKey(m.file_hash)))) return json({ error: 'file-missing' }, 400)
  }
  const prior = await readJson<ReleaseRecord>(bucket, releaseKey(target, version))
  delete r.withdrawn
  delete r.apkUrl
  if (prior?.withdrawn) r.withdrawn = true
  if (prior?.apkUrl) r.apkUrl = prior.apkUrl
  await writeRecord(bucket, r)
  if (!(await bucket.head(builtinKey(target, version))))
    await bucket.put(
      builtinKey(target, version),
      JSON.stringify({ fingerprint: r.fingerprint, schema: r.schema })
    )
  return json({ ok: true })
}

async function patchRecord(
  bucket: AppBundleBucket,
  target: BundleTarget,
  version: string,
  change: (r: ReleaseRecord) => void
): Promise<Response> {
  const r = await readJson<ReleaseRecord>(bucket, releaseKey(target, version))
  if (!r) return json({ error: 'not-found' }, 404)
  change(r)
  await writeRecord(bucket, r)
  return json({ ok: true })
}

async function admin(req: Request, bucket: AppBundleBucket, rest: string): Promise<Response> {
  const parts = rest.split('/')
  if (parts[0] === 'files' && parts.length === 2 && req.method === 'PUT')
    return putFile(req, bucket, parts[1])
  const [target, kind, version, action] = parts
  if (!isBundleTarget(target) || !VERSION_RE.test(version ?? ''))
    return json({ error: 'not-found' }, 404)
  if (kind === 'builtins' && parts.length === 3) {
    if (req.method === 'GET') {
      const b = await readJson<{ fingerprint: string; schema: number }>(
        bucket,
        builtinKey(target, version)
      )
      return b ? json(b) : json({ error: 'not-found' }, 404)
    }
    if (req.method === 'PUT') {
      let b: { fingerprint?: unknown; schema?: unknown }
      try {
        b = await req.json()
      } catch {
        return json({ error: 'bad-body' }, 400)
      }
      if (typeof b?.fingerprint !== 'string' || typeof b.schema !== 'number')
        return json({ error: 'bad-body' }, 400)
      await bucket.put(
        builtinKey(target, version),
        JSON.stringify({ fingerprint: b.fingerprint, schema: b.schema })
      )
      return json({ ok: true })
    }
  }
  if (kind !== 'releases') return json({ error: 'not-found' }, 404)
  if (parts.length === 3 && req.method === 'PUT') return putRelease(req, bucket, target, version)
  if (parts.length === 4 && req.method === 'POST') {
    if (action === 'withdraw')
      return patchRecord(bucket, target, version, (r) => {
        r.withdrawn = true
      })
    if (action === 'restore')
      return patchRecord(bucket, target, version, (r) => {
        delete r.withdrawn
      })
    if (action === 'apk' && target === 'android-apk') {
      let b: { url?: unknown }
      try {
        b = await req.json()
      } catch {
        return json({ error: 'bad-body' }, 400)
      }
      const apkUrl = b?.url
      if (typeof apkUrl !== 'string' || !apkUrl) return json({ error: 'bad-body' }, 400)
      return patchRecord(bucket, target, version, (r) => {
        r.apkUrl = apkUrl
      })
    }
  }
  return json({ error: 'not-found' }, 404)
}

/** Live update routes: the update answer, the bundle files, and the admin routes CI publishes with. Null for other paths. */
export async function appBundlesRoute(
  req: Request,
  bucket: AppBundleBucket,
  adminToken: string | undefined,
  cache: Cache | null,
  _now: () => number = Date.now
): Promise<Response | null> {
  const path = new URL(req.url).pathname
  if (path === UPDATE_PATH && req.method === 'GET') return appUpdate(req, bucket, cache)
  if (path.startsWith(FILES_PREFIX) && (req.method === 'GET' || req.method === 'HEAD'))
    return serveFile(req, bucket, path.slice(FILES_PREFIX.length))
  if (path.startsWith(ADMIN_PREFIX)) {
    if (!(await adminAuthorized(req, adminToken))) return json({ error: 'unauthorized' }, 401)
    return admin(req, bucket, path.slice(ADMIN_PREFIX.length))
  }
  return null
}
