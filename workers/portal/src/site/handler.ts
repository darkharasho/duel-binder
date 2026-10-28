import { detectOs } from './os'
import { renderPage } from './page'
import { renderPrivacy } from './privacy'
import { renderTerms } from './terms'
import type { Downloads } from './releases'

const NO_DOWNLOADS: Downloads = { version: null, windows: null, mac: null, linux: null }

export interface SiteDeps {
  appUrl: string
  assets: { fetch(req: Request): Promise<Response> }
  downloads: () => Promise<Downloads>
}

export async function handleSite(req: Request, deps: SiteDeps): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname.startsWith('/fonts/')) {
    // The app host's pages load these through the site stylesheet, so they're fetched cross-origin.
    const asset = await deps.assets.fetch(req)
    const res = new Response(asset.body, asset)
    res.headers.set('access-control-allow-origin', '*')
    return res
  }
  // The built web app lives under /app/ and belongs to the app host only.
  if (url.pathname.startsWith('/app/')) return new Response('Not Found', { status: 404 })
  if (url.pathname !== '/' && url.pathname !== '/privacy' && url.pathname !== '/terms')
    return deps.assets.fetch(req)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  if (url.pathname === '/privacy') return html(req, renderPrivacy({ appUrl: deps.appUrl }))
  if (url.pathname === '/terms') return html(req, renderTerms({ appUrl: deps.appUrl }))
  let downloads = NO_DOWNLOADS
  try {
    downloads = await deps.downloads()
  } catch {
    // Keep serving the page without installer links.
  }
  return html(
    req,
    renderPage({ downloads, os: detectOs(req.headers.get('user-agent')), appUrl: deps.appUrl })
  )
}

function html(req: Request, body: string): Response {
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, max-age=300' }
  })
}
