import type { SqlDb } from '../../../src/main/db/sql'
import { adminRoute } from './catalogLoad'
import { rpcRoute } from './rpc'
import { finishSignIn, me, signOut, startSignIn } from './auth'
import { home } from './home'
import { imageRoute, type ImageBucket } from './images'

/** Vars and secrets the request handlers read. */
export interface Env {
  PUBLIC_URL: string
  /** The marketing site, e.g. https://duelbinder.com; the app host borrows its stylesheet. */
  SITE_URL: string
  DISCORD_CLIENT_ID: string
  /** Worker secret; absent from wrangler vars. */
  DISCORD_CLIENT_SECRET: string
  /** Worker secret guarding /admin/*; unset or empty rejects every admin request. */
  ADMIN_TOKEN: string
}

export interface AppDeps {
  db: SqlDb
  images: ImageBucket
  env: Env
  now: () => Date
  fetch: typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function handle(req: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(req.url)
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') return home(req, deps)
  if (req.method === 'GET' && url.pathname === '/api/health') return json({ ok: true })
  if (req.method === 'GET' && url.pathname === '/auth/discord/start') return startSignIn(req, deps)
  if (req.method === 'GET' && url.pathname === '/auth/discord/callback')
    return finishSignIn(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/logout') return signOut(req, deps)
  if (req.method === 'GET' && url.pathname === '/api/me') return me(req, deps)
  if (url.pathname.startsWith('/api/rpc/')) {
    let channel: string
    try {
      channel = decodeURIComponent(url.pathname.slice('/api/rpc/'.length))
    } catch {
      return json({ error: 'bad-channel' }, 400)
    }
    return rpcRoute(req, deps, channel)
  }
  if (url.pathname.startsWith('/img/')) return imageRoute(req, deps, url.pathname.slice('/img/'.length))
  if (url.pathname.startsWith('/admin/')) return adminRoute(req, deps)
  return json({ error: 'Not found' }, 404)
}
