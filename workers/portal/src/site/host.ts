export type HostRoute =
  | { kind: 'site' }
  | { kind: 'redirect'; location: string }
  | { kind: 'app' }
  | { kind: 'app-asset' }
  | { kind: 'scan-asset'; asset: string }

/** Icons the app host serves from the shared assets so its pages show the same favicon as the site. */
export const ICON_PATHS = ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']

/**
 * The /scan/ paths the app answers itself (see phonePage.ts and getFingerprints): the page with its
 * CSP, the service worker and manifest with their headers, and the fingerprint file.
 */
const SCAN_ROUTES = [
  '/scan/',
  '/scan/sw.js',
  '/scan/manifest.webmanifest',
  '/scan/fingerprints',
  '/scan/fingerprint-refs'
]

/**
 * The site host serves the page, www.<site host> redirects to it, everything else is the app. The
 * phone app's other files are /scan/<file>, served from the built /app/scan/<file>, so that they
 * sit inside its service worker's /scan/ scope.
 */
export function routeHost(url: URL, siteUrl: string): HostRoute {
  const site = new URL(siteUrl)
  if (url.host === site.host) return { kind: 'site' }
  if (url.host === `www.${site.host}`) {
    return { kind: 'redirect', location: `${site.origin}${url.pathname}${url.search}` }
  }
  if (url.pathname.startsWith('/app/') || ICON_PATHS.includes(url.pathname))
    return { kind: 'app-asset' }
  if (url.pathname.startsWith('/scan/') && !SCAN_ROUTES.includes(url.pathname))
    return { kind: 'scan-asset', asset: `/app${url.pathname}` }
  return { kind: 'app' }
}

/** A Vite build's content-hashed file (`name-<8-char hash>.ext`) under /app/assets/, /app/scan/assets/ or /scan/assets/. */
const HASHED_ASSET_RE = /^\/(?:app\/(?:scan\/)?|scan\/)assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/

/** How long browsers keep a hashed file: its name changes whenever its content does. */
export const HASHED_ASSET_CACHE = 'public, max-age=31536000, immutable'

/**
 * `res` (a static asset served for `pathname`) with a year's cache when the file is content-hashed:
 * Workers Assets sends `max-age=0, must-revalidate` for everything, so each page load re-asked for
 * every script, style and font. Anything else (the HTML, the service worker, icons) is unchanged.
 */
export function withAssetCache(pathname: string, res: Response): Response {
  if (!HASHED_ASSET_RE.test(pathname) || (res.status !== 200 && res.status !== 304)) return res
  const out = new Response(res.body, res)
  out.headers.set('cache-control', HASHED_ASSET_CACHE)
  return out
}
