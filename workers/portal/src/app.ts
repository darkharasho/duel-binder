import type { SqlDb } from '../../../src/main/db/sql'
import { adminHandoffRoute, adminOpenRoute } from './adminHandoff'
import { adminPage } from './adminPage'
import { reportUsage } from './usage'
import { reportError } from './errors'
import { adminRoute } from './catalogLoad'
import type { CostMeter } from './meter'
import { adminMergeRoute } from './merge'
import { adminTestersRoute } from './testers'
import { adminTermsRoute } from './searchTerms'
import { adminBetaRoute, betaSubmitRoute } from './beta'
import { adminReportsRoute } from './reports'
import { adminSeatsRoute } from './seats'
import { fullPage, invitePage, waitlistRoute } from './seatPages'
import { adminAdminsRoute } from './admins'
import { rpcRoute } from './rpc'
import { syncRoute } from './sync'
import { catalogRoute } from './catalogFeed'
import {
  exchangeAppleToken,
  exchangeDesktopCode,
  exchangePhoneToken,
  finishSignIn,
  isAdmin,
  me,
  siteAccount,
  revokeDesktopToken,
  signOut,
  startDesktopSignIn,
  startSignIn
} from './auth'
import { home } from './home'
import type { PrintingArtResolver } from '../../../src/main/yugipedia/artResolver'
import { imageRoute, type ImageBucket, type ImageQuota, type MissCache } from './images'
import type { PriceQueue } from './prices'
import { getFingerprintRefs, getFingerprints } from './scanFiles'
import { phoneRoute } from './phonePage'
import { deleteAccountRoute } from './account'
import type { AppleSignInEnv } from './apple'
import type { TestFlightEnv } from './testflight'
import type { EmailSender } from './emailSend'
import { emailAuthRoute, emailStatusRoute } from './emailAuth'
import { emailClaimPage, emailFormRoute, emailMatchPage, emailStartPage } from './emailPages'
import { appPreflight, withAppCors } from './appCors'
import { stripeWebhookRoute } from './stripe'
import { supporterThanksPage } from './supporterThanks'
import { adminSupportersRoute, supporterNamesRoute } from './supporters'
import { adminTrainingRoute, trainingRoute, type TrainingBucket } from './training'
import { adminTracesRoute, tracesRoute, type TraceBucket } from './traces'

/** Vars and secrets the request handlers read. */
export interface Env extends AppleSignInEnv, TestFlightEnv {
  PUBLIC_URL: string
  /** The marketing site, e.g. https://duelbinder.com; the app host borrows its stylesheet. */
  SITE_URL: string
  DISCORD_CLIENT_ID: string
  /** Worker secret; absent from wrangler vars. */
  DISCORD_CLIENT_SECRET: string
  /** Worker secret guarding /admin/*; unset or empty rejects every admin request. */
  ADMIN_TOKEN: string
  /** The one Discord account whose session opens the /admin dashboard; unset means none does. */
  ADMIN_DISCORD_ID?: string
  /** The eBay price Worker the price alarm asks. */
  PRICE_WORKER_URL: string
  /** The Play opt-in link the beta's "you're in" email gives Android testers. */
  BETA_ANDROID_OPTIN_URL?: string
  /**
   * The Google Group the closed test's testers come from (anyone can join). Set, Android beta
   * requests are let in straight away: the email says join the group, then opt in.
   */
  BETA_ANDROID_GROUP_URL?: string
  /** 'on' turns email + password sign-in on (it also needs `AppDeps.email`). */
  EMAIL_SIGN_IN?: string
  /** Stripe restricted key (secret); unset means supporter checkout can't start. */
  STRIPE_SECRET_KEY?: string
  /** Stripe webhook signing secret (secret); unset means /stripe/webhook answers 404. */
  STRIPE_WEBHOOK_SECRET?: string
  /** The supporter Prices' ids ($3 a month, $25 a year). */
  STRIPE_PRICE_MONTH?: string
  STRIPE_PRICE_YEAR?: string
  /** 'on' opens supporter checkout; anything else hides it (existing supporters keep their badge). */
  SUPPORTER_ENABLED?: string
}

export interface AppDeps {
  db: SqlDb
  /** The static assets binding; the signed-in front page serves the built web app from it. */
  assets: { fetch(req: Request): Promise<Response> }
  images: ImageBucket
  /** Where testers' training photos go (the IMAGES bucket, under training/); absent means uploads answer 503. */
  training?: TrainingBucket
  /** Where donated scan traces go (the IMAGES bucket, under traces/); absent means they answer 503. */
  traces?: TraceBucket
  /** Caps upstream image fetches per user; absent means unlimited. */
  imageQuota?: ImageQuota
  /** Caps signed-out upstream card-image fetches per client address; absent means unlimited. */
  anonImageQuota?: ImageQuota<string>
  /** Card images whose upstream fetch recently failed, so signed-out misses on them answer 404 without fetching; images too big to keep answer 404 for everyone. */
  anonMisses?: MissCache
  printingArt: PrintingArtResolver
  /** The Yugipedia URL of a token image (see TOKEN_ID_MIN); null when it has none. */
  tokenArt?: (imageId: number) => Promise<string | null>
  /** Queues an eBay price run after a write. */
  prices: PriceQueue
  env: Env
  /** Sends sign-in code emails; absent means email sign-in is off. */
  email?: EmailSender
  /** Counts each request's rows and time (meter.ts); absent outside a Durable Object. */
  meter?: CostMeter
  /** Bytes the database takes on disk; absent outside a Durable Object. */
  storageBytes?: () => number
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
  if (req.method === 'POST' && url.pathname === '/auth/apple/token')
    return exchangeAppleToken(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/phone/token')
    return exchangePhoneToken(req, deps)
  if (req.method === 'POST' && url.pathname === '/auth/desktop/revoke')
    return revokeDesktopToken(req, deps)
  if (req.method === 'GET' && url.pathname === '/auth/email/status') return emailStatusRoute(deps)
  if (req.method === 'GET' && url.pathname === '/auth/email') return emailStartPage(req, deps)
  if (req.method === 'GET' && url.pathname === '/auth/email/match') return emailMatchPage(req, deps)
  if (req.method === 'GET' && url.pathname === '/auth/email/claim') return emailClaimPage(req, deps)
  if (req.method === 'POST' && url.pathname.startsWith('/auth/email/form/'))
    return emailFormRoute(req, deps, url.pathname.slice('/auth/email/form/'.length))
  if (req.method === 'POST' && url.pathname.startsWith('/auth/email/'))
    return emailAuthRoute(req, deps, url.pathname.slice('/auth/email/'.length))
  if (req.method === 'GET' && url.pathname === '/api/me') return me(req, deps)
  if (req.method === 'GET' && url.pathname === '/api/site-account') return siteAccount(req, deps)
  if (url.pathname === '/api/account/delete') return deleteAccountRoute(req, deps)
  if (url.pathname === '/api/admin/handoff') return adminHandoffRoute(req, deps)
  if (url.pathname === '/api/usage') return reportUsage(req, deps)
  if (url.pathname === '/api/errors') return reportError(req, deps)
  if (url.pathname === '/stripe/webhook') return stripeWebhookRoute(req, deps)
  if (req.method === 'GET' && url.pathname === '/supporter/thanks')
    return supporterThanksPage(req, deps.env.SITE_URL, deps.env.PUBLIC_URL)
  if (req.method === 'GET' && url.pathname === '/api/supporters/names')
    return supporterNamesRoute(deps)
  if (url.pathname === '/api/traces') return tracesRoute(req, deps, '')
  if (url.pathname.startsWith('/api/traces/'))
    return tracesRoute(req, deps, url.pathname.slice('/api/traces/'.length))
  if (url.pathname.startsWith('/api/training/'))
    return trainingRoute(req, deps, url.pathname.slice('/api/training/'.length))
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
  if (req.method === 'GET' && url.pathname === '/scan/fingerprint-refs')
    return getFingerprintRefs(req, deps)
  if (url.pathname === '/beta') return betaSubmitRoute(req, deps)
  if (url.pathname === '/waitlist') return waitlistRoute(req, deps)
  if (req.method === 'GET' && url.pathname === '/full') return fullPage(req, deps)
  if (req.method === 'GET' && url.pathname.startsWith('/invite/'))
    return invitePage(req, deps, url.pathname.slice('/invite/'.length))
  if (req.method === 'GET' && url.pathname === '/admin')
    return (await isAdmin(req, deps)) ? adminPage() : json({ error: 'Not found' }, 404)
  if (url.pathname === '/admin/open') return adminOpenRoute(req, deps)
  if (url.pathname === '/admin/merges' || url.pathname === '/admin/merges/undo')
    return adminMergeRoute(req, deps)
  if (url.pathname === '/admin/admins' || url.pathname === '/admin/admins/remove')
    return adminAdminsRoute(req, deps)
  if (url.pathname === '/admin/testers' || url.pathname === '/admin/testers/remove')
    return adminTestersRoute(req, deps)
  if (url.pathname === '/admin/beta' || url.pathname.startsWith('/admin/beta/'))
    return adminBetaRoute(req, deps)
  if (url.pathname === '/admin/reports' || url.pathname.startsWith('/admin/reports/'))
    return adminReportsRoute(req, deps)
  if (url.pathname === '/admin/seats' || url.pathname.startsWith('/admin/seats/'))
    return adminSeatsRoute(req, deps)
  if (url.pathname === '/admin/terms' || url.pathname.startsWith('/admin/terms/'))
    return adminTermsRoute(req, deps)
  if (url.pathname === '/admin/training' || url.pathname.startsWith('/admin/training/'))
    return adminTrainingRoute(req, deps)
  if (url.pathname === '/admin/supporters') return adminSupportersRoute(req, deps)
  if (
    url.pathname === '/admin/traces' ||
    url.pathname.startsWith('/admin/traces/') ||
    url.pathname === '/admin/trace-testers' ||
    url.pathname === '/admin/trace-testers/remove'
  )
    return adminTracesRoute(req, deps)
  if (url.pathname.startsWith('/admin/')) return adminRoute(req, deps)
  return json({ error: 'Not found' }, 404)
}
