import { describe, expect, it } from 'vitest'
import { rulesPackRoute } from '../../workers/portal/src/rulesPack'
import { buildMtgPack } from '../../src/shared/decks/magic/buildPack'
import { buildOpPack, type OpRulesFile } from '../../src/shared/decks/onepiece/buildPack'
import onepieceRules from '../../src/shared/decks/rules/onepiece.json'
import type { SnapshotBucket } from '../../workers/portal/src/catalogSnapshot'

const ORIGIN = 'https://app.duelbinder.com'
const ADMIN = 'admin-secret'

type Bucket = Pick<SnapshotBucket, 'get' | 'put'>
function bucket(): Bucket & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>()
  return {
    store,
    async get(key) {
      const o = store.get(key)
      return o ? { body: new Response(o.slice()).body!, size: o.byteLength } : null
    },
    async put(key, value) {
      store.set(
        key,
        typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      )
    }
  }
}

function fakeCache(): Cache & { map: Map<string, Response> } {
  const map = new Map<string, Response>()
  return {
    map,
    async match(r: Request | string) {
      const hit = map.get(typeof r === 'string' ? r : r.url)
      return hit?.clone()
    },
    async put(r: Request | string, res: Response) {
      map.set(typeof r === 'string' ? r : r.url, res)
    },
    async delete(r: Request | string) {
      return map.delete(typeof r === 'string' ? r : r.url)
    }
  } as unknown as Cache & { map: Map<string, Response> }
}

const pack = (game = 'ygo', extra: Record<string, unknown> = {}): unknown => ({
  schema: 1,
  game,
  version: '2026-11-22',
  builtAt: '2026-11-22T00:00:00Z',
  sources: [],
  formats: {
    advanced: { limits: { '1': 1 }, notReleased: {} },
    ocg: { limits: {}, notReleased: {} }
  },
  ...extra
})

const call = (
  b: Bucket,
  path: string,
  init: RequestInit & { auth?: boolean } = {},
  cache: Cache | null = null
): Promise<Response | null> => {
  const { auth, ...rest } = init
  const headers = new Headers(rest.headers)
  if (auth) headers.set('authorization', `Bearer ${ADMIN}`)
  return rulesPackRoute(new Request(ORIGIN + path, { ...rest, headers }), b, ADMIN, cache)
}
const put = (b: Bucket, path: string, body: unknown, auth = true, cache: Cache | null = null) =>
  call(
    b,
    path,
    { method: 'PUT', auth, body: typeof body === 'string' ? body : JSON.stringify(body) },
    cache
  )

describe('rulesPackRoute', () => {
  it('ignores other paths', async () => {
    expect(await call(bucket(), '/api/other')).toBeNull()
  })

  it('PUT without a token is 401', async () => {
    expect((await put(bucket(), '/api/admin/rules/ygo', pack(), false))!.status).toBe(401)
  })

  it('PUT malformed is 400', async () => {
    const b = bucket()
    expect((await put(b, '/api/admin/rules/ygo', 'not json'))!.status).toBe(400)
    expect((await put(b, '/api/admin/rules/ygo', { schema: 1 }))!.status).toBe(400)
    expect(b.store.size).toBe(0)
  })

  it('PUT a pkm pack to /ygo is 400', async () => {
    expect((await put(bucket(), '/api/admin/rules/ygo', pack('pkm')))!.status).toBe(400)
  })

  it('PUT /api/admin/rules/op accepts an op pack and GET serves it', async () => {
    const b = bucket()
    const op = buildOpPack(onepieceRules as OpRulesFile, new Date('2026-11-23T03:00:00Z'))
    expect((await put(b, '/api/admin/rules/op', op))!.status).toBe(200)
    const res = (await call(b, '/api/rules/op'))!
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(op)
  })

  it('PUT a pkm pack to /op is 400 bad-pack', async () => {
    const res = (await put(bucket(), '/api/admin/rules/op', pack('pkm')))!
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('bad-pack')
  })

  it('PUT /api/admin/rules/mtg accepts an mtg pack and GET serves it', async () => {
    const b = bucket()
    const mtg = buildMtgPack(
      [
        {
          name: 'Lightning Bolt',
          layout: 'normal',
          type_line: 'Instant',
          legalities: { modern: 'legal', commander: 'legal' },
          released_at: '1993-08-05'
        }
      ],
      { version: '2026-11-23T09:00:00Z', builtAt: new Date('2026-11-23T10:00:00Z') }
    )
    expect((await put(b, '/api/admin/rules/mtg', mtg))!.status).toBe(200)
    const res = (await call(b, '/api/rules/mtg'))!
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(mtg)
  })

  it('PUT an op pack to /mtg is 400 bad-pack', async () => {
    const op = buildOpPack(onepieceRules as OpRulesFile, new Date('2026-11-23T03:00:00Z'))
    const res = (await put(bucket(), '/api/admin/rules/mtg', op))!
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('bad-pack')
  })

  it('PUT a pack of a too-new schema is 400', async () => {
    expect((await put(bucket(), '/api/admin/rules/ygo', pack('ygo', { schema: 2 })))!.status).toBe(
      400
    )
  })

  it('PUT to an unknown game is 404', async () => {
    expect((await put(bucket(), '/api/admin/rules/zzz', pack()))!.status).toBe(404)
  })

  it('PUT a ready pack, then GET it back with an ETag and a cache header', async () => {
    const b = bucket()
    expect((await put(b, '/api/admin/rules/ygo', pack()))!.status).toBe(200)
    const res = (await call(b, '/api/rules/ygo'))!
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(await res.json()).toEqual(pack())
  })

  it('GET with a matching If-None-Match is 304', async () => {
    const b = bucket()
    await put(b, '/api/admin/rules/ygo', pack())
    const etag = (await call(b, '/api/rules/ygo'))!.headers.get('etag')!
    const res = (await call(b, '/api/rules/ygo', { headers: { 'if-none-match': etag } }))!
    expect(res.status).toBe(304)
  })

  it('GET an unknown game, or one with no pack, is 404', async () => {
    const b = bucket()
    expect((await call(b, '/api/rules/zzz'))!.status).toBe(404)
    expect((await call(b, '/api/rules/ygo'))!.status).toBe(404)
  })

  it('serves from the edge cache, and a PUT purges it', async () => {
    const b = bucket()
    const cache = fakeCache()
    await put(b, '/api/admin/rules/ygo', pack(), true, cache)
    await call(b, '/api/rules/ygo', {}, cache)
    expect(cache.map.size).toBe(1)
    await put(b, '/api/admin/rules/ygo', pack('ygo', { version: '2026-11-23' }), true, cache)
    expect(cache.map.size).toBe(0)
    const res = (await call(b, '/api/rules/ygo', {}, cache))!
    expect(((await res.json()) as { version: string }).version).toBe('2026-11-23')
  })

  it('one edge cache entry whatever the query string, so a PUT purges every copy', async () => {
    const b = bucket()
    const cache = fakeCache()
    await put(b, '/api/admin/rules/ygo', pack(), true, cache)
    await call(b, '/api/rules/ygo?v=1', {}, cache)
    await call(b, '/api/rules/ygo?bust=2', {}, cache)
    expect([...cache.map.keys()]).toEqual([`${ORIGIN}/api/rules/ygo`])
    await put(b, '/api/admin/rules/ygo', pack('ygo', { version: '2026-11-23' }), true, cache)
    const res = (await call(b, '/api/rules/ygo?v=1', {}, cache))!
    expect(((await res.json()) as { version: string }).version).toBe('2026-11-23')
  })
})
