import type { AppDeps } from './app'
import { cookie, sha256Hex } from './auth'
import { clientIp, takeLimit } from './authLimits'
import { readForm } from './beta'
import { pageShell } from './home'
import {
  INVITE_DAYS,
  SEAT_INVITE_COOKIE,
  inviteValid,
  joinWaitlist,
  fillSeats,
  seatCounts
} from './seats'
import { esc } from './site/page'

/** What the pages explain when they get one back as `?error=`. */
export type WaitlistError = 'email' | 'limit' | 'bad'

const MAX_FIELD = 200
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ERRORS: Record<WaitlistError, string> = {
  email: 'That email doesn’t look right. Check it and try again.',
  limit: 'Too many requests from this connection today. Try again tomorrow.',
  bad: 'Something went wrong sending the form. Try again.'
}

/** POST /waitlist: from the site's /waitlist page or this host's /full page; answers with a redirect back. */
export async function waitlistRoute(req: Request, deps: AppDeps): Promise<Response> {
  const site = new URL(deps.env.SITE_URL).origin
  const own = new URL(deps.env.PUBLIC_URL).origin
  if (req.method === 'GET')
    return new Response(null, { status: 303, headers: { location: `${site}/waitlist` } })
  const origin = req.headers.get('origin')
  if (req.method !== 'POST' || (origin !== site && origin !== own))
    return new Response('Forbidden', { status: 403 })
  const page = origin === site ? `${site}/waitlist` : `${own}/full`
  const back = (query: string): Response =>
    new Response(null, { status: 303, headers: { location: `${page}?${query}` } })
  const form = await readForm(req)
  if (form === null) return back('error=bad')
  const field = (name: string): string => {
    const v = form.get(name)
    return typeof v === 'string' ? v.trim() : ''
  }
  // Only bots fill the hidden field; they're told it worked.
  if (field('website') !== '') return back('sent=1')
  const email = field('email').toLowerCase()
  if (email.length > MAX_FIELD || !EMAIL_SHAPE.test(email)) return back('error=email')
  const now = deps.now()
  // Asking again changes nothing and doesn't count against the day's limit.
  if (deps.db.prepare('SELECT 1 FROM waitlist WHERE email = ?').get(email)) return back('sent=1')
  if (!takeLimit(deps.db, 'waitlist-ip', clientIp(req), now)) return back('error=limit')
  joinWaitlist(deps.db, email, now.toISOString())
  // A seat is free right now: invite from the front of the line (likely this joiner) at once
  // instead of waiting for the next fill. A failed fill still counts as joined.
  try {
    if (seatCounts(deps.db, now.toISOString()).free > 0) await fillSeats(deps)
  } catch (err) {
    console.error('filling seats after a waitlist join failed', err)
  }
  return back('sent=1')
}

function waitlistForm(deps: AppDeps, req: Request): string {
  const error = new URL(req.url).searchParams.get('error')
  const note = error
    ? `<p class="note" role="alert">${esc(ERRORS[error as WaitlistError] ?? 'Something went wrong. Try again.')}</p>`
    : ''
  return `${note}<form method="post" action="${esc(new URL(deps.env.PUBLIC_URL).origin)}/waitlist">
<label class="lab" for="email">Email</label><input class="field" id="email" name="email" type="email" autocomplete="email" required maxlength="200">
<input name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
<div class="actions"><button class="btn pri" type="submit">Join the waitlist</button></div>
</form>`
}

function respond(
  deps: AppDeps,
  title: string,
  inner: string,
  status = 200,
  cookies: string[] = []
): Response {
  const site = new URL(deps.env.SITE_URL).origin
  const res = new Response(pageShell(deps.env.SITE_URL, inner, title), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline' ${site}; font-src ${site}; img-src 'self' data: ${site}; base-uri 'none'; frame-ancestors 'none'`
    }
  })
  for (const c of cookies) res.headers.append('set-cookie', c)
  return res
}

/** GET /full: where a sign-up the cap refused lands. */
export function fullPage(req: Request, deps: AppDeps): Response {
  const sent = new URL(req.url).searchParams.get('sent') === '1'
  const inner = sent
    ? `<h1>You’re on the list</h1>
<p class="lead">We’ll email you an invite link when a seat opens.</p>`
    : `<h1>Duel Binder is full for now</h1>
<p class="lead">Join the waitlist and we’ll email you an invite link when a seat opens.</p>
${waitlistForm(deps, req)}`
  return respond(deps, 'Duel Binder is full for now', inner)
}

/** GET /invite/<token>: a valid invite sets the cookie the sign-in carries; otherwise 410. */
export async function invitePage(req: Request, deps: AppDeps, token: string): Promise<Response> {
  const now = deps.now()
  const invite = token ? inviteValid(deps.db, await sha256Hex(token), now.toISOString()) : null
  if (!invite)
    return respond(
      deps,
      'Invite expired',
      `<h1>This invite has expired or was used</h1>
<p class="lead">Invites last ${INVITE_DAYS} days and work once. Join the waitlist and we’ll send a new one when a seat opens.</p>
${waitlistForm(deps, req)}`,
      410
    )
  const maxAge = Math.max(1, Math.floor((Date.parse(invite.expiresAt) - now.getTime()) / 1000))
  return respond(
    deps,
    'You’re in',
    `<h1>You’re in</h1>
<p class="lead">A seat is saved for you. Sign in to take it.</p>
<div class="actions"><a class="btn pri" href="/auth/discord/start">Continue with Discord</a><a class="btn out" href="/auth/email">Continue with email</a></div>`,
    200,
    [cookie(SEAT_INVITE_COOKIE, token, maxAge)]
  )
}
