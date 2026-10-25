import { detectOs } from './os'
import { renderPage } from './page'
import type { Downloads } from './releases'

const NO_DOWNLOADS: Downloads = { version: null, windows: null, mac: null, linux: null }

export interface SiteDeps {
  appUrl: string
  assets: { fetch(req: Request): Promise<Response> }
  downloads: () => Promise<Downloads>
}

export async function handleSite(req: Request, deps: SiteDeps): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname !== '/') return deps.assets.fetch(req)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  let downloads = NO_DOWNLOADS
  try {
    downloads = await deps.downloads()
  } catch {
    // Keep serving the page without installer links.
  }
  const html = renderPage({
    downloads,
    os: detectOs(req.headers.get('user-agent')),
    appUrl: deps.appUrl
  })
  return new Response(req.method === 'HEAD' ? null : html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, max-age=300' }
  })
}
