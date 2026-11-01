import { describe, expect, it, vi } from 'vitest'
import { createYugipediaClient, YugipediaError } from '../../src/main/yugipedia/client'

interface Call {
  url: URL
  headers: Record<string, string>
}

function res(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers
  })
}

function setup(responder: (call: Call, n: number) => Response | Promise<Response>): {
  client: ReturnType<typeof createYugipediaClient>
  calls: Call[]
  starts: number[]
  waits: number[]
} {
  const calls: Call[] = []
  const starts: number[] = []
  const waits: number[] = []
  let clock = 1_000_000
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call = {
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>
    }
    calls.push(call)
    starts.push(clock)
    return responder(call, calls.length - 1)
  }) as unknown as typeof fetch
  const client = createYugipediaClient({
    version: '1.2.3',
    fetchFn,
    sleep: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    now: () => clock
  })
  return { client, calls, starts, waits }
}

describe('yugipedia client', () => {
  it('follows apcontinue', async () => {
    const { client, calls } = setup((_c, n) =>
      n === 0
        ? res({ continue: { apcontinue: 'B' }, query: { allpages: [{ title: 'A' }] } })
        : res({ query: { allpages: [{ title: 'B' }, { title: 'C' }] } })
    )
    expect(await client.listSetListTitles()).toEqual(['A', 'B', 'C'])
    expect(calls[0].url.searchParams.get('apnamespace')).toBe('3006')
    expect(calls[0].url.searchParams.get('aplimit')).toBe('max')
    expect(calls[0].url.searchParams.get('apfilterredir')).toBe('nonredirects')
    expect(calls[1].url.searchParams.get('apfilterredir')).toBe('nonredirects')
    expect(calls[0].url.searchParams.get('apcontinue')).toBeNull()
    expect(calls[1].url.searchParams.get('apcontinue')).toBe('B')
  })

  it('sends the User-Agent and maxlag', async () => {
    const { client, calls } = setup(() => res({ query: { allpages: [] } }))
    await client.listSetListTitles()
    const { url, headers } = calls[0]
    expect(url.origin + url.pathname).toBe('https://yugipedia.com/api.php')
    expect(headers['User-Agent']).toBe(
      'DuelBinder/1.2.3 (https://github.com/darkharasho/duel-binder)'
    )
    expect(url.searchParams.get('maxlag')).toBe('5')
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.get('formatversion')).toBe('2')
  })

  it('fetchPages chunks at 50 and maps normalized/redirected titles back', async () => {
    const titles = Array.from({ length: 120 }, (_, i) => `T${i}`)
    titles[0] = 'A_b'
    titles[1] = 'Old'
    const { client, calls } = setup((c) => {
      const asked = c.url.searchParams.get('titles')!.split('|')
      if (asked.includes('A_b')) {
        return res({
          query: {
            normalized: [{ from: 'A_b', to: 'A b' }],
            redirects: [{ from: 'Old', to: 'New' }],
            pages: [
              { title: 'A b', revisions: [{ slots: { main: { content: 'ca' } } }] },
              { title: 'New', revisions: [{ slots: { main: { content: 'cn' } } }] },
              { title: 'Gone', missing: true }
            ]
          }
        })
      }
      return res({ query: { pages: [] } })
    })
    const out = await client.fetchPages(titles)
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.url.searchParams.get('titles')!.split('|').length)).toEqual([
      50, 50, 20
    ])
    expect(calls[0].url.searchParams.get('redirects')).toBe('1')
    expect(calls[0].url.searchParams.get('rvslots')).toBe('main')
    expect(out.get('A_b')).toBe('ca')
    expect(out.get('Old')).toBe('cn')
    expect(out.size).toBe(2)
  })

  it('retries 503 then succeeds; waits 2s,4s', async () => {
    const { client, waits } = setup((_c, n) =>
      n < 2 ? res({}, { status: 503 }) : res({ query: { allpages: [{ title: 'A' }] } })
    )
    expect(await client.listSetListTitles()).toEqual(['A'])
    expect(waits.filter((w) => w >= 2000)).toEqual([2000, 4000])
  })

  it('honours Retry-After when larger', async () => {
    const { client, waits } = setup((_c, n) =>
      n === 0
        ? res({}, { status: 429, headers: { 'Retry-After': '9' } })
        : res({ query: { allpages: [] } })
    )
    await client.listSetListTitles()
    expect(waits.filter((w) => w >= 2000)).toEqual([9000])
  })

  it('retries a maxlag API error', async () => {
    const { client, calls } = setup((_c, n) =>
      n === 0
        ? res({ error: { code: 'maxlag', info: 'lagged' } })
        : res({ query: { allpages: [] } })
    )
    await client.listSetListTitles()
    expect(calls).toHaveLength(2)
  })

  it('throws YugipediaError after 3 retries without leaking the URL', async () => {
    const { client, calls, waits } = setup(() => res({}, { status: 500 }))
    const err = await client.fetchPages(['Secret title']).catch((e) => e)
    expect(err).toBeInstanceOf(YugipediaError)
    expect(err.message).toBe('HTTP 500')
    expect(err.message).not.toMatch(/yugipedia|Secret|titles/i)
    expect(calls).toHaveLength(4)
    expect(waits.filter((w) => w >= 2000)).toEqual([2000, 4000, 8000])
  })

  it('reports network errors and maxlag without details', async () => {
    const net = createYugipediaClient({
      version: '1',
      fetchFn: (async () => {
        throw new Error('connect ECONNREFUSED https://yugipedia.com/api.php?x=1')
      }) as unknown as typeof fetch,
      sleep: async () => {},
      now: () => 0
    })
    await expect(net.listSetListTitles()).rejects.toThrow(/^network error$/)
    const lag = setup(() => res({ error: { code: 'maxlag' } }))
    await expect(lag.client.listSetListTitles()).rejects.toThrow(/^maxlag$/)
  })

  it('does not retry other API errors', async () => {
    const { client, calls } = setup(() => res({ error: { code: 'badvalue' } }))
    await expect(client.listSetListTitles()).rejects.toThrow('API error: badvalue')
    expect(calls).toHaveLength(1)
  })

  it('keeps concurrent callers 500 ms apart, those arriving late included', async () => {
    vi.useFakeTimers()
    try {
      const starts: number[] = []
      const t0 = Date.now()
      const client = createYugipediaClient({
        version: '1',
        fetchFn: (async () => {
          starts.push(Date.now() - t0)
          return res({ query: { pages: [] } })
        }) as unknown as typeof fetch
      })
      const calls = [1, 2, 3].map((n) => client.imageUrlsByPageId([n]))
      await vi.advanceTimersByTimeAsync(100)
      calls.push(client.imageUrlsByPageId([4]))
      await vi.runAllTimersAsync()
      await Promise.all(calls)
      expect(starts).toEqual([0, 500, 1000, 1500])

      // Slots already past hold nobody up.
      await vi.advanceTimersByTimeAsync(10_000)
      const idle = Date.now() - t0
      await client.imageUrlsByPageId([5])
      expect(starts[4]).toBe(idle)
    } finally {
      vi.useRealTimers()
    }
  })

  it('paces requests at >=500 ms', async () => {
    const { client, starts } = setup((_c, n) =>
      n < 3
        ? res({ continue: { apcontinue: String(n) }, query: { allpages: [] } })
        : res({ query: { allpages: [] } })
    )
    await client.listSetListTitles()
    expect(starts).toHaveLength(4)
    for (let i = 1; i < starts.length; i++)
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500)
  })

  it('counts retry backoff toward pacing', async () => {
    const { client, waits } = setup((_c, n) =>
      n === 0 ? res({}, { status: 503 }) : res({ query: { allpages: [] } })
    )
    await client.listSetListTitles()
    expect(waits).toEqual([2000])
  })

  it('fetchImageUrls drops non-ms.yugipedia.com URLs', async () => {
    const { client, calls } = setup(() =>
      res({
        query: {
          normalized: [{ from: 'File:a_b.png', to: 'File:A b.png' }],
          pages: [
            { title: 'File:A b.png', imageinfo: [{ url: 'https://ms.yugipedia.com/x/a.png' }] },
            { title: 'File:Evil.png', imageinfo: [{ url: 'https://evil.example/e.png' }] },
            { title: 'File:None.png', missing: true }
          ]
        }
      })
    )
    const out = await client.fetchImageUrls(['a_b.png', 'Evil.png', 'None.png'])
    expect(calls[0].url.searchParams.get('prop')).toBe('imageinfo')
    expect(calls[0].url.searchParams.get('titles')).toBe('File:a_b.png|File:Evil.png|File:None.png')
    expect([...out]).toEqual([['a_b.png', 'https://ms.yugipedia.com/x/a.png']])
  })

  it("reads the API's new image host as ms.yugipedia.com", async () => {
    const { client } = setup(() =>
      res({
        query: {
          pages: [
            { title: 'File:A.png', imageinfo: [{ url: 'https://img.yugipedia.com/x/a.png' }] }
          ]
        }
      })
    )
    const out = await client.fetchImageUrls(['A.png'])
    expect([...out]).toEqual([['A.png', 'https://ms.yugipedia.com/x/a.png']])
  })

  it('listPageImages follows imcontinue and redirects, stripping File:', async () => {
    const { client, calls } = setup((_call, n) =>
      n === 0
        ? res({
            continue: { imcontinue: '123|B.png', continue: '||' },
            query: {
              redirects: [{ from: 'Card Gallery:Old', to: 'Card Gallery:New' }],
              pages: [{ title: 'Card Gallery:New', images: [{ title: 'File:A.png' }] }]
            }
          })
        : res({
            query: { pages: [{ title: 'Card Gallery:New', images: [{ title: 'File:B.png' }] }] }
          })
    )
    const out = await client.listPageImages(['Card Gallery:Old', 'Card Gallery:Missing'])
    expect(calls[0].url.searchParams.get('prop')).toBe('images')
    expect(calls[1].url.searchParams.get('imcontinue')).toBe('123|B.png')
    expect([...out]).toEqual([['Card Gallery:Old', ['A.png', 'B.png']]])
  })

  it('listPageImages leaves out missing and invalid titles, as the live API lists them', async () => {
    const { client } = setup(() =>
      res({
        query: {
          pages: [
            { title: 'Card Gallery:Gone', missing: true },
            { title: 'Card Gallery:A <B>', invalid: true },
            { title: 'Card Gallery:Here', images: [{ title: 'File:H.png' }] }
          ]
        }
      })
    )
    const out = await client.listPageImages([
      'Card Gallery:Gone',
      'Card Gallery:A <B>',
      'Card Gallery:Here'
    ])
    expect([...out]).toEqual([['Card Gallery:Here', ['H.png']]])
  })
})

describe('token lookups', () => {
  it('lists a category through its continuations', async () => {
    const { client, calls } = setup((_, n) =>
      n === 0
        ? res({
            query: { categorymembers: [{ pageid: 7, title: 'A' }] },
            continue: { cmcontinue: 'next' }
          })
        : res({ query: { categorymembers: [{ pageid: 8, title: 'B' }] } })
    )
    expect(await client.listCategoryPages('Category:Monster Tokens')).toEqual([
      { pageId: 7, title: 'A' },
      { pageId: 8, title: 'B' }
    ])
    expect(calls[1].url.searchParams.get('cmcontinue')).toBe('next')
    expect(calls[0].url.searchParams.get('cmnamespace')).toBe('0')
  })

  it('gives a file its page id, through normalized titles, and skips missing files', async () => {
    const { client } = setup(() =>
      res({
        query: {
          normalized: [{ from: 'File:a_b.png', to: 'File:A b.png' }],
          pages: [
            { title: 'File:A b.png', pageid: 12 },
            { title: 'File:Gone.png', missing: true }
          ]
        }
      })
    )
    expect(await client.filePageIds(['a_b.png', 'Gone.png'])).toEqual(new Map([['a_b.png', 12]]))
  })

  it('finds a file by page id, only on Yugipedia, asking for no thumbnail', async () => {
    const yp = 'https://ms.yugipedia.com/'
    const { client, calls } = setup(() =>
      res({
        query: {
          pages: [
            { title: 'File:A', pageid: 1, imageinfo: [{ url: `${yp}a.png` }] },
            { title: 'File:C', pageid: 3, imageinfo: [{ url: 'https://evil.test/c.png' }] }
          ]
        }
      })
    )
    expect(await client.imageUrlsByPageId([1, 3])).toEqual(new Map([[1, `${yp}a.png`]]))
    expect(calls[0].url.searchParams.get('pageids')).toBe('1|3')
    expect(calls[0].url.searchParams.has('iiurlwidth')).toBe(false)
  })
})
