import type { Me } from '../../../src/shared/cloud'
import { allowedGames, GAMES, isGameId, type GameId } from '../../../src/shared/games'
import type { AppDeps } from './app'
import { appleRefreshToken, verifyAppleIdentityToken } from './apple'
import { attachFromFlow, EmailAuthError } from './emailAuth'
import { claimTarget, makeClaim } from './emailClaim'
import { emailEnabled } from './emailSend'
import { mergedFrom, purgeHolds } from './merge'
import { bindTesterInvites, testerGames } from './testers'
import {
  findAccount,
  signInWith,
  verifiedEmail,
  type DiscordProfile,
  type Identity
} from './signIns'

const DAY_MS = 24 * 60 * 60 * 1000
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60
const STATE_MAX_AGE = 600
const FAILED = '/?signin=failed'
/** Where a web sign-in started with `?next=scan` lands, and where it lands when it fails. */
const NEXT_COOKIE = 'signin_next'
const SCAN_HOME = '/scan/'
const SCAN_FAILED = '/scan/?signin=failed'
/** Desktop tokens last a year and slide forward on use, at most once a day. */
const DESKTOP_TTL_MS = 365 * DAY_MS
const DESKTOP_SLIDE_BELOW_MS = 364 * DAY_MS
const DESKTOP_CODE_TTL_MS = 120_000
const LAST_SEEN_EVERY_MS = 60 * 60 * 1000
const PORT_RE = /^\d{4,5}$/
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
/** Upper bound on the code the token exchange will hash. */
const MAX_CODE_LEN = 128
/** A PKCE code verifier, per RFC 7636 section 4.1. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export const randomToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

const sha256 = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares two strings without an early exit on the first differing character. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

export const cookie = (name: string, value: string, maxAge: number, path = '/'): string =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`
export const clearCookie = (name: string, path = '/'): string => cookie(name, '', 0, path)

/** The raw ticket of a confirmed sign-up that is choosing which account to link its email to. */
export const EMAIL_LINK_COOKIE = 'email_link'
export const EMAIL_LINK_PATH = '/auth'
export const EMAIL_LINK_MAX_AGE = 900
const MATCH_PAGE = '/auth/email/match'

/** The raw ticket of a provider claim: a first Discord sign-in whose email an email account uses. */
export const EMAIL_CLAIM_COOKIE = 'email_claim'
export const EMAIL_CLAIM_PATH = '/auth'
export const EMAIL_CLAIM_MAX_AGE = 900
const CLAIM_PAGE = '/auth/email/claim'

function respond(
  status: number,
  cookies: string[],
  headers: Record<string, string> = {},
  body: string | null = null
): Response {
  const res = new Response(body, { status, headers })
  for (const c of cookies) res.headers.append('set-cookie', c)
  return res
}

const redirect = (location: string, cookies: string[]): Response =>
  respond(302, cookies, { location })

const redirectUri = (deps: AppDeps): string => `${deps.env.PUBLIC_URL}/auth/discord/callback`

export interface SessionUser {
  id: number
  kind: 'web' | 'desktop'
  /** The hash of the token this request carried. */
  tokenHash: string
}

/**
 * The token this request carries: an `Authorization` header, when present, is the only thing
 * read and can only be a desktop token; otherwise the `session` cookie, which can only be a web one.
 */
function requestToken(req: Request): { token: string; kind: SessionUser['kind'] } | null {
  const auth = req.headers.get('authorization')
  if (auth !== null) {
    const m = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(auth.trim())
    return m ? { token: m[1], kind: 'desktop' } : null
  }
  const token = readCookie(req, 'session')
  return token ? { token, kind: 'web' } : null
}

async function findSession(req: Request, deps: AppDeps): Promise<SessionUser | null> {
  const found = requestToken(req)
  if (!found) return null
  const tokenHash = await sha256Hex(found.token)
  const now = deps.now()
  const row = deps.db
    .prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?'
    )
    .get(tokenHash, found.kind, now.toISOString()) as
    { user_id: number; expires_at: string } | undefined
  if (!row) return null
  if (
    found.kind === 'desktop' &&
    Date.parse(row.expires_at) < now.getTime() + DESKTOP_SLIDE_BELOW_MS
  ) {
    deps.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(new Date(now.getTime() + DESKTOP_TTL_MS).toISOString(), tokenHash)
  }
  // Only writes when the stamp is an hour stale, so most requests just read the row.
  deps.db
    .prepare(
      'UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)'
    )
    .run(now.toISOString(), row.user_id, new Date(now.getTime() - LAST_SEEN_EVERY_MS).toISOString())
  return { id: row.user_id, kind: found.kind, tokenHash }
}

/** The signed-in user for this request's desktop Bearer token or web session cookie, or null when absent, unknown, or expired. */
export async function currentUser(req: Request, deps: AppDeps): Promise<SessionUser | null> {
  return findSession(req, deps)
}

/** Opens a session for the account and returns its token (only its hash is stored). */
export async function mintSession(
  deps: AppDeps,
  userId: number,
  kind: SessionUser['kind'],
  nowIso: string
): Promise<string> {
  const token = randomToken()
  const ttl = kind === 'web' ? SESSION_MAX_AGE * 1000 : DESKTOP_TTL_MS
  deps.db
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      await sha256Hex(token),
      userId,
      kind,
      nowIso,
      new Date(new Date(nowIso).getTime() + ttl).toISOString()
    )
  return token
}

function isAdminUser(deps: AppDeps, userId: number): boolean {
  const admin = deps.env.ADMIN_DISCORD_ID
  if (!admin) return false
  return (
    deps.db
      .prepare("SELECT 1 FROM sign_ins WHERE user_id = ? AND provider = 'discord' AND subject = ?")
      .get(userId, admin) !== undefined
  )
}

/**
 * The games this user may use; the server's gate for every game-scoped route. With `asked` (the
 * one game a request names) that is open to everyone, the tester list is not read: the list then
 * leaves out tester-only games, so use it only to check `asked`.
 */
export function gamesFor(deps: AppDeps, userId: number, asked?: string): GameId[] {
  const open = asked !== undefined && isGameId(asked) && GAMES[asked].access === 'everyone'
  return allowedGames({
    isOwner: isAdminUser(deps, userId),
    testerGames: open ? [] : testerGames(deps.db, userId)
  })
}

/** Whether the request is signed in as the ADMIN_DISCORD_ID account. */
export async function isAdmin(req: Request, deps: AppDeps): Promise<boolean> {
  const user = await currentUser(req, deps)
  return user !== null && isAdminUser(deps, user.id)
}

/** The PUBLIC_URL address of this request, or null when the request is already on it. */
function publicBounce(req: Request, deps: AppDeps): string | null {
  // The state cookie must be set on the host Discord sends the user back to (PUBLIC_URL).
  const publicOrigin = new URL(deps.env.PUBLIC_URL).origin
  const url = new URL(req.url)
  return url.origin === publicOrigin ? null : `${publicOrigin}${url.pathname}${url.search}`
}

function discordAuthorize(
  deps: AppDeps,
  state: string,
  extra: Record<string, string> = {}
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: deps.env.DISCORD_CLIENT_ID,
    scope: 'identify email',
    redirect_uri: redirectUri(deps),
    state,
    ...extra
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

export function startSignIn(req: Request, deps: AppDeps): Response {
  const bounce = publicBounce(req, deps)
  if (bounce) return redirect(bounce, [])
  const state = randomToken()
  const cookies = [cookie('oauth_state', state, STATE_MAX_AGE), clearCookie('desktop_auth')]
  // `scan` is the only return path; any other value is ignored, and a leftover choice is dropped.
  if (new URL(req.url).searchParams.get('next') === 'scan')
    cookies.push(cookie(NEXT_COOKIE, 'scan', STATE_MAX_AGE))
  else if (readCookie(req, NEXT_COOKIE) !== null) cookies.push(clearCookie(NEXT_COOKIE))
  // `link=email` keeps the cookie the sign-up page set; any other start drops a leftover one.
  if (
    new URL(req.url).searchParams.get('link') !== 'email' &&
    readCookie(req, EMAIL_LINK_COOKIE) !== null
  )
    cookies.push(clearCookie(EMAIL_LINK_COOKIE, EMAIL_LINK_PATH))
  return redirect(discordAuthorize(deps, state), cookies)
}

/** The iOS and Android apps' sign-in ends at their own URL scheme instead of a loopback port. */
const APP_CALLBACK = 'duelbinder://auth/callback'

/** The phone apps that sign in through the desktop flow, by their `?app=` value. */
type PhoneApp = 'ios' | 'android'
const isPhoneApp = (app: string | null): app is PhoneApp => app === 'ios' || app === 'android'

/** The `desktop_auth` cookie's fourth part when the flow links a sign-in instead of signing in. */
const LINK_INTENT = 'link'
/** A trailing part when the app (`?offer=email`) understands a claim in place of a code. */
const OFFER_PART = 'offer'

interface DesktopAuth {
  /** The desktop app's loopback port, or the phone app ('ios' or 'android'). */
  port: number | PhoneApp
  state: string
  challenge: string
  /** Linking a sign-in to the app's account (`intent=link`): the callback signs nobody in. */
  link: boolean
  /** The app can take a claim (`?claim=&email=`) in place of a code. Never set on a link flow. */
  offer: boolean
}

function checkDesktopAuth(
  port: string | null,
  state: string | null,
  challenge: string | null,
  link: boolean,
  offer = false
): DesktopAuth | null {
  if (port === null || state === null || challenge === null) return null
  if (!STATE_RE.test(state) || !CHALLENGE_RE.test(challenge)) return null
  if (isPhoneApp(port)) return { port, state, challenge, link, offer: offer && !link }
  if (!PORT_RE.test(port)) return null
  const n = Number(port)
  return n >= 1024 && n <= 65535 ? { port: n, state, challenge, link, offer: offer && !link } : null
}

function readDesktopAuth(req: Request): DesktopAuth | null {
  const parts = readCookie(req, 'desktop_auth')?.split('.')
  if (!parts || parts.length < 3 || parts.length > 5) return null
  const extra = parts.slice(3)
  const link = extra.includes(LINK_INTENT)
  const offer = extra.includes(OFFER_PART)
  if (extra.length !== Number(link) + Number(offer)) return null
  return checkDesktopAuth(parts[0], parts[1], parts[2], link, offer)
}

/** Where the desktop flow hands back its code or error: the loopback listener, or the phone app. */
function desktopCallback(desktop: DesktopAuth, params: Record<string, string>): string {
  const base =
    typeof desktop.port === 'number' ? `http://127.0.0.1:${desktop.port}/callback` : APP_CALLBACK
  return `${base}?${new URLSearchParams({ ...params, state: desktop.state })}`
}

/**
 * GET /auth/desktop/start: the desktop app's browser sign-in, which ends at its loopback listener
 * (`?port=`), or the iOS or Android app's, which ends at its URL scheme (`?app=ios` or
 * `?app=android`, no port). With `&intent=link` it links the Discord account to the app's signed-in
 * account instead: the code it hands back is for `account:linkCode`, not the token exchange.
 */
export function startDesktopSignIn(req: Request, deps: AppDeps): Response {
  const q = new URL(req.url).searchParams
  const app = q.get('app')
  const intent = q.get('intent')
  const port = app === null ? q.get('port') : isPhoneApp(app) && !q.has('port') ? app : null
  const auth =
    intent === null || intent === LINK_INTENT
      ? checkDesktopAuth(port, q.get('state'), q.get('challenge'), intent === LINK_INTENT)
      : null
  if (!auth) {
    return respond(
      400,
      [],
      { 'content-type': 'text/plain; charset=utf-8' },
      'This sign-in link is not valid. Start again from the desktop app.'
    )
  }
  const bounce = publicBounce(req, deps)
  if (bounce) return redirect(bounce, [])
  const state = randomToken()
  const offer = !auth.link && q.get('offer') === 'email'
  const value = `${auth.port}.${auth.state}.${auth.challenge}${auth.link ? `.${LINK_INTENT}` : ''}${offer ? `.${OFFER_PART}` : ''}`
  return redirect(discordAuthorize(deps, state, { prompt: 'consent' }), [
    cookie('desktop_auth', value, STATE_MAX_AGE),
    cookie('oauth_state', state, STATE_MAX_AGE)
  ])
}

interface DiscordUser {
  id: string
  username: string
  global_name?: string | null
  avatar?: string | null
  email?: string | null
  verified?: boolean | string
}

async function fetchDiscordUser(code: string, deps: AppDeps): Promise<DiscordUser | null> {
  const tokenRes = await deps.fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: deps.env.DISCORD_CLIENT_ID,
      client_secret: deps.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(deps)
    })
  })
  if (!tokenRes.ok) return null
  const { access_token } = (await tokenRes.json()) as { access_token?: string }
  if (!access_token) return null
  const userRes = await deps.fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${access_token}` }
  })
  if (!userRes.ok) return null
  const user = (await userRes.json()) as DiscordUser
  return user.id && user.username ? user : null
}

/** Signs this Discord user in, making the account on first use. Call inside a transaction. */
function discordSignIn(du: DiscordUser, deps: AppDeps, nowIso: string): number {
  const { userId } = signInWith(
    deps.db,
    { provider: 'discord', subject: du.id },
    {
      username: du.username,
      displayName: du.global_name ?? null,
      avatar: du.avatar ?? null,
      email: verifiedEmail(du.email, du.verified)
    },
    nowIso
  )
  bindTesterInvites(deps.db, userId, du.username)
  return userId
}

/** Drops expired sessions, desktop and link codes, and merge tickets, and purges merge holds past their 30 days. */
export function pruneExpired(deps: AppDeps, nowIso: string): void {
  deps.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso)
  deps.db.prepare('DELETE FROM desktop_codes WHERE expires_at <= ?').run(nowIso)
  deps.db.prepare('DELETE FROM link_codes WHERE expires_at <= ?').run(nowIso)
  deps.db.prepare('DELETE FROM merge_tickets WHERE expires_at <= ?').run(nowIso)
  const hourAgo = new Date(new Date(nowIso).getTime() - 60 * 60 * 1000).toISOString()
  deps.db.prepare('DELETE FROM email_flows WHERE expires_at <= ?').run(nowIso)
  deps.db.prepare('DELETE FROM provider_claims WHERE expires_at <= ?').run(nowIso)
  deps.db.prepare('DELETE FROM auth_limits WHERE created_at <= ?').run(hourAgo)
  purgeHolds(deps.db, new Date(nowIso))
}

export async function finishSignIn(req: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(req.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const desktop = readDesktopAuth(req)
  const toScan = !desktop && readCookie(req, NEXT_COOKIE) === 'scan'
  // Errors never carry Discord's details: the desktop app gets a fixed code, the browser a fixed page.
  const failed = desktop
    ? redirect(desktopCallback(desktop, { error: 'signin-failed' }), [
        clearCookie('oauth_state'),
        clearCookie('desktop_auth')
      ])
    : toScan
      ? redirect(SCAN_FAILED, [clearCookie('oauth_state'), clearCookie(NEXT_COOKIE)])
      : redirect(FAILED, [clearCookie('oauth_state')])
  if (url.searchParams.has('error') || !code || !state || state !== readCookie(req, 'oauth_state'))
    return failed

  let du: DiscordUser | null
  try {
    du = await fetchDiscordUser(code, deps)
  } catch {
    return failed
  }
  if (!du) return failed

  const now = deps.now()
  const nowIso = now.toISOString()
  const secret = randomToken()
  const secretHash = await sha256Hex(secret)
  const user = du
  const codeExpires = new Date(now.getTime() + DESKTOP_CODE_TTL_MS).toISOString()

  if (desktop?.link) {
    // A link only records who Discord says this is; account:linkCode attaches it.
    const profile: DiscordProfile = {
      username: user.username,
      displayName: user.global_name ?? null,
      avatar: user.avatar ?? null
    }
    const email = verifiedEmail(user.email, user.verified)
    if (email) profile.email = email
    deps.db.transaction(() => {
      pruneExpired(deps, nowIso)
      deps.db
        .prepare(
          `INSERT INTO link_codes (code_hash, challenge, provider, subject, profile, expires_at)
           VALUES (?, ?, 'discord', ?, ?, ?)`
        )
        .run(secretHash, desktop.challenge, user.id, JSON.stringify(profile), codeExpires)
    })()
    return redirect(desktopCallback(desktop, { code: secret }), [
      clearCookie('oauth_state'),
      clearCookie('desktop_auth')
    ])
  }

  // A first Discord sign-in whose verified email an email account uses gets a claim instead of
  // an account (the web always; an app only when it asked). See emailClaim.ts.
  const discordEmail = verifiedEmail(user.email, user.verified)
  const claimFor = (kind: 'web' | 'desktop', challenge: string | null): Promise<string> | null => {
    if (!emailEnabled(deps) || discordEmail === null) return null
    if (findAccount(deps.db, { provider: 'discord', subject: user.id }) !== null) return null
    const target = claimTarget(deps.db, discordEmail)
    if (target === null) return null
    return makeClaim(deps, {
      provider: 'discord',
      subject: user.id,
      profile: {
        username: user.username,
        displayName: user.global_name ?? null,
        avatar: user.avatar ?? null,
        email: discordEmail
      },
      email: discordEmail,
      appleRefreshToken: null,
      userId: target,
      challenge,
      kind
    })
  }

  if (desktop) {
    const claim = desktop.offer ? await claimFor('desktop', desktop.challenge) : null
    if (claim !== null)
      return redirect(desktopCallback(desktop, { claim, email: discordEmail! }), [
        clearCookie('oauth_state'),
        clearCookie('desktop_auth')
      ])
    deps.db.transaction(() => {
      pruneExpired(deps, nowIso)
      const userId = discordSignIn(user, deps, nowIso)
      deps.db
        .prepare(
          'INSERT INTO desktop_codes (code_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)'
        )
        .run(secretHash, userId, desktop.challenge, codeExpires)
    })()
    return redirect(desktopCallback(desktop, { code: secret }), [
      clearCookie('oauth_state'),
      clearCookie('desktop_auth')
    ])
  }

  const emailLink = readCookie(req, EMAIL_LINK_COOKIE)
  if (emailLink) {
    // Choosing which account a sign-up's email joins: this Discord sign-in is the proof, and it
    // must already be that account (no account is made here). The attach and the session are one
    // transaction. A refusal keeps the ticket cookie (HttpOnly, so the page can't get it back
    // otherwise); only a gone flow clears it.
    const spent = [clearCookie('oauth_state')]
    const dropLink = clearCookie(EMAIL_LINK_COOKIE, EMAIL_LINK_PATH)
    try {
      await attachFromFlow(
        deps,
        emailLink,
        { provider: 'discord', subject: user.id },
        nowIso,
        (userId) => {
          deps.db
            .prepare(
              "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
            )
            .run(
              secretHash,
              userId,
              nowIso,
              new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString()
            )
        },
        user.username
      )
      const done = [cookie('session', secret, SESSION_MAX_AGE), ...spent, dropLink]
      if (readCookie(req, NEXT_COOKIE) !== null) done.push(clearCookie(NEXT_COOKIE))
      return redirect('/', done)
    } catch (err) {
      if (!(err instanceof EmailAuthError)) throw err
      if (err.code === 'expired')
        return redirect(`${MATCH_PAGE}?error=expired`, [...spent, dropLink])
      return redirect(
        `${MATCH_PAGE}?error=${err.code === 'also-has' ? 'also-has' : 'other-account'}`,
        spent
      )
    }
  }

  const webClaim = await claimFor('web', null)
  if (webClaim !== null)
    return redirect(CLAIM_PAGE, [
      cookie(EMAIL_CLAIM_COOKIE, webClaim, EMAIL_CLAIM_MAX_AGE, EMAIL_CLAIM_PATH),
      clearCookie('oauth_state')
    ])

  deps.db.transaction(() => {
    pruneExpired(deps, nowIso)
    const userId = discordSignIn(user, deps, nowIso)
    deps.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
      )
      .run(
        secretHash,
        userId,
        nowIso,
        new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString()
      )
  })()
  const signedIn = [cookie('session', secret, SESSION_MAX_AGE), clearCookie('oauth_state')]
  if (toScan) return redirect(SCAN_HOME, [...signedIn, clearCookie(NEXT_COOKIE)])
  return redirect('/', signedIn)
}

const jsonResponse = (status: number, body: unknown): Response =>
  respond(
    status,
    [],
    { 'content-type': 'application/json', 'cache-control': 'no-store' },
    JSON.stringify(body)
  )

/**
 * A one-time code's hash, and the PKCE challenge its verifier makes (null when the verifier isn't
 * one, so no stored challenge matches it); null when the code itself can't be one.
 */
export async function codeAndChallenge(
  code: unknown,
  verifier: unknown
): Promise<{ codeHash: string; challenge: string | null } | null> {
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LEN) return null
  const challenge =
    typeof verifier === 'string' && VERIFIER_RE.test(verifier)
      ? toBase64Url(await sha256(verifier))
      : null
  return { codeHash: await sha256Hex(code), challenge }
}

/** POST /auth/desktop/token `{ code, verifier }`: trades a one-time code for a desktop token. The code is spent whatever happens. */
export async function exchangeDesktopCode(req: Request, deps: AppDeps): Promise<Response> {
  const invalid = jsonResponse(400, { error: 'invalid-code' })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return invalid
  }
  const { code, verifier } = (body ?? {}) as { code?: unknown; verifier?: unknown }
  const checked = await codeAndChallenge(code, verifier)
  if (!checked) return invalid
  const { codeHash, challenge } = checked

  const now = deps.now()
  const nowIso = now.toISOString()
  const token = randomToken()
  const tokenHash = await sha256Hex(token)

  const userId = deps.db.transaction((): number | null => {
    pruneExpired(deps, nowIso)
    const row = deps.db
      .prepare('SELECT user_id, challenge, expires_at FROM desktop_codes WHERE code_hash = ?')
      .get(codeHash) as { user_id: number; challenge: string; expires_at: string } | undefined
    deps.db.prepare('DELETE FROM desktop_codes WHERE code_hash = ?').run(codeHash)
    if (
      !row ||
      row.expires_at <= nowIso ||
      challenge === null ||
      !sameString(challenge, row.challenge)
    )
      return null
    deps.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      )
      .run(tokenHash, row.user_id, nowIso, new Date(now.getTime() + DESKTOP_TTL_MS).toISOString())
    return row.user_id
  })()
  if (userId === null) return invalid
  return jsonResponse(200, { token, user: loadMe(deps, userId) })
}

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/
const MAX_NAME_LEN = 64
/** Apple's authorization codes are short; anything longer isn't one. */
const MAX_APPLE_CODE_LEN = 512

/** The name Apple shares on the first sign-in only (and only if the person allows it), or null. */
function appleName(given: unknown, family: unknown): string | null {
  const part = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const name = [part(given), part(family)].filter(Boolean).join(' ').slice(0, MAX_NAME_LEN)
  return name || null
}

/**
 * The Apple user id of a Sign in with Apple result `{ identityToken, nonce, authorizationCode? }`,
 * and the refresh token its authorization code trades for (null when there's none or the trade
 * fails, which is only logged); null when the identity token isn't valid.
 */
export async function verifyAppleSignIn(
  body: unknown,
  deps: AppDeps
): Promise<{ sub: string; email: string | null; refreshToken: string | null } | null> {
  if (body === null || typeof body !== 'object') return null
  const { identityToken, nonce, authorizationCode } = body as Record<string, unknown>
  if (typeof identityToken !== 'string' || typeof nonce !== 'string' || !NONCE_RE.test(nonce))
    return null
  let token: { sub: string; email: string | null } | null
  try {
    token = await verifyAppleIdentityToken(identityToken, nonce, deps)
  } catch {
    token = null
  }
  if (!token) return null
  const { sub, email } = token
  let refreshToken: string | null = null
  if (typeof authorizationCode === 'string' && authorizationCode.length <= MAX_APPLE_CODE_LEN) {
    try {
      refreshToken = await appleRefreshToken(authorizationCode, sub, deps)
    } catch (err) {
      console.warn('Apple code exchange failed', err)
    }
  }
  return { sub, email, refreshToken }
}

/**
 * POST /auth/apple/token `{ identityToken, nonce, authorizationCode?, givenName?, familyName? }`:
 * the iOS app's Sign in with Apple. A valid identity token (apple.ts) signs in its Apple account,
 * made on first use, and gets a desktop-kind Bearer token like the Discord sign-in's. The name,
 * which Apple sends only the first time, fills an empty display name and never overwrites one.
 * The authorization code is traded for a refresh token, kept so deleting the account can revoke
 * it; a failed trade doesn't stop the sign-in.
 */
export async function exchangeAppleToken(req: Request, deps: AppDeps): Promise<Response> {
  const invalid = jsonResponse(400, { error: 'invalid-token' })
  if (!isJson(req)) return jsonResponse(415, { error: 'bad-content-type' })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return invalid
  }
  const { givenName, familyName, offerLink } = (body ?? {}) as Record<string, unknown>
  const verified = await verifyAppleSignIn(body, deps)
  if (!verified) return invalid
  const { sub, email, refreshToken } = verified

  const apple: Identity = { provider: 'apple', subject: sub }
  const name = appleName(givenName, familyName)
  // An app that asked (`offerLink`) is told, instead of getting a new account, when this first
  // sign-in's verified email belongs to an email account. Old apps never ask.
  const target = offerLink === true && emailEnabled(deps) ? claimTarget(deps.db, email) : null
  if (target !== null && email !== null && findAccount(deps.db, apple) === null) {
    const claim = await makeClaim(deps, {
      provider: 'apple',
      subject: sub,
      profile: { displayName: name, avatar: null, email },
      email,
      appleRefreshToken: refreshToken,
      userId: target,
      challenge: null,
      kind: 'desktop'
    })
    return jsonResponse(200, { claim, email, provider: 'apple' })
  }
  const now = deps.now()
  const nowIso = now.toISOString()
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const userId = deps.db.transaction((): number => {
    pruneExpired(deps, nowIso)
    const { userId: id } = signInWith(
      deps.db,
      apple,
      { displayName: name, avatar: null, email },
      nowIso
    )
    deps.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      )
      .run(tokenHash, id, nowIso, new Date(now.getTime() + DESKTOP_TTL_MS).toISOString())
    if (refreshToken)
      deps.db
        .prepare(
          `INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token,
             updated_at = excluded.updated_at`
        )
        .run(id, refreshToken, nowIso)
    return id
  })()
  return jsonResponse(200, { token, user: loadMe(deps, userId) })
}

/**
 * True when the request's Origin is exactly PUBLIC_URL's. A cookie-authenticated request that
 * changes something must pass this, so a cross-site page can't make it with the visitor's cookie.
 */
export function fromPublicOrigin(req: Request, deps: AppDeps): boolean {
  return req.headers.get('origin') === new URL(deps.env.PUBLIC_URL).origin
}

/** The Set-Cookie value that removes the web `session` cookie. */
export const clearSessionCookie = (): string => clearCookie('session')

/** True when the request's media type is exactly application/json (parameters such as charset allowed). */
export function isJson(req: Request): boolean {
  const type = req.headers.get('content-type')
  return type !== null && type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/**
 * POST /auth/phone/token: the phone web app, same-origin and signed in with the web session cookie,
 * trades it for a desktop-kind Bearer token (a year, sliding, revocable like desktop tokens).
 * The Origin must be PUBLIC_URL's exactly and the body JSON, so a cross-site page can't mint one.
 */
export async function exchangePhoneToken(req: Request, deps: AppDeps): Promise<Response> {
  if (!fromPublicOrigin(req, deps)) return jsonResponse(403, { error: 'bad-origin' })
  if (!isJson(req)) return jsonResponse(415, { error: 'bad-content-type' })
  const session = await findSession(req, deps)
  if (!session || session.kind !== 'web') return jsonResponse(401, { error: 'signed-out' })

  const now = deps.now()
  const nowIso = now.toISOString()
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  deps.db.transaction(() => {
    pruneExpired(deps, nowIso)
    deps.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      )
      .run(tokenHash, session.id, nowIso, new Date(now.getTime() + DESKTOP_TTL_MS).toISOString())
  })()
  return jsonResponse(200, { token, user: loadMe(deps, session.id) })
}

/** POST /auth/desktop/revoke with a desktop Bearer token: deletes that one session. */
export async function revokeDesktopToken(req: Request, deps: AppDeps): Promise<Response> {
  const session = await findSession(req, deps)
  if (!session || session.kind !== 'desktop') return jsonResponse(401, { error: 'signed-out' })
  deps.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash)
  return respond(204, [])
}

export async function signOut(req: Request, deps: AppDeps): Promise<Response> {
  const token = readCookie(req, 'session')
  if (token)
    deps.db
      .prepare("DELETE FROM sessions WHERE token_hash = ? AND kind = 'web'")
      .run(await sha256Hex(token))
  // A plain form post (the placeholder page's Sign out button) goes back to the front page.
  if (req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return respond(303, [clearCookie('session')], { location: '/' })
  }
  return respond(204, [clearCookie('session')])
}

export function avatarUrl(discordId: string, avatar: string | null): string | null {
  return avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png` : null
}

/**
 * Who's signed in, for the marketing site's nav: its host is same-site, so it gets the session
 * cookie, and only its origin may read the answer. Just a name and picture; 204 when signed out.
 */
export async function siteAccount(req: Request, deps: AppDeps): Promise<Response> {
  const site = new URL(deps.env.SITE_URL).origin
  const headers: Record<string, string> = { 'cache-control': 'no-store', vary: 'origin' }
  if (req.headers.get('origin') === site) {
    headers['access-control-allow-origin'] = site
    headers['access-control-allow-credentials'] = 'true'
  }
  const user = await currentUser(req, deps)
  if (!user) return new Response(null, { status: 204, headers })
  const { username, displayName, avatarUrl } = loadMe(deps, user.id)
  return new Response(JSON.stringify({ name: displayName ?? username, avatarUrl }), {
    headers: { ...headers, 'content-type': 'application/json' }
  })
}

/**
 * The other provider to suggest linking: only while the hint is on (new accounts), the account has
 * no live collection entries and it has exactly one sign-in.
 */
function linkHintFor(deps: AppDeps, userId: number, hint: number): Me['linkHint'] {
  if (hint !== 1) return null
  const hasCards = deps.db
    .prepare('SELECT 1 FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL LIMIT 1')
    .get(userId)
  if (hasCards) return null
  const signIns = deps.db
    .prepare('SELECT provider FROM sign_ins WHERE user_id = ?')
    .all(userId) as {
    provider: string
  }[]
  if (signIns.length !== 1) return null
  return signIns[0].provider === 'discord'
    ? 'apple'
    : signIns[0].provider === 'apple'
      ? 'discord'
      : null
}

/** The signed-in user's `Me`, as `GET /api/me` answers (without `admin`). */
export function loadMe(deps: AppDeps, userId: number): Me {
  const row = deps.db
    .prepare(
      `SELECT id, discord_id, username, display_name, avatar, username_chosen, link_hint
         FROM users WHERE id = ?`
    )
    .get(userId) as {
    id: number
    discord_id: string
    username: string
    display_name: string | null
    avatar: string | null
    username_chosen: number
    link_hint: number
  }
  const me: Me = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: avatarUrl(row.discord_id, row.avatar),
    games: gamesFor(deps, row.id),
    usernameChosen: row.username_chosen === 1,
    linkHint: linkHintFor(deps, row.id, row.link_hint)
  }
  if (emailEnabled(deps)) me.emailSignIn = true
  // Left out when empty, as old servers do.
  const merged = mergedFrom(deps.db, row.id)
  return merged.length > 0 ? { ...me, mergedFrom: merged } : me
}

export async function me(req: Request, deps: AppDeps): Promise<Response> {
  const user = await currentUser(req, deps)
  if (!user) {
    return respond(
      401,
      [clearCookie('session')],
      { 'content-type': 'application/json' },
      JSON.stringify({ error: 'signed-out' })
    )
  }
  return respond(
    200,
    [],
    { 'content-type': 'application/json' },
    JSON.stringify(
      isAdminUser(deps, user.id) ? { ...loadMe(deps, user.id), admin: true } : loadMe(deps, user.id)
    )
  )
}
