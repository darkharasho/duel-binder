import { describe, expect, it, vi, type Mock } from 'vitest'
import { routeHost } from '../../workers/portal/src/site/host'
import { handleSite } from '../../workers/portal/src/site/handler'
import {
  pickDownloads,
  RELEASES_FALLBACK,
  type Downloads
} from '../../workers/portal/src/site/releases'
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
  it('sends app-host /app/ paths straight to assets', () => {
    for (const p of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']) {
      expect(routeHost(new URL(`https://app.duelbinder.com${p}`), SITE)).toEqual({
        kind: 'app-asset'
      })
    }
    expect(routeHost(new URL('https://app.duelbinder.com/app/assets/x.js'), SITE)).toEqual({
      kind: 'app-asset'
    })
    expect(routeHost(new URL('https://app.duelbinder.com/'), SITE)).toEqual({ kind: 'app' })
  })
  it("serves the phone app's files at /scan/<file> from the built /app/scan/<file>", () => {
    for (const p of [
      '/scan/assets/worker-abc.js',
      '/scan/assets/sqlite3-abc.wasm',
      '/scan/ocr/worker.min.js',
      '/scan/ocr/core/tesseract-core-simd-lstm.wasm.js',
      '/scan/index.html',
      '/scan/icon-192.png'
    ]) {
      expect(routeHost(new URL(`https://app.duelbinder.com${p}`), SITE)).toEqual({
        kind: 'scan-asset',
        asset: `/app${p}`
      })
    }
  })
  it('leaves the /scan/ routes with their own headers to the app', () => {
    for (const p of [
      '/scan',
      '/scan/',
      '/scan/sw.js',
      '/scan/manifest.webmanifest',
      '/scan/fingerprints',
      '/scan/fingerprint-refs'
    ]) {
      expect(routeHost(new URL(`https://app.duelbinder.com${p}?x=1`), SITE)).toEqual({
        kind: 'app'
      })
    }
    // On the site host, /scan/ paths are the site's.
    expect(routeHost(new URL('https://duelbinder.com/scan/assets/x.js'), SITE)).toEqual({
      kind: 'site'
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

function deps(downloads = pickDownloads(releaseV021)): {
  assets: { fetch: Mock<(req: Request) => Promise<Response>> }
  dl: Mock<() => Promise<Downloads>>
  d: Parameters<typeof handleSite>[1]
} {
  const assets = {
    fetch: vi.fn<(req: Request) => Promise<Response>>(
      async () => new Response('css', { status: 218 })
    )
  }
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
      expect(res.headers.get('cache-control')).toBe('private, max-age=300')
      expect(await res.text()).toContain(
        'A binder for your <span class="nowrap">Yu-Gi-Oh!</span> collection.'
      )
    }
  })

  it('personalizes the download button from the user agent', async () => {
    const { d } = deps()
    const res = await handleSite(
      new Request('https://duelbinder.com/', {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
        }
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
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
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

  it('answers 404 for /app/* on the site host without touching assets', async () => {
    const { d, assets } = deps()
    const res = await handleSite(new Request('https://duelbinder.com/app/web.html'), d)
    expect(res.status).toBe(404)
    expect(assets.fetch).not.toHaveBeenCalled()
  })

  it('serves fonts with an open CORS header for the app host', async () => {
    const { d } = deps()
    const res = await handleSite(new Request('https://duelbinder.com/fonts/a.woff2'), d)
    expect(res.status).toBe(218)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.text()).toBe('css')
  })

  it('still renders with fallback links when downloads are all null', async () => {
    const { d } = deps({ version: null, windows: null, mac: null, linux: null })
    const res = await handleSite(new Request('https://duelbinder.com/'), d)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain(RELEASES_FALLBACK)
  })

  it('serves the privacy page on /privacy', async () => {
    const { d, assets, dl } = deps()
    const res = await handleSite(new Request('https://duelbinder.com/privacy'), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('<h1>Privacy</h1>')
    expect(assets.fetch).not.toHaveBeenCalled()
    expect(dl).not.toHaveBeenCalled()
    const head = await handleSite(
      new Request('https://duelbinder.com/privacy', { method: 'HEAD' }),
      d
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const post = await handleSite(
      new Request('https://duelbinder.com/privacy', { method: 'POST' }),
      d
    )
    expect(post.status).toBe(405)
  })

  it('serves the terms page on /terms', async () => {
    const { d, assets, dl } = deps()
    const res = await handleSite(new Request('https://duelbinder.com/terms'), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('<h1>Terms of Service</h1>')
    expect(assets.fetch).not.toHaveBeenCalled()
    expect(dl).not.toHaveBeenCalled()
  })
})
