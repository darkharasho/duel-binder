import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  createCompactor,
  createScryfall,
  isKept,
  parseBulkLines,
  slimCard
} from '../../scripts/catalog/magic/scryfall'
import type { ScryCard } from '../../scripts/catalog/magic/types'

const FIXTURE = readFileSync('tests/fixtures/scryfall/default-cards.sample.json', 'utf8')
const OBJECTS = JSON.parse(FIXTURE) as ScryCard[]

async function* lines(text: string): AsyncIterable<string> {
  for (const l of text.split('\n')) yield l
}
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}
const jsonRes = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

describe('parseBulkLines', () => {
  it('reads array and JSONL layouts', async () => {
    expect(await collect(parseBulkLines(lines(FIXTURE)))).toEqual(OBJECTS)
    const jsonl = OBJECTS.map((o) => JSON.stringify(o)).join('\n')
    expect(await collect(parseBulkLines(lines(jsonl)))).toEqual(OBJECTS)
  })

  it('a cut-off file throws', async () => {
    const cut = FIXTURE.trimEnd().split('\n').slice(0, -2).join('\n')
    await expect(collect(parseBulkLines(lines(cut)))).rejects.toThrow(
      'Scryfall bulk file ended early'
    )
    await expect(collect(parseBulkLines(lines('[\n{"id": "a", "na')))).rejects.toThrow(
      'is not JSON'
    )
  })
})

describe('isKept', () => {
  const paper = OBJECTS[0]
  it('keeps paper objects in a supported language and drops the rest', () => {
    expect(isKept(paper)).toBe(true)
    expect(isKept({ ...paper, lang: 'ja' })).toBe(true)
    expect(isKept({ ...paper, lang: 'zhs' })).toBe(true)
    expect(isKept({ ...paper, lang: 'ph' })).toBe(false)
    expect(isKept({ ...paper, lang: 'ru', digital: true })).toBe(false)
    expect(isKept({ ...paper, games: ['arena'] })).toBe(false)
    expect(isKept({ ...paper, digital: true })).toBe(false)
    expect(isKept({ ...paper, games: ['paper', 'mtgo'], digital: true })).toBe(false)
  })
  it('judges the fixture objects', () => {
    const digital = OBJECTS.filter((o) => o.digital)
    expect(digital.length).toBeGreaterThan(0)
    for (const o of digital) expect(isKept(o)).toBe(false)
  })
})

describe('slimCard', () => {
  it('keeps what rows.ts reads and drops the rest', () => {
    const full = {
      ...OBJECTS[0],
      printed_name: 'Blitz',
      image_status: 'highres_scan',
      legalities: { modern: 'legal' },
      purchase_uris: { tcgplayer: 'u' },
      related_uris: { gatherer: 'u' },
      prices: { usd: '1', usd_foil: '2', usd_etched: null, eur: '3', tix: '4' },
      image_uris: { small: 'a', large: 'b' },
      card_faces: [
        { name: 'A', printed_name: 'Ä', image_uris: { small: 'a' }, flavor_text: 'x' },
        { name: 'B', printed_name: 'B2', flavor_text: 'y' }
      ]
    } as unknown as ScryCard
    const s = slimCard(full) as unknown as Record<string, unknown>
    expect(s).not.toHaveProperty('legalities')
    expect(s).not.toHaveProperty('purchase_uris')
    expect(s).not.toHaveProperty('related_uris')
    expect(s.prices).toEqual({ usd: '1', usd_foil: '2', usd_etched: null })
    expect(s.printed_name).toBe('Blitz')
    expect(s.image_status).toBe('highres_scan')
    expect(s.image_uris).toEqual({})
    expect(s.card_faces).toEqual([
      { name: 'A', printed_name: 'Ä', image_uris: {} },
      { name: 'B', printed_name: 'B2' }
    ])
  })
})

describe('createCompactor', () => {
  it('keeps every value slimCard keeps', () => {
    const compact = createCompactor()
    for (const o of OBJECTS) expect(compact(o)).toEqual(slimCard(o))
    for (const o of OBJECTS) expect(compact(slimCard(o))).toEqual(slimCard(o))
  })

  it('shares repeated lists and prices between objects', () => {
    const compact = createCompactor()
    const en = OBJECTS.find((o) => o.lang === 'en' && !o.card_faces)!
    const a = compact({ ...en, colors: ['W', 'U'], keywords: ['Flying'] })
    const b = compact({
      ...en,
      id: 'other',
      lang: 'ja',
      colors: ['W', 'U'],
      keywords: ['Flying'],
      prices: { ...en.prices }
    })
    expect(b.colors).toBe(a.colors)
    expect(b.keywords).toBe(a.keywords)
    expect(b.prices).toBe(a.prices)
    expect(b.id).toBe('other')
    expect(compact({ ...en, colors: ['U', 'W'] }).colors).toEqual(['U', 'W'])
  })
})

describe('createScryfall', () => {
  it('bulkInfo picks all_cards', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> })
      return jsonRes({
        data: [
          { type: 'oracle_cards', download_uri: 'https://x/oracle.json', updated_at: 'o' },
          {
            type: 'default_cards',
            download_uri: 'https://x/default.json',
            updated_at: 'd'
          },
          {
            type: 'all_cards',
            download_uri: 'https://x/all.json',
            updated_at: '2026-11-09T09:00:00.000+00:00'
          }
        ]
      })
    }) as unknown as typeof fetch
    const s = createScryfall({ version: '1.2.3', fetch: fake, gapMs: 0 })
    expect(await s.bulkInfo()).toEqual({
      downloadUri: 'https://x/all.json',
      updatedAt: '2026-11-09T09:00:00.000+00:00'
    })
    expect(seen[0].url).toBe('https://api.scryfall.com/bulk-data')
    expect(seen[0].headers['User-Agent']).toMatch(/^DuelBinder\//)
    expect(seen[0].headers.Accept).toBe('application/json')
  })

  it('bulkInfo throws without an all_cards entry', async () => {
    const fake = (async () =>
      jsonRes({
        data: [{ type: 'default_cards', download_uri: 'https://x/d.json', updated_at: 'u' }]
      })) as unknown as typeof fetch
    await expect(
      createScryfall({ version: 'x', fetch: fake, gapMs: 0 }).bulkInfo()
    ).rejects.toThrow('Scryfall bulk-data has no all_cards entry')
  })

  it('bulkInfo takes jsonl_download_uri when the entry has no download_uri', async () => {
    const fake = (async () =>
      jsonRes({
        data: [
          {
            type: 'all_cards',
            jsonl_download_uri: 'https://x/default.jsonl.gz',
            updated_at: 'u'
          }
        ]
      })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    expect(await s.bulkInfo()).toEqual({
      downloadUri: 'https://x/default.jsonl.gz',
      updatedAt: 'u'
    })
    const none = (async () =>
      jsonRes({ data: [{ type: 'all_cards', updated_at: 'u' }] })) as unknown as typeof fetch
    await expect(
      createScryfall({ version: 'x', fetch: none, gapMs: 0 }).bulkInfo()
    ).rejects.toThrow('no download link')
  })

  it('cards() streams a gzipped body', async () => {
    const fake = (async () =>
      new Response(gzipSync(Buffer.from(FIXTURE)), { status: 200 })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    expect(await collect(s.cards('https://x/default.json'))).toEqual(OBJECTS.map(slimCard))
  })

  it('cards() streams a plain body', async () => {
    const fake = (async () => new Response(FIXTURE, { status: 200 })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    expect(await collect(s.cards('https://x/default.json'))).toEqual(OBJECTS.map(slimCard))
  })

  it('sets() follows next_page', async () => {
    const urls: string[] = []
    const fake = (async (url: string) => {
      urls.push(url)
      return url.endsWith('/sets')
        ? jsonRes({
            has_more: true,
            next_page: 'https://api.scryfall.com/sets?page=2',
            data: [{ code: 'a' }, { code: 'b' }]
          })
        : jsonRes({ has_more: false, data: [{ code: 'c' }] })
    }) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    expect((await s.sets()).map((x) => x.code)).toEqual(['a', 'b', 'c'])
    expect(urls).toEqual(['https://api.scryfall.com/sets', 'https://api.scryfall.com/sets?page=2'])
  })

  it('spaces api requests by gapMs', async () => {
    vi.useFakeTimers()
    try {
      const starts: number[] = []
      const fake = (async (url: string) => {
        starts.push(Date.now())
        return url.endsWith('/sets')
          ? jsonRes({ has_more: true, next_page: 'https://api.scryfall.com/sets?page=2', data: [] })
          : jsonRes({ data: [] })
      }) as unknown as typeof fetch
      const p = createScryfall({ version: 'x', fetch: fake, gapMs: 60 }).sets()
      await vi.advanceTimersByTimeAsync(200)
      await p
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(60)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cards() rejects on a failed response', async () => {
    const fake = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    await expect(collect(s.cards('https://x/default.json'))).rejects.toThrow('returned 503')
  })

  it('cards() rejects a gzipped body cut in half', async () => {
    const gz = gzipSync(Buffer.from(FIXTURE))
    const fake = (async () =>
      new Response(gz.subarray(0, gz.length >> 1), { status: 200 })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    await expect(collect(s.cards('https://x/default.json'))).rejects.toThrow()
  }, 5000)

  it.each([
    ['gzipped', (b: Buffer) => gzipSync(b)],
    ['plain', (b: Buffer) => b]
  ])(
    'cards() rejects when a %s body errors partway',
    async (_n, enc) => {
      const bytes = enc(Buffer.from(FIXTURE))
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes.subarray(0, bytes.length >> 1))
        },
        pull(c) {
          c.error(new Error('connection reset'))
        }
      })
      const fake = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch
      const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
      await expect(collect(s.cards('https://x/default.json'))).rejects.toThrow('connection reset')
    },
    5000
  )
})
