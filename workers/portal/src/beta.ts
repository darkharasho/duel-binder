import type { AppDeps } from './app'
import { clientIp, takeLimit } from './authLimits'

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
