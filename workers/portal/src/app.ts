import type { SqlDb } from '../../../src/main/db/sql'
import { adminRoute } from './catalogLoad'
import { rpcRoute } from './rpc'
import { syncRoute } from './sync'
import { catalogRoute } from './catalogFeed'
import {
  exchangeDesktopCode,
  exchangePhoneToken,
  finishSignIn,
  me,
  revokeDesktopToken,
  signOut,
  startDesktopSignIn,
  startSignIn
} from './auth'
import { home } from './home'
import type { PrintingArtResolver } from '../../../src/main/yugipedia/artResolver'
import { imageRoute, type ImageBucket, type ImageQuota } from './images'
import type { PriceQueue } from './prices'
import { getFingerprints } from './scanFiles'
import { phoneRoute } from './phonePage'
import { deleteAccountRoute } from './account'
import { appPreflight, withAppCors } from './appCors'

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
  /** The eBay price Worker the price alarm asks. */
  PRICE_WORKER_URL: string
}

export interface AppDeps {
  db: SqlDb
  /** The static assets binding; the signed-in front page serves the built web app from it. */
  assets: { fetch(req: Request): Promise<Response> }
  images: ImageBucket
  /** Caps upstream image fetches per user; absent means unlimited. */
  imageQuota?: ImageQuota
  printingArt: PrintingArtResolver
  /** Queues an eBay price run after a write. */
  prices: PriceQueue
  env: Env
  now: () => Date
  fetch: typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function handle(req: Request, deps: AppDeps): Promise<Response> {
  return appPreflight(req) ?? withAppCors(req, await route(req, deps))
}

async function route(req: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(req.url)
  const phone = phoneRoute(req, deps)
  if (phone) return phone
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/')
    return home(req, deps)
  if (req.method === 'GET' && url.pathname === '/api/health') return json({ ok: true })
  if (req.method === 'GET' && url.pathname === '/auth/discord/start') return startSignIn(req, deps)
  if (req.method === 'GET' && url.pathname === '/auth/discord/callback')
    return finishSignIn(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/logout') return signOut(req, deps)
  if (req.method === 'GET' && url.pathname === '/auth/desktop/start')
    return startDesktopSignIn(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/desktop/token')
    return exchangeDesktopCode(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/phone/token')
    return exchangePhoneToken(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/desktop/revoke')
    return revokeDesktopToken(req, deps)
  if (req.method === 'GET' && url.pathname === '/api/me') return me(req, deps)
  if (url.pathname === '/api/account/delete') return deleteAccountRoute(req, deps)
  if (url.pathname.startsWith('/api/rpc/')) {
    let channel: string
    try {
      channel = decodeURIComponent(url.pathname.slice('/api/rpc/'.length))
    } catch {
      return json({ error: 'bad-channel' }, 400)
    }
    return rpcRoute(req, deps, channel)
  }
  if (url.pathname.startsWith('/api/sync/'))
    return syncRoute(req, deps, url.pathname.slice('/api/sync/'.length))
  if (url.pathname.startsWith('/api/catalog/'))
    return catalogRoute(req, deps, url.pathname.slice('/api/catalog/'.length))
  if (url.pathname.startsWith('/img/'))
    return imageRoute(req, deps, url.pathname.slice('/img/'.length))
  if (req.method === 'GET' && url.pathname === '/scan/fingerprints')
    return getFingerprints(req, deps)
  if (url.pathname.startsWith('/admin/')) return adminRoute(req, deps)
  return json({ error: 'Not found' }, 404)
}
