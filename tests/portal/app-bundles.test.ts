import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { appBundlesRoute, type AppBundleBucket } from '../../workers/portal/src/appBundles'
import type { ManifestEntry, ReleaseRecord } from '../../src/shared/appBundles'

const ORIGIN = 'https://app.duelbinder.com'
const ADMIN = 'admin-secret'
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

function bucket(): AppBundleBucket & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>()
  return {
    store,
    async get(key) {
      const o = store.get(key)
      return o ? { body: new Response(o.slice()).body!, size: o.byteLength } : null
    },
    async head(key) {
      const o = store.get(key)
      return o ? { size: o.byteLength, uploaded: new Date(0) } : null
    },
    async put(key, value) {
      store.set(
        key,
        typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      )
    }
  }
}

const call = (
  b: AppBundleBucket,
  path: string,
  init: RequestInit & { auth?: boolean } = {},
  cache: Cache | null = null
): Promise<Response | null> => {
  const { auth, ...rest } = init
  const headers = new Headers(rest.headers)
  if (auth) headers.set('authorization', `Bearer ${ADMIN}`)
  return appBundlesRoute(new Request(ORIGIN + path, { ...rest, headers }), b, ADMIN, cache)
}

const put = (b: AppBundleBucket, path: string, body: unknown): Promise<Response | null> =>
  call(b, path, { method: 'PUT', auth: true, body: JSON.stringify(body) })
const post = (b: AppBundleBucket, path: string, body?: unknown): Promise<Response | null> =>
  call(b, path, { method: 'POST', auth: true, body: body ? JSON.stringify(body) : undefined })

async function upload(b: AppBundleBucket, content: string): Promise<ManifestEntry> {
  const hash = sha(content)
  const res = await call(b, `/api/admin/app-bundles/files/${hash}`, {
    method: 'PUT',
    auth: true,
    body: content
  })
  expect(res!.status).toBe(200)
  return {
    file_name: 'index.html',
    file_hash: hash,
    download_url: `${ORIGIN}/api/app-bundles/files/${hash}`
  }
}

const record = (
  target: ReleaseRecord['target'],
  version: string,
  manifest: ManifestEntry[],
  fingerprint = 'fp1'
): ReleaseRecord => ({
  target,
  version,
  fingerprint,
  schema: 48,
  manifest,
  signature: `sig-${version}`,
  createdAt: '2026-11-16T00:00:00.000Z'
})

const release = async (
  b: AppBundleBucket,
  target: ReleaseRecord['target'],
  version: string,
  fingerprint = 'fp1'
): Promise<void> => {
  const m = await upload(b, `bundle ${target} ${version}`)
  const res = await put(
    b,
    `/api/admin/app-bundles/${target}/releases/${version}`,
    record(target, version, [m], fingerprint)
  )
  expect(res!.status).toBe(200)
}

const update = async (b: AppBundleBucket, q: string): Promise<{ status: number; body: any }> => {
  const res = await call(b, `/api/app-update?${q}`)
  return { status: res!.status, body: await res!.json() }
}

describe('app-update', () => {
  it('app-update: offers newer release with manifest and signature', async () => {
    const b = bucket()
    await release(b, 'ios', '1.0.0')
    await release(b, 'ios', '1.1.0')
    const res = await call(b, '/api/app-update?target=ios&builtin=1.0.0&current=1.0.0')
    expect(res!.headers.get('cache-control')).toBe('public, max-age=60')
    const body = (await res!.json()) as any
    expect(body.version).toBe('1.1.0')
    expect(body.signature).toBe('sig-1.1.0')
    expect(body.manifest).toHaveLength(1)
  })

  it('app-update: unknown builtin gets nothing', async () => {
    const b = bucket()
    await release(b, 'ios', '1.1.0')
    expect((await update(b, 'target=ios&builtin=0.9.0&current=0.9.0')).body).toEqual({
      version: null
    })
  })

  it('app-update: rejects bad queries and is an exact path', async () => {
    const b = bucket()
    expect((await update(b, 'target=web&builtin=1.0.0&current=1.0.0')).status).toBe(400)
    expect((await update(b, 'target=ios&builtin=1.0&current=1.0.0')).status).toBe(400)
    expect(await call(b, '/api/app-update/none')).toBeNull()
    expect(await call(b, '/api/other')).toBeNull()
  })

  it('app-update: withdrawn current falls back', async () => {
    const b = bucket()
    await release(b, 'ios', '1.0.0')
    await release(b, 'ios', '1.1.0')
    await release(b, 'ios', '1.2.0')
    expect((await post(b, '/api/admin/app-bundles/ios/releases/1.2.0/withdraw'))!.status).toBe(200)
    const { body } = await update(b, 'target=ios&builtin=1.0.0&current=1.2.0')
    expect(body.version).toBe('1.1.0')
  })

  it('app-update: android-apk carries shellUpdate', async () => {
    const b = bucket()
    await release(b, 'android-apk', '1.0.0', 'old')
    await release(b, 'android-apk', '2.0.0', 'new')
    const res = await post(b, '/api/admin/app-bundles/android-apk/releases/2.0.0/apk', {
      url: 'https://example.com/app.apk'
    })
    expect(res!.status).toBe(200)
    const { body } = await update(b, 'target=android-apk&builtin=1.0.0&current=1.0.0')
    expect(body).toEqual({
      version: null,
      shellUpdate: { version: '2.0.0', url: 'https://example.com/app.apk' }
    })
  })

  it('app-update: answers are served from the edge cache', async () => {
    const b = bucket()
    await release(b, 'ios', '1.1.0')
    const held = new Map<string, Response>()
    const cache = {
      match: async (r: Request) => held.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void held.set(r.url, res)
    } as unknown as Cache
    const path = '/api/app-update?target=ios&builtin=1.1.0&current=1.0.0'
    await call(b, path, {}, cache)
    expect(held.size).toBe(1)
    b.store.clear()
    const again = await call(b, path, {}, cache)
    expect(((await again!.json()) as any).version).toBe('1.1.0')
  })
})

describe('files', () => {
  it('files: serves immutable content', async () => {
    const b = bucket()
    const m = await upload(b, 'hello')
    const res = await call(b, `/api/app-bundles/files/${m.file_hash}`)
    expect(res!.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res!.text()).toBe('hello')
    expect(
      (await call(b, `/api/app-bundles/files/${m.file_hash}`, { method: 'HEAD' }))!.status
    ).toBe(200)
    const none = sha('nope')
    expect((await call(b, `/api/app-bundles/files/${none}`))!.status).toBe(404)
    expect((await call(b, `/api/app-bundles/files/${none}`, { method: 'HEAD' }))!.status).toBe(404)
  })
})

describe('admin', () => {
  it('admin: rejects without token (401)', async () => {
    const b = bucket()
    const res = await call(b, `/api/admin/app-bundles/files/${sha('x')}`, {
      method: 'PUT',
      body: 'x'
    })
    expect(res!.status).toBe(401)
  })

  it('admin: file hash mismatch is 400', async () => {
    const b = bucket()
    const res = await call(b, `/api/admin/app-bundles/files/${sha('a')}`, {
      method: 'PUT',
      auth: true,
      body: 'b'
    })
    expect(res!.status).toBe(400)
    expect(await res!.json()).toEqual({ error: 'hash-mismatch' })
  })

  it('admin: release with missing file is 400', async () => {
    const b = bucket()
    const m: ManifestEntry = { file_name: 'a', file_hash: sha('missing'), download_url: 'u' }
    const res = await put(
      b,
      '/api/admin/app-bundles/ios/releases/1.0.0',
      record('ios', '1.0.0', [m])
    )
    expect(res!.status).toBe(400)
    expect(await res!.json()).toEqual({ error: 'file-missing' })
  })

  it('admin: release path must match its record, builtins round-trip', async () => {
    const b = bucket()
    const m = await upload(b, 'x')
    const bad = await put(
      b,
      '/api/admin/app-bundles/ios/releases/1.0.1',
      record('ios', '1.0.0', [m])
    )
    expect(bad!.status).toBe(400)
    await release(b, 'ios', '1.0.0')
    const got = await call(b, '/api/admin/app-bundles/ios/builtins/1.0.0', { auth: true })
    expect(await got!.json()).toEqual({ fingerprint: 'fp1', schema: 48 })
    expect(
      (await call(b, '/api/admin/app-bundles/ios/builtins/9.9.9', { auth: true }))!.status
    ).toBe(404)
    const set = await put(b, '/api/admin/app-bundles/ios/builtins/9.9.9', {
      fingerprint: 'z',
      schema: 1
    })
    expect(set!.status).toBe(200)
  })

  it('admin: withdraw then restore round-trips the index', async () => {
    const b = bucket()
    await release(b, 'ios', '1.0.0')
    const index = async (): Promise<any[]> =>
      JSON.parse(new TextDecoder().decode(b.store.get('app-bundles/ios/index.json')))
    const before = await index()
    await post(b, '/api/admin/app-bundles/ios/releases/1.0.0/withdraw')
    expect((await index())[0].withdrawn).toBe(true)
    await post(b, '/api/admin/app-bundles/ios/releases/1.0.0/restore')
    expect(await index()).toEqual(before)
    expect((await post(b, '/api/admin/app-bundles/ios/releases/7.0.0/withdraw'))!.status).toBe(404)
  })

  it('admin: re-PUT keeps withdrawn and apkUrl', async () => {
    const b = bucket()
    await release(b, 'android-apk', '2.0.0')
    await post(b, '/api/admin/app-bundles/android-apk/releases/2.0.0/withdraw')
    await post(b, '/api/admin/app-bundles/android-apk/releases/2.0.0/apk', {
      url: 'https://x/a.apk'
    })
    await release(b, 'android-apk', '2.0.0')
    const read = (k: string): any => JSON.parse(new TextDecoder().decode(b.store.get(k)))
    const rec = read('app-bundles/android-apk/releases/2.0.0.json')
    expect(rec.withdrawn).toBe(true)
    expect(rec.apkUrl).toBe('https://x/a.apk')
    const idx = read('app-bundles/android-apk/index.json')
    expect(idx).toHaveLength(1)
    expect(idx[0].withdrawn).toBe(true)
    expect(idx[0].apkUrl).toBe('https://x/a.apk')
  })

  it('admin: GET and POST without a token are 401', async () => {
    const b = bucket()
    expect((await call(b, '/api/admin/app-bundles/ios/builtins/1.0.0'))!.status).toBe(401)
    expect(
      (await call(b, '/api/admin/app-bundles/ios/releases/1.0.0/withdraw', { method: 'POST' }))!
        .status
    ).toBe(401)
  })

  it('admin: a hash path that is not 64 hex characters is rejected', async () => {
    const b = bucket()
    const res = await call(b, '/api/admin/app-bundles/files/abc123', {
      method: 'PUT',
      auth: true,
      body: 'x'
    })
    expect(res!.status).toBe(400)
    expect((await call(b, '/api/app-bundles/files/abc123'))!.status).toBe(404)
  })

  it('admin: a bad JSON body is 400', async () => {
    const b = bucket()
    for (const path of [
      '/api/admin/app-bundles/ios/releases/1.0.0',
      '/api/admin/app-bundles/ios/builtins/1.0.0'
    ]) {
      const res = await call(b, path, { method: 'PUT', auth: true, body: '{nope' })
      expect(res!.status).toBe(400)
    }
  })
})
