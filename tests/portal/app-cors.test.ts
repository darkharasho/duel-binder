import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'

const BASE = 'https://portal.test'
const IOS = 'capacitor://localhost'

function deps(): AppDeps {
  const db = new Database(':memory:')
  migrateServer(db)
  return {
    db,
    assets: { fetch: async () => new Response('nope', { status: 404 }) },
    images: memoryBucket(),
    printingArt: noPrintingArt,
    prices: noPrices,
    env: {
      PUBLIC_URL: BASE,
      SITE_URL: 'https://site.test',
      DISCORD_CLIENT_ID: 'cid',
      DISCORD_CLIENT_SECRET: 'secret',
      ADMIN_TOKEN: 'admin',
      PRICE_WORKER_URL: 'https://prices.test'
    },
    now: () => new Date('2026-10-27T12:00:00.000Z'),
    fetch: (async () => new Response('?', { status: 404 })) as typeof fetch
  }
}

const preflight = (path: string, origin = IOS): Promise<Response> =>
  handle(
    new Request(BASE + path, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type'
      }
    }),
    deps()
  )

describe("CORS for the iOS app's origin", () => {
  it('answers preflights for the Bearer routes the app calls', async () => {
    for (const path of [
      '/api/me',
      '/api/sync/push',
      '/api/rpc/collection%3Alist',
      '/api/catalog/snapshot',
      '/api/account/delete',
      '/auth/desktop/token',
      '/auth/desktop/revoke',
      '/scan/fingerprints',
      '/img/small/1.jpg'
    ]) {
      const res = await preflight(path)
      expect(res.status, path).toBe(204)
      expect(res.headers.get('access-control-allow-origin'), path).toBe(IOS)
      expect(res.headers.get('access-control-allow-headers')).toMatch(/authorization/)
      expect(res.headers.get('access-control-allow-headers')).toMatch(/if-none-match/)
      expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })

  it('adds the origin header to real responses', async () => {
    const res = await handle(new Request(BASE + '/api/me', { headers: { origin: IOS } }), deps())
    expect(res.status).toBe(401)
    expect(res.headers.get('access-control-allow-origin')).toBe(IOS)
    expect(res.headers.get('vary')).toMatch(/origin/i)
    expect(res.headers.get('access-control-expose-headers')).toMatch(/etag/)
  })

  it('leaves other origins and the cookie-only routes alone', async () => {
    const other = await preflight('/api/me', 'https://evil.test')
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    for (const path of ['/auth/phone/token', '/auth/logout', '/admin/catalog']) {
      const res = await preflight(path)
      expect(res.headers.get('access-control-allow-origin'), path).toBeNull()
    }
    const plain = await handle(new Request(BASE + '/api/me'), deps())
    expect(plain.headers.get('access-control-allow-origin')).toBeNull()
  })
})
