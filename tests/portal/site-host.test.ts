import { describe, expect, it, vi } from 'vitest'
import { routeHost } from '../../workers/portal/src/site/host'
import { handleSite } from '../../workers/portal/src/site/handler'
import { pickDownloads, RELEASES_FALLBACK } from '../../workers/portal/src/site/releases'
import { releaseV021 } from './fixtures/release'

const SITE = 'https://duelbinder.com'

describe('routeHost', () => {
  it('serves the apex as the site', () => {
    expect(routeHost(new URL('https://duelbinder.com/'), SITE)).toEqual({ kind: 'site' })
  })
  it('redirects www to the apex keeping path and query', () => {
    expect(routeHost(new URL('https://www.duelbinder.com/some/path?x=1'), SITE)).toEqual({
      kind: 'redirect',
      location: 'https://duelbinder.com/some/path?x=1'
    })
  })
  it('sends every other host to the app', () => {
    for (const u of [
      'https://app.duelbinder.com/api/health',
      'https://duel-binder-portal.project96.workers.dev/',
      'http://localhost:8787/'
    ]) {
      expect(routeHost(new URL(u), SITE)).toEqual({ kind: 'app' })
    }
  })
})

function deps(downloads = pickDownloads(releaseV021)) {
  const assets = { fetch: vi.fn(async () => new Response('css', { status: 218 })) }
  const dl = vi.fn(async () => downloads)
  return { assets, dl, d: { appUrl: 'https://app.duelbinder.com', assets, downloads: dl } }
}

describe('handleSite', () => {
  it('renders the page on / with or without a query', async () => {
    for (const path of ['/', '/?ref=discord']) {
      const { d } = deps()
      const res = await handleSite(new Request(`https://duelbinder.com${path}`), d)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(res.headers.get('cache-control')).toBe('public, max-age=300')
      expect(await res.text()).toContain('A binder for your Yu-Gi-Oh! collection.')
    }
  })

  it('personalizes the download button from the user agent', async () => {
    const { d } = deps()
    const res = await handleSite(
      new Request('https://duelbinder.com/', {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
      }),
      d
    )
    expect(await res.text()).toContain('Download for Windows')
  })

  it('answers HEAD with the GET headers and no body', async () => {
    const { d } = deps()
    const res = await handleSite(new Request('https://duelbinder.com/', { method: 'HEAD' }), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await res.text()).toBe('')
  })

  it('rejects other methods on / with 405', async () => {
    const { d } = deps()
    const res = await handleSite(new Request('https://duelbinder.com/', { method: 'POST' }), d)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('hands every other path to assets without fetching downloads', async () => {
    const { d, assets, dl } = deps()
    const req = new Request('https://duelbinder.com/site.css')
    const res = await handleSite(req, d)
    expect(res.status).toBe(218)
    expect(assets.fetch).toHaveBeenCalledWith(req)
    expect(dl).not.toHaveBeenCalled()
  })

  it('still renders with fallback links when downloads are all null', async () => {
    const { d } = deps({ version: null, windows: null, mac: null, linux: null })
    const res = await handleSite(new Request('https://duelbinder.com/'), d)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain(RELEASES_FALLBACK)
  })
})
