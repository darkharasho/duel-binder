import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import {
  catalogSnapshotRoute,
  signSnapshotUrl,
  type SnapshotBucket
} from '../../workers/portal/src/catalogSnapshot'
import {
  catalogShape,
  snapshotFileKey,
  snapshotManifestKey,
  type SnapshotManifest,
  type SnapshotOffer
} from '../../src/shared/catalogSnapshot'
import { addUser, seededServerDb } from './helpers'

const ORIGIN = 'https://app.duelbinder.com'
const ADMIN = 'admin-secret'
const NOW = new Date('2026-11-15T12:00:00.000Z')
const DAY = 86_400_000
const sha256Hex = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex')

/** An in-memory R2 stand-in with ranges, multipart uploads, head, list and delete. */
function snapBucket(): SnapshotBucket & {
  store: Map<string, { bytes: Uint8Array; uploaded: Date }>
} {
  const store = new Map<string, { bytes: Uint8Array; uploaded: Date }>()
  const uploads = new Map<string, Map<number, Uint8Array>>()
  let next = 0
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.byteLength
    }
    return out
  }
  const multipart = (key: string, uploadId: string) => ({
    uploadId,
    async uploadPart(n: number, body: ReadableStream | ArrayBuffer | Uint8Array) {
      const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer())
      uploads.get(uploadId)!.set(n, bytes)
      return { partNumber: n, etag: `e${n}-${bytes.byteLength}` }
    },
    async complete(parts: { partNumber: number; etag: string }[]) {
      const held = uploads.get(uploadId)!
      store.set(key, {
        bytes: concat(parts.map((p) => held.get(p.partNumber)!)),
        uploaded: NOW
      })
      uploads.delete(uploadId)
      return {}
    }
  })
  return {
    store,
    async get(key, opts) {
      const o = store.get(key)
      if (!o) return null
      const start = opts?.range?.offset ?? 0
      const end = opts?.range?.length !== undefined ? start + opts.range.length : o.bytes.byteLength
      return { body: new Response(o.bytes.slice(start, end)).body!, size: o.bytes.byteLength }
    },
    async head(key) {
      const o = store.get(key)
      return o ? { size: o.bytes.byteLength, uploaded: o.uploaded } : null
    },
    async put(key, value) {
      store.set(key, {
        bytes: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value),
        uploaded: NOW
      })
    },
    async list({ prefix }) {
      return {
        objects: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, o]) => ({ key, size: o.bytes.byteLength, uploaded: o.uploaded })),
        truncated: false
      }
    },
    async delete(key) {
      store.delete(key)
    },
    async createMultipartUpload(key) {
      const id = `u${++next}`
      uploads.set(id, new Map())
      return multipart(key, id)
    },
    resumeMultipartUpload(key, uploadId) {
      return multipart(key, uploadId)
    }
  }
}

const shape = catalogShape()
const fileKey = snapshotFileKey('mtg', shape, 900)
const BYTES = new TextEncoder().encode('0123456789abcdefghijklmnopqrstuvwxyz')
const manifest = (over: Partial<SnapshotManifest> = {}): SnapshotManifest => ({
  game: 'mtg',
  shape,
  cursor: 900,
  dbVersion: '7',
  bytes: BYTES.byteLength,
  sha256: sha256Hex(BYTES),
  builtAt: NOW.toISOString(),
  key: fileKey,
  ...over
})

const route = (
  b: SnapshotBucket,
  path: string,
  init: RequestInit = {},
  token: string | null = ADMIN,
  now = NOW.getTime()
): Promise<Response | null> =>
  catalogSnapshotRoute(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    }),
    b,
    ADMIN,
    () => now
  )

describe('snapshot files (Worker entry)', () => {
  it('is not ours for other paths', async () => {
    expect(await route(snapBucket(), '/api/sync')).toBeNull()
  })

  it('signed file: 200 whole, 206 with Range, 403 when expired or tampered', async () => {
    const b = snapBucket()
    b.store.set(fileKey, { bytes: BYTES, uploaded: NOW })
    const url = await signSnapshotUrl(ORIGIN, fileKey, ADMIN, NOW.getTime())
    const path = url.slice(ORIGIN.length)

    const whole = (await route(b, path, {}, null))!
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-length')).toBe(String(BYTES.byteLength))
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(BYTES)

    const part = (await route(b, path, { headers: { range: 'bytes=10-' } }, null))!
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 10-35/36`)
    expect(new TextDecoder().decode(await part.arrayBuffer())).toBe('abcdefghijklmnopqrstuvwxyz')

    const exp = Number(new URL(url).searchParams.get('exp'))
    const late = (await route(b, path, {}, null, exp * 1000 + 1000))!
    expect(late.status).toBe(403)
    const sig = new URL(url).searchParams.get('sig')!
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    const tampered = (await route(b, path.replace(sig, flipped), {}, null))!
    expect(tampered.status).toBe(403)
    // Another key with this key's signature is refused too.
    const other = (await route(b, path.replace('/900.', '/901.'), {}, null))!
    expect(other.status).toBe(403)
  })

  it('the signed url lasts an hour', async () => {
    const url = await signSnapshotUrl(ORIGIN, fileKey, ADMIN, NOW.getTime())
    expect(Number(new URL(url).searchParams.get('exp'))).toBe(NOW.getTime() / 1000 + 3600)
  })

  it('admin upload in parts then publish', async () => {
    const b = snapBucket()
    const start = (await route(b, `/api/admin/catalog-snapshot/upload?key=${fileKey}`, {
      method: 'POST'
    }))!
    expect(start.status).toBe(200)
    const { uploadId } = (await start.json()) as { uploadId: string }
    const parts: { partNumber: number; etag: string }[] = []
    for (const [i, chunk] of [BYTES.slice(0, 20), BYTES.slice(20)].entries()) {
      const res = (await route(
        b,
        `/api/admin/catalog-snapshot/upload?key=${fileKey}&uploadId=${uploadId}&part=${i + 1}`,
        { method: 'PUT', body: chunk }
      ))!
      expect(res.status).toBe(200)
      parts.push({ partNumber: i + 1, ...((await res.json()) as { etag: string }) })
    }
    const done = (await route(
      b,
      `/api/admin/catalog-snapshot/complete?key=${fileKey}&uploadId=${uploadId}`,
      { method: 'POST', body: JSON.stringify({ parts }) }
    ))!
    expect(done.status).toBe(200)
    expect(b.store.get(fileKey)!.bytes).toEqual(BYTES)

    const pub = (await route(b, '/api/admin/catalog-snapshot/manifest', {
      method: 'PUT',
      body: JSON.stringify(manifest())
    }))!
    expect(pub.status).toBe(200)
    const stored = JSON.parse(
      new TextDecoder().decode(b.store.get(snapshotManifestKey('mtg', shape))!.bytes)
    )
    expect(stored).toEqual(manifest())
  })

  it('refuses a manifest whose file is missing or a different size', async () => {
    const b = snapBucket()
    const missing = (await route(b, '/api/admin/catalog-snapshot/manifest', {
      method: 'PUT',
      body: JSON.stringify(manifest())
    }))!
    expect(missing.status).toBe(400)
    b.store.set(fileKey, { bytes: BYTES.slice(1), uploaded: NOW })
    const short = (await route(b, '/api/admin/catalog-snapshot/manifest', {
      method: 'PUT',
      body: JSON.stringify(manifest())
    }))!
    expect(short.status).toBe(400)
  })

  it('every admin path refuses a missing or wrong token', async () => {
    const b = snapBucket()
    for (const [path, method] of [
      [`/api/admin/catalog-snapshot/upload?key=${fileKey}`, 'POST'],
      [`/api/admin/catalog-snapshot/upload?key=${fileKey}&uploadId=u1&part=1`, 'PUT'],
      [`/api/admin/catalog-snapshot/complete?key=${fileKey}&uploadId=u1`, 'POST'],
      ['/api/admin/catalog-snapshot/manifest', 'PUT']
    ] as const) {
      expect((await route(b, path, { method }, null))!.status, path).toBe(401)
      expect((await route(b, path, { method }, 'wrong'))!.status, path).toBe(401)
    }
  })

  it('refuses keys outside catalog-snapshots/', async () => {
    const b = snapBucket()
    const res = (await route(b, '/api/admin/catalog-snapshot/upload?key=card/small/1.jpg', {
      method: 'POST'
    }))!
    expect(res.status).toBe(400)
  })

  it('publishing prunes files a week after the manifest stopped naming them', async () => {
    const b = snapBucket()
    const old = snapshotFileKey('mtg', shape, 100)
    const otherShape = snapshotFileKey('mtg', 'ffffffff', 50)
    // Uploaded long ago, but named by the manifest until this publish: downloads may be under way.
    b.store.set(old, { bytes: BYTES, uploaded: new Date(NOW.getTime() - 30 * DAY) })
    b.store.set(otherShape, { bytes: BYTES, uploaded: new Date(NOW.getTime() - 30 * DAY) })
    b.store.set(fileKey, { bytes: BYTES, uploaded: new Date(NOW.getTime() - 9 * DAY) })
    const publish = async (at: number): Promise<void> => {
      const r = (await route(
        b,
        '/api/admin/catalog-snapshot/manifest',
        { method: 'PUT', body: JSON.stringify(manifest()) },
        ADMIN,
        at
      ))!
      expect(r.status).toBe(200)
    }
    await publish(NOW.getTime())
    expect(b.store.has(old)).toBe(true)
    await publish(NOW.getTime() + 6 * DAY)
    expect(b.store.has(old)).toBe(true)
    await publish(NOW.getTime() + 8 * DAY)
    expect(b.store.has(old)).toBe(false)
    expect(b.store.has(fileKey)).toBe(true)
    // Another shape's files serve apps that haven't updated; this shape's publish leaves them be.
    expect(b.store.has(otherShape)).toBe(true)
  })

  it('a malformed path escape is refused, not an error', async () => {
    const r = (await route(b0(), '/api/catalog/snapshot-file/%E0%A4%A?exp=1&sig=x', {}, null))!
    expect(r.status).toBe(403)
  })
})

const b0 = (): SnapshotBucket => snapBucket()

describe('GET /api/catalog/snapshot/<game> and the admin feed reader', () => {
  let db: Database.Database
  let deps: AppDeps
  let bucket: ReturnType<typeof snapBucket>

  const get = (path: string, auth: string | null): Promise<Response> =>
    handle(new Request(`${ORIGIN}${path}`, { headers: auth ? { authorization: auth } : {} }), deps)

  beforeEach(async () => {
    db = await seededServerDb()
    const alice = addUser(db, '1', 'alice')
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex('alice-desktop-token'),
      alice,
      'desktop',
      NOW.toISOString(),
      new Date(NOW.getTime() + DAY).toISOString()
    )
    bucket = snapBucket()
    deps = {
      db,
      images: bucket,
      printingArt: { url: async () => null },
      prices: { soon: async () => {} },
      env: { ADMIN_TOKEN: ADMIN },
      now: () => NOW,
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch
    } as unknown as AppDeps
  })

  it('offers the manifest for the shape with a signed url', async () => {
    bucket.store.set(snapshotManifestKey('mtg', shape), {
      bytes: new TextEncoder().encode(JSON.stringify(manifest())),
      uploaded: NOW
    })
    const res = await get(`/api/catalog/snapshot/mtg?shape=${shape}`, 'Bearer alice-desktop-token')
    expect(res.status).toBe(200)
    const offer = (await res.json()) as SnapshotOffer
    expect(offer.cursor).toBe(900)
    expect(offer.url.startsWith(`${ORIGIN}/api/catalog/snapshot-file/catalog-snapshots/mtg/`)).toBe(
      true
    )
    // The admin token gets one too (the nightly job builds from the last snapshot).
    expect((await get(`/api/catalog/snapshot/mtg?shape=${shape}`, `Bearer ${ADMIN}`)).status).toBe(
      200
    )
  })

  it('404 when no manifest for that shape', async () => {
    const res = await get('/api/catalog/snapshot/mtg?shape=00000000', 'Bearer alice-desktop-token')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'none' })
  })

  it('signed-out gets 401', async () => {
    expect((await get(`/api/catalog/snapshot/mtg?shape=${shape}`, null)).status).toBe(401)
  })

  it('the feed answers the admin token', async () => {
    expect((await get('/api/catalog/changes?since=0&game=mtg', `Bearer ${ADMIN}`)).status).toBe(200)
    expect((await get('/api/catalog/changes?since=0&game=mtg', 'Bearer wrong')).status).toBe(401)
  })

  it('the admin token cannot contribute', async () => {
    const res = await handle(
      new Request(`${ORIGIN}/api/catalog/contribute`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ printings: [] })
      }),
      deps
    )
    expect(res.status).toBe(401)
  })
})
