import type { AppDeps } from './app'
import { adminWriteAllowed, isAdmin, isJson } from './auth'
import { clientIp, takeLimit } from './authLimits'
import { brandedHtml, escapeHtml, para, small, type EmailMessage } from './emailSend'

/**
 * Requests to join the phone app betas. The site's /beta page (site/beta.ts) posts its form here;
 * the owner works through the list in the admin Beta tab and adds people in Play Console or
 * TestFlight by hand.
 */
export type BetaPlatform = 'android' | 'ios'
export type BetaStatus = 'pending' | 'added' | 'declined'

/** What the site's page explains when it gets one back as `?error=`. */
export type BetaError = 'agree' | 'platform' | 'email' | 'name' | 'referred' | 'limit'

const MAX_FIELD = 200

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const isBetaPlatform = (v: unknown): v is BetaPlatform => v === 'android' || v === 'ios'

/** POST /beta: one form from the site; answers with a redirect back to the site's /beta page. */
export async function betaSubmitRoute(req: Request, deps: AppDeps): Promise<Response> {
  const site = new URL(deps.env.SITE_URL).origin
  if (req.method !== 'POST' || req.headers.get('origin') !== site)
    return new Response('Forbidden', { status: 403 })
  const back = (query: string): Response =>
    new Response(null, { status: 303, headers: { location: `${site}/beta?${query}` } })
  const form = await req.formData().catch(() => null)
  if (form === null) return back('error=agree')
  const field = (name: string): string => {
    const v = form.get(name)
    return typeof v === 'string' ? v.trim() : ''
  }
  // Only bots fill the hidden field; they're told it worked.
  if (field('website') !== '') return back('sent=1')

  const platform = field('platform')
  const email = field('email').toLowerCase()
  const name = field('name')
  const referred = field('referred')
  const error: BetaError | null =
    field('agree') !== 'on'
      ? 'agree'
      : !isBetaPlatform(platform)
        ? 'platform'
        : email.length > MAX_FIELD || !EMAIL_SHAPE.test(email)
          ? 'email'
          : name === '' || name.length > MAX_FIELD
            ? 'name'
            : referred.length > MAX_FIELD
              ? 'referred'
              : null
  if (error) return back(`error=${error}`)
  const now = deps.now()
  if (!takeLimit(deps.db, 'beta-ip', clientIp(req), now)) return back('error=limit')
  // Asking again is fine and changes nothing: the first request (and its status) stands.
  deps.db
    .prepare(
      `INSERT OR IGNORE INTO beta_requests (email, platform, name, referred_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, platform, name, referred, now.toISOString())
  return back('sent=1')
}

export interface BetaRequest {
  id: number
  email: string
  platform: BetaPlatform
  name: string
  referredBy: string
  status: BetaStatus
  createdAt: string
  decidedAt: string | null
}

/** The "you're in" email, sent when the owner marks a request added. */
export function betaAddedMessage(
  r: { email: string; name: string; platform: BetaPlatform },
  androidOptIn: string | undefined
): EmailMessage {
  const hi = `Hi ${r.name}, you're in the Duel Binder beta.`
  const steps: string[] =
    r.platform === 'android'
      ? androidOptIn
        ? [
            `On your phone, signed in to Google Play as ${r.email}, open this link and tap "Become a tester":`,
            androidOptIn,
            'Then install Duel Binder from Google Play. It can take a few minutes to show up.'
          ]
        : [
            `Your Google Play account ${r.email} is on the tester list. The link to join is on its way in another email.`
          ]
      : [
          `Apple will email a TestFlight invite to ${r.email}. Install TestFlight from the App Store, then open the invite on your iPhone to install Duel Binder.`
        ]
  const note =
    "It's a test build, so expect the odd rough edge. Your collection syncs to your account; tell us what breaks."
  const html = [para(escapeHtml(hi))]
  for (const s of steps)
    html.push(
      s === androidOptIn
        ? para(
            `<a href="${escapeHtml(s)}" style="color:#c4b5fd;font-weight:600">${escapeHtml(s)}</a>`
          )
        : para(escapeHtml(s))
    )
  html.push(small(escapeHtml(note)))
  return {
    to: r.email,
    subject: "You're in the Duel Binder beta",
    text: [hi, ...steps, note].join('\n\n') + '\n',
    html: brandedHtml("You're in the beta", html.join(''), hi)
  }
}

const SELECT_REQUESTS = `SELECT id, email, platform, name, referred_by AS referredBy, status,
       created_at AS createdAt, decided_at AS decidedAt FROM beta_requests`

/** GET /admin/beta and POST /admin/beta/decide; owner-only, otherwise 404. */
export async function adminBetaRoute(req: Request, deps: AppDeps): Promise<Response> {
  const { db } = deps
  const path = new URL(req.url).pathname
  const notFound = json({ error: 'Not found' }, 404)
  if (!(await isAdmin(req, deps))) return notFound
  if (req.method === 'GET' && path === '/admin/beta') {
    const requests = db
      .prepare(`${SELECT_REQUESTS} ORDER BY status = 'pending' DESC, created_at DESC, id DESC`)
      .all() as BetaRequest[]
    const androidAdded = requests.filter(
      (r) => r.platform === 'android' && r.status === 'added'
    ).length
    return json({ requests, androidAdded })
  }
  if (req.method !== 'POST' || path !== '/admin/beta/decide') return notFound
  if (!adminWriteAllowed(req, deps)) return notFound
  if (!isJson(req)) return json({ error: 'unsupported-media-type' }, 415)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = body?.id
  const status = body?.status
  if (
    typeof id !== 'number' ||
    !Number.isInteger(id) ||
    (status !== 'added' && status !== 'declined')
  )
    return json({ error: 'Bad request' }, 400)
  const row = db.prepare(`${SELECT_REQUESTS} WHERE id = ?`).get(id) as BetaRequest | undefined
  if (!row) return notFound
  if (row.status === status) return json({ ok: true, emailed: false })
  db.prepare('UPDATE beta_requests SET status = ?, decided_at = ? WHERE id = ?').run(
    status,
    deps.now().toISOString(),
    id
  )
  let emailed = false
  if (status === 'added' && deps.email) {
    try {
      await deps.email.send(betaAddedMessage(row, deps.env.BETA_ANDROID_OPTIN_URL))
      emailed = true
    } catch (e) {
      // They're on the list either way; the admin tab says the email didn't go.
      console.error('beta email failed', e)
    }
  }
  return json({ ok: true, emailed })
}
