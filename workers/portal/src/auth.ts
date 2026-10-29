import type { Me } from '../../../src/shared/cloud'
import { allowedGames, type GameId } from '../../../src/shared/games'
import type { AppDeps } from './app'
import { appleRefreshToken, verifyAppleIdentityToken } from './apple'

const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_MAX_AGE = 30 * 24 * 60 * 60
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

const randomToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

const sha256 = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares two strings without an early exit on the first differing character. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

const cookie = (name: string, value: string, maxAge: number): string =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
const clearCookie = (name: string): string => cookie(name, '', 0)

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

async function findSession(
  req: Request,
  deps: AppDeps
): Promise<(SessionUser & { tokenHash: string }) | null> {
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
  const session = await findSession(req, deps)
  return session ? { id: session.id, kind: session.kind } : null
}

function isAdminUser(deps: AppDeps, userId: number): boolean {
  const admin = deps.env.ADMIN_DISCORD_ID
  if (!admin) return false
  const row = deps.db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId) as
    { discord_id: string } | undefined
  return row?.discord_id === admin
}

/** The games this user may use; the server's gate for every game-scoped route. */
export function gamesFor(deps: AppDeps, userId: number): GameId[] {
  return allowedGames(isAdminUser(deps, userId))
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
    scope: 'identify',
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
  return redirect(discordAuthorize(deps, state), cookies)
}

/** The iOS app's sign-in ends at its own URL scheme instead of a loopback port. */
const IOS_CALLBACK = 'duelbinder://auth/callback'

interface DesktopAuth {
  /** The desktop app's loopback port, or 'ios' for the iOS app. */
  port: number | 'ios'
  state: string
  challenge: string
}

function checkDesktopAuth(
  port: string | null,
  state: string | null,
  challenge: string | null
): DesktopAuth | null {
  if (port === null || state === null || challenge === null) return null
  if (!STATE_RE.test(state) || !CHALLENGE_RE.test(challenge)) return null
  if (port === 'ios') return { port, state, challenge }
  if (!PORT_RE.test(port)) return null
  const n = Number(port)
  return n >= 1024 && n <= 65535 ? { port: n, state, challenge } : null
}

function readDesktopAuth(req: Request): DesktopAuth | null {
  const parts = readCookie(req, 'desktop_auth')?.split('.')
  return parts?.length === 3 ? checkDesktopAuth(parts[0], parts[1], parts[2]) : null
}

/** Where the desktop flow hands back its code or error: the loopback listener, or the iOS app. */
function desktopCallback(desktop: DesktopAuth, params: Record<string, string>): string {
  const base = desktop.port === 'ios' ? IOS_CALLBACK : `http://127.0.0.1:${desktop.port}/callback`
  return `${base}?${new URLSearchParams({ ...params, state: desktop.state })}`
}

/**
 * GET /auth/desktop/start: the desktop app's browser sign-in, which ends at its loopback listener
 * (`?port=`), or the iOS app's, which ends at its URL scheme (`?app=ios`, no port).
 */
export function startDesktopSignIn(req: Request, deps: AppDeps): Response {
  const q = new URL(req.url).searchParams
  const app = q.get('app')
  const port = app === null ? q.get('port') : app === 'ios' && !q.has('port') ? 'ios' : null
  const auth = checkDesktopAuth(port, q.get('state'), q.get('challenge'))
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
  return redirect(discordAuthorize(deps, state, { prompt: 'consent' }), [
    cookie('desktop_auth', `${auth.port}.${auth.state}.${auth.challenge}`, STATE_MAX_AGE),
    cookie('oauth_state', state, STATE_MAX_AGE)
  ])
}

interface DiscordUser {
  id: string
  username: string
  global_name?: string | null
  avatar?: string | null
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

/** Insert or refresh the user, moving aside a stale row that still holds the same username. Call inside a transaction. */
function upsertUser(du: DiscordUser, deps: AppDeps, nowIso: string): number {
  const stale = deps.db
    .prepare(
      'SELECT id, discord_id FROM users WHERE username = ? COLLATE NOCASE AND discord_id <> ?'
    )
    .get(du.username, du.id) as { id: number; discord_id: string } | undefined
  if (stale) {
    deps.db
      .prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?')
      .run(`${du.username}#${stale.discord_id}`, nowIso, stale.id)
  }
  deps.db
    .prepare(
      `INSERT INTO users (discord_id, username, display_name, avatar, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET
         username = excluded.username, display_name = excluded.display_name,
         avatar = excluded.avatar, updated_at = excluded.updated_at`
    )
    .run(du.id, du.username, du.global_name ?? null, du.avatar ?? null, nowIso, nowIso)
  return (deps.db.prepare('SELECT id FROM users WHERE discord_id = ?').get(du.id) as { id: number })
    .id
}

/** Drops expired sessions and desktop codes. */
function pruneExpired(deps: AppDeps, nowIso: string): void {
  deps.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso)
  deps.db.prepare('DELETE FROM desktop_codes WHERE expires_at <= ?').run(nowIso)
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

  if (desktop) {
    deps.db.transaction(() => {
      pruneExpired(deps, nowIso)
      const userId = upsertUser(user, deps, nowIso)
      deps.db
        .prepare(
          'INSERT INTO desktop_codes (code_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)'
        )
        .run(
          secretHash,
          userId,
          desktop.challenge,
          new Date(now.getTime() + DESKTOP_CODE_TTL_MS).toISOString()
        )
    })()
    return redirect(desktopCallback(desktop, { code: secret }), [
      clearCookie('oauth_state'),
      clearCookie('desktop_auth')
    ])
  }

  deps.db.transaction(() => {
    pruneExpired(deps, nowIso)
    const userId = upsertUser(user, deps, nowIso)
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
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LEN) return invalid
  const codeHash = await sha256Hex(code)

  const now = deps.now()
  const nowIso = now.toISOString()
  const challenge =
    typeof verifier === 'string' && VERIFIER_RE.test(verifier)
      ? toBase64Url(await sha256(verifier))
      : null
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

/**
 * Apple accounts have no Discord id: their `discord_id` is `apple:` and Apple's user id, which
 * can't clash with a Discord id (all digits). Their username is `duelist-` and random letters,
 * which can't clash with a Discord username either (Discord doesn't allow hyphens).
 */
const APPLE_ID_PREFIX = 'apple:'
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/
const MAX_NAME_LEN = 64
/** Apple's authorization codes are short; anything longer isn't one. */
const MAX_APPLE_CODE_LEN = 512
const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

function appleUsername(deps: AppDeps): string {
  const taken = deps.db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
  for (;;) {
    const letters = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => USERNAME_ALPHABET[b % USERNAME_ALPHABET.length])
      .join('')
    const name = `duelist-${letters}`
    if (!taken.get(name)) return name
  }
}

/** The name Apple shares on the first sign-in only (and only if the person allows it), or null. */
function appleName(given: unknown, family: unknown): string | null {
  const part = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const name = [part(given), part(family)].filter(Boolean).join(' ').slice(0, MAX_NAME_LEN)
  return name || null
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
  const { identityToken, nonce, authorizationCode, givenName, familyName } = (body ?? {}) as Record<
    string,
    unknown
  >
  if (typeof identityToken !== 'string' || typeof nonce !== 'string' || !NONCE_RE.test(nonce))
    return invalid
  let sub: string | null
  try {
    sub = await verifyAppleIdentityToken(identityToken, nonce, deps)
  } catch {
    sub = null
  }
  if (!sub) return invalid
  let refreshToken: string | null = null
  if (typeof authorizationCode === 'string' && authorizationCode.length <= MAX_APPLE_CODE_LEN) {
    try {
      refreshToken = await appleRefreshToken(authorizationCode, sub, deps)
    } catch (err) {
      console.warn('Apple code exchange failed', err)
    }
  }

  const appleId = APPLE_ID_PREFIX + sub
  const name = appleName(givenName, familyName)
  const now = deps.now()
  const nowIso = now.toISOString()
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const userId = deps.db.transaction((): number => {
    pruneExpired(deps, nowIso)
    const found = deps.db.prepare('SELECT id FROM users WHERE discord_id = ?').get(appleId) as
      { id: number } | undefined
    let id: number
    if (found) {
      id = found.id
      deps.db
        .prepare(
          'UPDATE users SET display_name = COALESCE(display_name, ?), updated_at = ? WHERE id = ?'
        )
        .run(name, nowIso, id)
    } else {
      deps.db
        .prepare(
          `INSERT INTO users (discord_id, username, display_name, avatar, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?)`
        )
        .run(appleId, appleUsername(deps), name, nowIso, nowIso)
      id = (
        deps.db.prepare('SELECT id FROM users WHERE discord_id = ?').get(appleId) as {
          id: number
        }
      ).id
    }
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
function isJson(req: Request): boolean {
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

function loadMe(deps: AppDeps, userId: number): Me {
  const row = deps.db
    .prepare('SELECT id, discord_id, username, display_name, avatar FROM users WHERE id = ?')
    .get(userId) as {
    id: number
    discord_id: string
    username: string
    display_name: string | null
    avatar: string | null
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: avatarUrl(row.discord_id, row.avatar),
    games: gamesFor(deps, row.id)
  }
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
