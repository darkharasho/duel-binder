import { EMAIL_COPY, PASSWORDS_DIFFER, type EmailStep } from '../../../src/shared/emailAuth'
import type { AppDeps } from './app'
import {
  EMAIL_CLAIM_COOKIE,
  EMAIL_CLAIM_PATH,
  EMAIL_LINK_COOKIE,
  EMAIL_LINK_MAX_AGE,
  EMAIL_LINK_PATH,
  SESSION_MAX_AGE,
  clearCookie,
  cookie,
  fromPublicOrigin,
  mintSession,
  readCookie,
  sha256Hex
} from './auth'
import { clientIp } from './authLimits'
import { EmailAuthError, confirmedSignup, matchedAccount, runEmailStep } from './emailAuth'
import { claimKey, peekClaim } from './emailClaim'
import { emailEnabled } from './emailSend'
import { pageShell } from './home'
import { esc } from './site/page'

const FORM = '/auth/email/form'
const MAX_FORM_BYTES = 4096

/** The steps a form can post; link-apple belongs to the Apple app. */
const FORM_STEPS: readonly string[] = [
  'check',
  'password',
  'create',
  'confirm',
  'resend',
  'forgot',
  'reset',
  'separate',
  'link-discord',
  'claim',
  'claim-separate'
]

const PROVIDER_NAME: Record<string, string> = { discord: 'Discord', apple: 'Apple' }
const providerName = (p: string): string => PROVIDER_NAME[p] ?? p

/** What the pages carry between steps (all echoed through `esc`). */
interface Carry {
  email?: string
  ticket?: string
  next?: string
  purpose?: 'signup' | 'reset'
}

const hidden = (name: string, value: string | undefined): string =>
  value ? `<input type="hidden" name="${name}" value="${esc(value)}">` : ''

const carried = (c: Carry): string =>
  hidden('email', c.email) +
  hidden('ticket', c.ticket) +
  hidden('next', c.next === 'scan' ? 'scan' : undefined)

const form = (step: string, c: Carry, inner: string): string =>
  `<form method="post" action="${FORM}/${step}">${carried(c)}${inner}</form>`

const input = (name: string, label: string, attrs: string): string =>
  `<label class="lab" for="${name}">${label}</label><input class="field" id="${name}" name="${name}" ${attrs}>`

const emailField = (c: Carry): string =>
  input(
    'email',
    'Email',
    `type="email" autocomplete="email" required maxlength="254"${c.email ? ` value="${esc(c.email)}"` : ''}`
  )

const NEW_PASSWORD =
  'type="password" autocomplete="new-password" required minlength="8" maxlength="128"'

/** A new password and a second box to confirm it; the form route checks they match. */
const newPassword = (label: string): string =>
  input('password', label, NEW_PASSWORD) +
  input('password_confirm', `Confirm ${label.toLowerCase()}`, NEW_PASSWORD)

const submit = (label: string): string => `<button class="btn pri" type="submit">${label}</button>`
const extra = (label: string, step: string): string =>
  `<button class="btn out" type="submit" formaction="${FORM}/${step}" formnovalidate>${label}</button>`

const note = (error?: string): string =>
  error ? `<p class="note" role="alert">${esc(error)}</p>` : ''

type Page = { title: string; html: string }

function emailPage(c: Carry, error?: string): Page {
  return {
    title: 'Continue with email',
    html: `<h1>Continue with email</h1>
<p class="lead">${esc(EMAIL_COPY.oneBox)}</p>
${note(error)}${form('check', c, `${emailField(c)}<div class="actions">${submit('Continue')}</div>`)}`
  }
}

function passwordPage(c: Carry, error?: string): Page {
  return {
    title: 'Password',
    html: `<h1>Password</h1>
<p class="lead">${esc(c.email ?? '')}</p>
${note(error)}${form(
      'password',
      c,
      `${input('password', 'Password', 'type="password" autocomplete="current-password" required maxlength="128"')}<div class="actions">${submit('Sign in')}${extra('Forgot password?', 'forgot')}</div>`
    )}`
  }
}

function createPage(c: Carry, error?: string): Page {
  return {
    title: 'Create a password',
    html: `<h1>Create a password</h1>
<p class="lead">For ${esc(c.email ?? '')}. At least 8 characters.</p>
${note(error)}${form(
      'create',
      c,
      `${newPassword('Password')}<div class="actions">${submit('Create account')}</div>`
    )}`
  }
}

function codePage(c: Carry, error?: string): Page {
  return {
    title: 'Check your email',
    html: `<h1>Check your email</h1>
<p class="lead">We sent a 6-digit code to ${esc(c.email ?? '')}. It expires in 15 minutes.</p>
${note(error)}${form(
      'confirm',
      c,
      `${hidden('purpose', c.purpose)}${input('code', 'Code', 'type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required')}<div class="actions">${submit('Confirm')}${extra('Send a new code', 'resend')}<a class="btn out" href="/auth/email${c.next === 'scan' ? '?next=scan' : ''}">Back</a></div>`
    )}`
  }
}

function newPasswordPage(c: Carry, error?: string): Page {
  return {
    title: 'Set a new password',
    html: `<h1>Set a new password</h1>
${note(error)}${form(
      'reset',
      c,
      `${newPassword('New password')}<div class="actions">${submit('Set password')}</div>`
    )}`
  }
}

/** `ticket` is left out when it lives in the `email_link` cookie. */
function matchPage(c: Carry, providers: string[], error?: string): Page {
  const hasDiscord = providers.includes('discord')
  const names = providers.map(providerName).join(' and ')
  const link = hasDiscord
    ? form(
        'link-discord',
        c,
        `<div class="actions">${submit('Sign in with Discord to link')}</div>`
      )
    : `<p class="lead">${EMAIL_COPY.linkOnIphone}</p>`
  return {
    title: 'Link your accounts',
    html: `<h1>Link your accounts</h1>
<p class="lead">${esc(EMAIL_COPY.matchProvider(names))}</p>
<p class="lead">${esc(c.email ?? '')}</p>
${note(error)}${link}
${form('separate', c, `<div class="actions"><button class="btn out" type="submit">Make a separate account</button></div>`)}`
  }
}

function claimPage(c: Carry, provider: string, error?: string): Page {
  return {
    title: 'Link your accounts',
    html: `<h1>Link your accounts</h1>
<p class="lead">${esc(EMAIL_COPY.matchClaim(provider))}</p>
<p class="lead">${esc(c.email ?? '')}</p>
${note(error)}${form(
      'claim',
      c,
      `${input('password', 'Password', 'type="password" autocomplete="current-password" required maxlength="128"')}<div class="actions">${submit(`Link ${esc(providerName(provider))} to it`)}${extra('Forgot password?', 'forgot')}${extra('Make a separate account', 'claim-separate')}</div>`
    )}`
  }
}

function respond(deps: AppDeps, page: Page, status = 200, cookies: string[] = []): Response {
  const site = new URL(deps.env.SITE_URL).origin
  const res = new Response(pageShell(deps.env.SITE_URL, page.html, page.title), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // No scripts. The stylesheet and its fonts come from the marketing site. No form-action:
      // a form that redirects on to Discord must be allowed to follow.
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline' ${site}; font-src ${site}; img-src 'self' data: ${site}; base-uri 'none'; frame-ancestors 'none'`
    }
  })
  for (const c of cookies) res.headers.append('set-cookie', c)
  return res
}

const notFound = (): Response => new Response('Not found', { status: 404 })

/** The `next` choice a page carries: only the literal `scan` survives. */
const nextOf = (v: string | null | undefined): string | undefined =>
  v === 'scan' ? 'scan' : undefined

/** The confirmed sign-up a ticket names: its email and the providers that vouched for it. */
async function loadMatch(
  deps: AppDeps,
  ticket: string | null
): Promise<{ email: string; providers: string[] } | null> {
  if (!ticket) return null
  const flow = confirmedSignup(deps.db, await sha256Hex(ticket), deps.now().toISOString())
  if (!flow) return null
  const matched = matchedAccount(deps.db, flow.email)
  return matched ? { email: flow.email, providers: matched.providers } : null
}

/** The web claim the `email_claim` cookie names, or null. */
async function loadClaim(
  deps: AppDeps,
  req: Request
): Promise<{ email: string; provider: string } | null> {
  const ticket = readCookie(req, EMAIL_CLAIM_COOKIE)
  if (!ticket) return null
  const key = await claimKey(ticket, undefined)
  const claim = key && peekClaim(deps.db, key, 'web', deps.now().toISOString())
  return claim ? { email: claim.email, provider: claim.provider } : null
}

/** `GET /auth/email`: the email box. */
export function emailStartPage(req: Request, deps: AppDeps): Response {
  if (!emailEnabled(deps)) return notFound()
  return respond(deps, emailPage({ next: nextOf(new URL(req.url).searchParams.get('next')) }))
}

/** `GET /auth/email/match`: where the Discord callback sends a refused link; the ticket is in the cookie. */
export async function emailMatchPage(req: Request, deps: AppDeps): Promise<Response> {
  if (!emailEnabled(deps)) return notFound()
  const reason = new URL(req.url).searchParams.get('error')
  const match = await loadMatch(deps, readCookie(req, EMAIL_LINK_COOKIE))
  if (!match) return respond(deps, emailPage({}, EMAIL_COPY.codeExpired), 400)
  const error =
    reason === 'also-has'
      ? EMAIL_COPY.alsoHas('email')
      : reason === 'other-account'
        ? EMAIL_COPY.otherAccount('discord')
        : reason === 'expired'
          ? EMAIL_COPY.codeExpired
          : undefined
  return respond(deps, matchPage({ email: match.email }, match.providers, error))
}

/** `GET /auth/email/claim`: a first Discord sign-in whose email an email account uses. */
export async function emailClaimPage(req: Request, deps: AppDeps): Promise<Response> {
  if (!emailEnabled(deps)) return notFound()
  const claim = await loadClaim(deps, req)
  if (!claim) return respond(deps, emailPage({}, EMAIL_COPY.codeExpired), 400)
  return respond(deps, claimPage({ email: claim.email }, claim.provider))
}

/** `POST /auth/email/form/:step`: urlencoded in, the next page (or a redirect) out. */
export async function emailFormRoute(req: Request, deps: AppDeps, step: string): Promise<Response> {
  if (!emailEnabled(deps)) return notFound()
  if (!FORM_STEPS.includes(step)) return notFound()
  if (!fromPublicOrigin(req, deps)) return new Response('Forbidden', { status: 403 })
  const raw = await req.text()
  if (raw.length > MAX_FORM_BYTES) return new Response('Too large', { status: 413 })
  const f: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(raw)) if (!(k in f)) f[k] = v
  const next = nextOf(f.next)
  const email = f.email ?? ''
  const carry: Carry = { email, next }
  // These two read the sign-up's ticket from the email_link cookie when the form has none.
  if (step === 'separate' || step === 'link-discord')
    f.ticket = f.ticket || readCookie(req, EMAIL_LINK_COOKIE) || ''

  if (step === 'link-discord') {
    const match = await loadMatch(deps, f.ticket)
    if (!match) return respond(deps, emailPage(carry, EMAIL_COPY.codeExpired), 400)
    const res = new Response(null, {
      status: 303,
      headers: { location: '/auth/discord/start?link=email' }
    })
    res.headers.append(
      'set-cookie',
      cookie(EMAIL_LINK_COOKIE, f.ticket, EMAIL_LINK_MAX_AGE, EMAIL_LINK_PATH)
    )
    return res
  }

  const claimTicket = readCookie(req, EMAIL_CLAIM_COOKIE) ?? undefined
  try {
    // Pages have no scripts, so the two new-password boxes are compared here.
    if ((step === 'create' || step === 'reset') && f.password !== (f.password_confirm ?? ''))
      throw new EmailAuthError(PASSWORDS_DIFFER, 400)
    const out = await runEmailStep(deps, step as EmailStep, f, {
      ip: clientIp(req),
      claimKind: 'web',
      claimTicket
    })
    switch (out.next) {
      case 'password':
        return respond(deps, passwordPage({ ...carry, email: out.email }))
      case 'create':
        return respond(deps, createPage({ ...carry, email: out.email }))
      case 'code':
        return respond(
          deps,
          codePage({ ...carry, email: out.email, ticket: out.ticket, purpose: out.purpose })
        )
      case 'new-password':
        return respond(deps, newPasswordPage({ ...carry, ticket: out.ticket }))
      case 'match':
        return respond(
          deps,
          matchPage({ ...carry, email: out.email, ticket: out.ticket }, out.providers)
        )
      case 'signed-in': {
        const token = await mintSession(deps, out.userId, 'web', deps.now().toISOString())
        const res = new Response(null, {
          status: 303,
          headers: { location: next === 'scan' ? '/scan/' : '/' }
        })
        res.headers.append('set-cookie', cookie('session', token, SESSION_MAX_AGE))
        res.headers.append('set-cookie', clearCookie(EMAIL_LINK_COOKIE, EMAIL_LINK_PATH))
        res.headers.append('set-cookie', clearCookie(EMAIL_CLAIM_COOKIE, EMAIL_CLAIM_PATH))
        return res
      }
    }
  } catch (err) {
    if (!(err instanceof EmailAuthError)) throw err
    return errorPage(deps, req, step, f, carry, err)
  }
}

/** The same step again, with the copy and the typed email kept. */
async function errorPage(
  deps: AppDeps,
  req: Request,
  step: string,
  f: Record<string, string>,
  carry: Carry,
  err: EmailAuthError
): Promise<Response> {
  const status = err.status === 429 ? 429 : 400
  const msg = err.message
  const done = (page: Page, cookies: string[] = []): Response =>
    respond(deps, page, status, cookies)
  switch (step) {
    case 'password':
      return done(passwordPage(carry, msg))
    case 'create':
      return done(createPage(carry, msg))
    case 'confirm':
    case 'resend':
      return done(
        codePage(
          { ...carry, ticket: f.ticket, purpose: f.purpose === 'reset' ? 'reset' : 'signup' },
          msg
        )
      )
    case 'reset':
      return done(newPasswordPage({ ...carry, ticket: f.ticket }, msg))
    case 'separate': {
      const match = await loadMatch(deps, f.ticket)
      return match
        ? done(matchPage({ ...carry, email: match.email, ticket: f.ticket }, match.providers, msg))
        : done(emailPage(carry, msg))
    }
    case 'claim':
    case 'claim-separate': {
      const claim = err.code === 'expired' ? null : await loadClaim(deps, req)
      if (claim) return done(claimPage({ ...carry, email: claim.email }, claim.provider, msg))
      return done(emailPage(carry, msg), [clearCookie(EMAIL_CLAIM_COOKIE, EMAIL_CLAIM_PATH)])
    }
    default:
      return done(emailPage(carry, msg))
  }
}
