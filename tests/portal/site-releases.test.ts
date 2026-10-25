import { describe, expect, it, vi } from 'vitest'
import { createReleaseSource, pickDownloads } from '../../workers/portal/src/site/releases'
import { releaseV021 } from './fixtures/release'

const EMPTY = { version: null, windows: null, mac: null, linux: null }
const API = 'https://api.github.com/repos/darkharasho/duel-binder/releases/latest'
const MIN = 60_000

describe('pickDownloads', () => {
  it('picks the installer for each platform from the v0.2.1 release', () => {
    const base = 'https://github.com/darkharasho/duel-binder/releases/download/v0.2.1'
    const n = 'yugioh-collection-tracker-0.2.1'
    expect(pickDownloads(releaseV021)).toEqual({
      version: '0.2.1',
      windows: { name: `${n}-setup.exe`, size: 137045557, url: `${base}/${n}-setup.exe` },
      mac: { name: `${n}.dmg`, size: 252235523, url: `${base}/${n}.dmg` },
      linux: { name: `${n}.AppImage`, size: 146881414, url: `${base}/${n}.AppImage` },
    })
  })

  it('matches differently named assets by suffix', () => {
    const r = {
      tag_name: 'v0.3.0',
      assets: [{ name: 'duel-binder-0.3.0-setup.exe', size: 1, browser_download_url: 'https://x/a' }],
    }
    expect(pickDownloads(r).windows).toEqual({ name: 'duel-binder-0.3.0-setup.exe', size: 1, url: 'https://x/a' })
  })

  it('returns null assets for a release with only yml files', () => {
    const r = { tag_name: 'v1.0.0', assets: releaseV021.assets.filter((a) => a.name.endsWith('.yml')) }
    expect(pickDownloads(r)).toEqual({ version: '1.0.0', windows: null, mac: null, linux: null })
  })

  it('returns the empty shape for garbage input', () => {
    expect(pickDownloads(null)).toEqual(EMPTY)
    expect(pickDownloads({})).toEqual(EMPTY)
    expect(pickDownloads('x')).toEqual(EMPTY)
  })
})

describe('createReleaseSource', () => {
  const setup = (respond: () => Promise<Response>) => {
    let t = new Date('2026-10-24T12:00:00.000Z').getTime()
    const fetchMock = vi.fn(respond)
    const get = createReleaseSource({ fetch: fetchMock as unknown as typeof fetch, now: () => new Date(t) })
    return { get, fetchMock, advance: (ms: number) => { t += ms } }
  }
  const ok = () => Promise.resolve(new Response(JSON.stringify(releaseV021), { status: 200 }))

  it('requests the latest release with the expected headers', async () => {
    const { get, fetchMock } = setup(ok)
    const d = await get()
    expect(d.version).toBe('0.2.1')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(API)
    const h = new Headers(init.headers)
    expect(h.get('accept')).toBe('application/vnd.github+json')
    expect(h.get('user-agent')).toBeTruthy()
  })

  it('caches a success for 60 minutes', async () => {
    const { get, fetchMock, advance } = setup(ok)
    await get()
    advance(59 * MIN)
    await get()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    advance(2 * MIN)
    await get()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  const failures: Array<[string, () => Promise<Response>]> = [
    ['403', async () => new Response('rate limited', { status: 403 })],
    ['500', async () => new Response('boom', { status: 500 })],
    ['network error', async () => { throw new TypeError('network') }],
    ['non-JSON body', async () => new Response('<html>', { status: 200 })],
  ]
  for (const [label, respond] of failures) {
    it(`resolves to empty downloads on ${label} and retries after 5 minutes`, async () => {
      const { get, fetchMock, advance } = setup(respond)
      expect(await get()).toEqual(EMPTY)
      advance(4 * MIN)
      expect(await get()).toEqual(EMPTY)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      advance(2 * MIN)
      expect(await get()).toEqual(EMPTY)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  }
})
