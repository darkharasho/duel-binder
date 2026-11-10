import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { createScryfall, isKept, parseBulkLines } from '../../scripts/catalog/magic/scryfall'
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
  it('keeps English paper objects and drops the rest', () => {
    expect(isKept(paper)).toBe(true)
    expect(isKept({ ...paper, lang: 'ja' })).toBe(false)
    expect(isKept({ ...paper, games: ['arena'] })).toBe(false)
    expect(isKept({ ...paper, digital: true })).toBe(false)
    expect(isKept({ ...paper, games: ['paper', 'mtgo'], digital: true })).toBe(false)
  })
  it('judges the fixture objects', () => {
    const ja = OBJECTS.filter((o) => o.lang !== 'en')
    const digital = OBJECTS.filter((o) => o.digital)
    expect(ja.length).toBeGreaterThan(0)
    expect(digital.length).toBeGreaterThan(0)
    for (const o of [...ja, ...digital]) expect(isKept(o)).toBe(false)
  })
})

describe('createScryfall', () => {
  it('bulkInfo picks default_cards', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> })
      return jsonRes({
        data: [
          { type: 'oracle_cards', download_uri: 'https://x/oracle.json', updated_at: 'o' },
          {
            type: 'default_cards',
            download_uri: 'https://x/default.json',
            updated_at: '2026-11-09T09:00:00.000+00:00'
          },
          { type: 'all_cards', download_uri: 'https://x/all.json', updated_at: 'a' }
        ]
      })
    }) as unknown as typeof fetch
    const s = createScryfall({ version: '1.2.3', fetch: fake, gapMs: 0 })
    expect(await s.bulkInfo()).toEqual({
      downloadUri: 'https://x/default.json',
      updatedAt: '2026-11-09T09:00:00.000+00:00'
    })
    expect(seen[0].url).toBe('https://api.scryfall.com/bulk-data')
    expect(seen[0].headers['User-Agent']).toMatch(/^DuelBinder\//)
    expect(seen[0].headers.Accept).toBe('application/json')
  })

  it('cards() streams a gzipped body', async () => {
    const fake = (async () =>
      new Response(gzipSync(Buffer.from(FIXTURE)), { status: 200 })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    expect(await collect(s.cards('https://x/default.json'))).toEqual(OBJECTS)
  })

  it('cards() streams a plain body', async () => {
    const fake = (async () => new Response(FIXTURE, { status: 200 })) as unknown as typeof fetch
    const s = createScryfall({ version: 'x', fetch: fake, gapMs: 0 })
    expect(await collect(s.cards('https://x/default.json'))).toEqual(OBJECTS)
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
