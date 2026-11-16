import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it, vi } from 'vitest'
import { mirrorZhArt, type MirrorRecord } from '../../scripts/catalog/pokemon/pokipairMirror'
import { POKIPAIR_HUB, type ZhCatalogCard } from '../../scripts/catalog/pokemon/pokipair'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/pokipair', name), 'utf8')

/** A small opaque PNG with see-through corners, as PokiPair's are. */
function png(): Uint8Array {
  const p = new PNG({ width: 40, height: 56 })
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = 200
    p.data[i + 1] = 100
    p.data[i + 2] = 50
    p.data[i + 3] = 255
  }
  p.data[3] = 0 // the top-left corner is clear
  return new Uint8Array(PNG.sync.write(p))
}

const csv8Cards: ZhCatalogCard[] = [
  { sourceId: 'zh-hans/CSV8C-005', number: '005', name: 'Volbeat' },
  { sourceId: 'zh-hans/CSV8C-006', number: '006', name: 'Illumise' },
  { sourceId: 'zh-hans/CSV8C-007', number: '007', name: 'Foongus' }
]
const gemCards: ZhCatalogCard[] = ['0101', '0102', '0103'].map((n) => ({
  sourceId: `zh-hans/CBB7C-${n}`,
  number: n,
  name: "Team Rocket's Raticate"
}))

function setup(over: { image?: (url: string) => Response; page?: (url: string) => Response } = {}) {
  const urls: string[] = []
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/^DuelBinder\/catalog/)
    if (url === POKIPAIR_HUB) return new Response(fixture('hub.html'))
    if (url.includes('bright-fantasy-csv8'))
      return over.page?.(url) ?? new Response(fixture('csv8.html'))
    if (url.includes('gem-pack-vol-7')) return new Response(fixture('gem7.html'))
    if (url.includes('nine-colors')) return new Response('<html></html>')
    if (url.startsWith('https://media.pokipair.com/'))
      return (
        over.image?.(url) ??
        new Response(png() as unknown as BodyInit, { headers: { 'content-type': 'image/png' } })
      )
    return new Response('nope', { status: 404 })
  })
  const uploads: { id: string; size: string; type: string | null }[] = []
  const portalFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const m = /\/api\/admin\/hand-art\/([^/]+)\/(high|low)$/.exec(String(input))!
    uploads.push({ id: m[1], size: m[2], type: new Headers(init?.headers).get('content-type') })
    return new Response('{"ok":true}')
  })
  const sleep = vi.fn(async () => undefined)
  const record: MirrorRecord = { done: {} }
  const cards = new Map([
    ['CSV8C', csv8Cards],
    ['CBB7C', gemCards],
    ['CS4aC', []]
  ])
  const run = (o: { budget?: number; dry?: boolean } = {}) =>
    mirrorZhArt({
      cards,
      record,
      fetch: fetchFn as unknown as typeof fetch,
      portal: o.dry
        ? undefined
        : { url: 'https://portal.test', token: 't', fetch: portalFetch as unknown as typeof fetch },
      budget: o.budget ?? 100,
      gapMs: 1000,
      sleep,
      log: () => undefined
    })
  return { run, urls, uploads, record, sleep, fetchFn }
}

describe('mirrorZhArt', () => {
  it('copies each matched card as a high and a low JPEG and records it', async () => {
    const t = setup()
    const r = await t.run()
    expect(r.uploaded).toBe(6) // 3 CSV8C + 3 CBB7C
    expect(
      t.uploads
        .filter((u) => u.size === 'high')
        .map((u) => u.id)
        .sort()
    ).toEqual([
      'zh-hans-cbb7c-0101',
      'zh-hans-cbb7c-0102',
      'zh-hans-cbb7c-0103',
      'zh-hans-csv8c-005',
      'zh-hans-csv8c-006',
      'zh-hans-csv8c-007'
    ])
    expect(t.uploads.every((u) => u.type === 'image/jpeg')).toBe(true)
    expect(Object.keys(t.record.done)).toHaveLength(6)
    expect(t.record.done['zh-hans/CSV8C-006']).toMatch(/-016\.png$/)
  })

  it('waits between every request to PokiPair', async () => {
    const t = setup()
    await t.run()
    expect(t.sleep).toHaveBeenCalledTimes(t.urls.length)
    expect(t.sleep).toHaveBeenCalledWith(1000)
  })

  it('skips cards already copied, and a set whose cards all are', async () => {
    const t = setup()
    await t.run()
    t.urls.length = 0
    t.uploads.length = 0
    const r = await t.run()
    expect(r.uploaded).toBe(0)
    expect(t.urls.some((u) => u.includes('bright-fantasy') || u.includes('gem-pack'))).toBe(false)
  })

  it('stops at the budget and carries the rest over', async () => {
    const t = setup()
    expect((await t.run({ budget: 2 })).uploaded).toBe(2)
    expect(Object.keys(t.record.done)).toHaveLength(2)
    expect((await t.run({ budget: 100 })).uploaded).toBe(4)
  })

  it('stops the run on a rate limit, keeping what was done', async () => {
    let n = 0
    const t = setup({
      image: () =>
        ++n === 2
          ? new Response('slow down', { status: 429 })
          : new Response(png() as unknown as BodyInit, { headers: { 'content-type': 'image/png' } })
    })
    const r = await t.run()
    expect(r.stopped).toMatch(/429/)
    expect(r.uploaded).toBe(1)
    expect(Object.keys(t.record.done)).toHaveLength(1)
  })

  it('counts an image that will not decode as failed and goes on', async () => {
    let n = 0
    const t = setup({
      image: () =>
        ++n === 1
          ? new Response('<html>')
          : new Response(png() as unknown as BodyInit, { headers: { 'content-type': 'image/png' } })
    })
    const r = await t.run()
    expect(r.failed).toBe(1)
    expect(r.uploaded).toBe(5)
  })

  it('on a dry run downloads and uploads nothing, records nothing, and says what it would copy', async () => {
    const t = setup()
    const r = await t.run({ dry: true })
    expect(r.matched).toBe(6)
    expect(r.uploaded).toBe(0)
    expect(t.urls.some((u) => u.startsWith('https://media.pokipair.com/'))).toBe(false)
    expect(t.record.done).toEqual({})
  })
})
