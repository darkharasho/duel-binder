import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import { PHONE_CSP } from '../../workers/portal/src/phonePage'
import { WEB_CSP } from '../../workers/portal/src/home'

const BASE = 'https://portal.test'

describe('/scan/ page routes', () => {
  let deps: AppDeps
  let bucket: ReturnType<typeof memoryBucket>
  let assetsFetch: ReturnType<typeof vi.fn<(r: Request) => Promise<Response>>>
  const ASSETS: Record<string, string> = {
    '/app/scan/index.html': '<!doctype html><div id="root">',
    '/app/scan/sw.js': 'self.addEventListener("fetch", () => {})',
    '/app/scan/manifest.webmanifest': '{"name":"Duel Binder"}'
  }

  beforeEach(() => {
    const db = new Database(':memory:')
    migrateServer(db)
    bucket = memoryBucket()
    assetsFetch = vi.fn(async (r: Request) => {
      const body = ASSETS[new URL(r.url).pathname]
      return body
        ? new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' }
          })
        : new Response('nope', { status: 404 })
    })
    deps = {
      db,
      assets: { fetch: assetsFetch },
      images: bucket,
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-10-27T12:00:00.000Z'),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const get = (path: string, init: RequestInit = {}): Promise<Response> =>
    handle(new Request(BASE + path, init), deps)

  it('PHONE_CSP is the agreed value and the web CSP is unchanged', () => {
    expect(PHONE_CSP).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.discordapp.com; connect-src 'self'"
    )
    expect(WEB_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com"
    )
  })

  it('/scan redirects to /scan/', async () => {
    const res = await get('/scan')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/scan/')
  })

  it('/scan/ is served with PHONE_CSP', async () => {
    const res = await get('/scan/?signin=failed')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id="root"')
    expect(res.headers.get('content-security-policy')).toBe(PHONE_CSP)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(new URL(assetsFetch.mock.calls[0][0].url).pathname).toBe('/app/scan/index.html')
  })

  it('/scan/sw.js carries service-worker-allowed', async () => {
    const res = await get('/scan/sw.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('addEventListener')
    expect(res.headers.get('service-worker-allowed')).toBe('/scan/')
    expect(res.headers.get('content-type')).toBe('text/javascript')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  it('/scan/manifest.webmanifest is served as a manifest', async () => {
    const res = await get('/scan/manifest.webmanifest')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Duel Binder' })
    expect(res.headers.get('content-type')).toBe('application/manifest+json')
  })

  it('answers 404 when the page is not built', async () => {
    assetsFetch.mockImplementation(async () => new Response('nope', { status: 404 }))
    for (const path of ['/scan/', '/scan/sw.js', '/scan/manifest.webmanifest']) {
      expect((await get(path)).status).toBe(404)
    }
  })

  it('only handles GET', async () => {
    const res = await get('/scan/', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it('/scan/fingerprints still serves fingerprints', async () => {
    const res = await get('/scan/fingerprints')
    // No file uploaded: the fingerprint handler's own 404, not the asset binding.
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No fingerprints yet' })
    await bucket.put('scan/fingerprints.bin', new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: 'application/octet-stream' }
    })
    const hit = await get('/scan/fingerprints')
    expect(hit.status).toBe(200)
    expect(hit.headers.get('content-type')).toBe('application/octet-stream')
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it('other /scan/ paths are not served by the page routes', async () => {
    const res = await get('/scan/other.js')
    expect(res.status).toBe(404)
    expect(assetsFetch).not.toHaveBeenCalled()
  })
})
