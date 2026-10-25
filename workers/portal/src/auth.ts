import type { AppDeps } from './app'

const SESSION_MAX_AGE = 30 * 24 * 60 * 60
const STATE_MAX_AGE = 600
const FAILED = '/?signin=failed'

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const randomToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
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

function respond(status: number, cookies: string[], headers: Record<string, string> = {}, body: string | null = null): Response {
  const res = new Response(body, { status, headers })
  for (const c of cookies) res.headers.append('set-cookie', c)
  return res
}

const redirect = (location: string, cookies: string[]): Response => respond(302, cookies, { location })

const redirectUri = (deps: AppDeps): string => `${deps.env.PUBLIC_URL}/auth/discord/callback`

/** The signed-in user for this request's session cookie, or null when absent, unknown, or expired. */
export async function currentUser(req: Request, deps: AppDeps): Promise<{ id: number } | null> {
  const token = readCookie(req, 'session')
  if (!token) return null
  const row = deps.db
    .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(await sha256Hex(token), deps.now().toISOString()) as { user_id: number } | undefined
  return row ? { id: row.user_id } : null
}

export function startSignIn(deps: AppDeps): Response {
  const state = randomToken()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: deps.env.DISCORD_CLIENT_ID,
    scope: 'identify',
    redirect_uri: redirectUri(deps),
    state
  })
  return redirect(`https://discord.com/oauth2/authorize?${params}`, [cookie('oauth_state', state, STATE_MAX_AGE)])
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

/** Insert or refresh the user, moving aside a stale row that still holds the same username. */
function upsertUser(du: DiscordUser, deps: AppDeps, nowIso: string): number {
  const run = deps.db.transaction(() => {
    const stale = deps.db
      .prepare('SELECT id, discord_id FROM users WHERE username = ? COLLATE NOCASE AND discord_id <> ?')
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
    return (deps.db.prepare('SELECT id FROM users WHERE discord_id = ?').get(du.id) as { id: number }).id
  })
  return run()
}

export async function finishSignIn(req: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(req.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const failed = redirect(FAILED, [clearCookie('oauth_state')])
  if (url.searchParams.has('error') || !code || !state || state !== readCookie(req, 'oauth_state')) return failed

  let du: DiscordUser | null
  try {
    du = await fetchDiscordUser(code, deps)
  } catch {
    return failed
  }
  if (!du) return failed

  const now = deps.now()
  const nowIso = now.toISOString()
  const userId = upsertUser(du, deps, nowIso)
  const token = randomToken()
  deps.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(await sha256Hex(token), userId, nowIso, new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString())
  return redirect('/', [cookie('session', token, SESSION_MAX_AGE), clearCookie('oauth_state')])
}

export async function signOut(req: Request, deps: AppDeps): Promise<Response> {
  const token = readCookie(req, 'session')
  if (token) deps.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(await sha256Hex(token))
  return respond(204, [clearCookie('session')])
}

export async function me(req: Request, deps: AppDeps): Promise<Response> {
  const user = await currentUser(req, deps)
  if (!user) {
    return respond(401, [clearCookie('session')], { 'content-type': 'application/json' }, JSON.stringify({ error: 'signed-out' }))
  }
  const row = deps.db
    .prepare('SELECT id, discord_id, username, display_name, avatar FROM users WHERE id = ?')
    .get(user.id) as { id: number; discord_id: string; username: string; display_name: string | null; avatar: string | null }
  const body = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar ? `https://cdn.discordapp.com/avatars/${row.discord_id}/${row.avatar}.png` : null
  }
  return respond(200, [], { 'content-type': 'application/json' }, JSON.stringify(body))
}
