import type { AppDeps } from './app'

/**
 * The phone app's page at /scan/ only: SQLite, OpenCV and tesseract need 'wasm-unsafe-eval' and
 * workers, and the photo pipeline draws from blob: URLs. The desktop web app keeps WEB_CSP.
 */
export const PHONE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.discordapp.com; connect-src 'self'"

/** The /scan/ files served from the built assets, with the headers each needs. */
const FILES: Record<string, { asset: string; headers: Record<string, string> }> = {
  '/scan/': {
    asset: '/app/scan/index.html',
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-security-policy': PHONE_CSP
    }
  },
  '/scan/sw.js': {
    asset: '/app/scan/sw.js',
    headers: {
      'content-type': 'text/javascript',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/scan/'
    }
  },
  '/scan/manifest.webmanifest': {
    asset: '/app/scan/manifest.webmanifest',
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' }
  }
}

async function serveAsset(
  req: Request,
  deps: AppDeps,
  file: (typeof FILES)[string]
): Promise<Response> {
  const res = await deps.assets.fetch(new Request(new URL(file.asset, req.url)))
  if (!res.ok) {
    await res.body?.cancel()
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    })
  }
  return new Response(res.body, { status: 200, headers: file.headers })
}

/** GET /scan, /scan/, /scan/sw.js and /scan/manifest.webmanifest; null for anything else (e.g. /scan/fingerprints). */
export function phoneRoute(req: Request, deps: AppDeps): Promise<Response> | null {
  if (req.method !== 'GET') return null
  const { pathname, search } = new URL(req.url)
  if (pathname === '/scan') {
    return Promise.resolve(
      new Response(null, { status: 301, headers: { location: `/scan/${search}` } })
    )
  }
  const file = FILES[pathname]
  return file ? serveAsset(req, deps, file) : null
}
