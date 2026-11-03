import type { AppDeps } from './app'
import { currentUser } from './auth'
import { emailEnabled } from './emailSend'
import { MARK, esc } from './site/page'

/** What the app host's front page knows about the visitor. */
export interface HomeView {
  siteUrl: string
  name: string | null
  signInFailed: boolean
  /** Email sign-in is on: offer Continue with email under Discord. */
  emailEnabled?: boolean
}

/** Matches the CSP in src/renderer/web.html; sent as a header so it applies even if the meta tag is edited out. */
export const WEB_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com"

function body(v: HomeView): string {
  const download = `<a class="btn out" href="${esc(v.siteUrl)}/#download">Get the desktop app</a>`
  if (v.name) {
    return `<h1>Signed in as ${esc(v.name)}.</h1>
<p class="lead">The web app couldn't load. Try refreshing; your collection is safe in the desktop app.</p>
<div class="actions">${download}<form method="post" action="/auth/logout"><button class="btn out" type="submit">Sign out</button></form></div>`
  }
  const email = v.emailEnabled ? `<a class="btn out" href="/auth/email">Continue with email</a>` : ''
  const failed = v.signInFailed ? `<p class="note">Sign-in didn't go through. Try again.</p>` : ''
  return `<h1>Duel Binder on the web.</h1>
<p class="lead">Sign in with Discord to open your collection in the browser.</p>
${failed}<div class="actions"><a class="btn pri" href="/auth/discord/start">Sign in with Discord</a>${email}${download}</div>`
}

/** The app host's page shell (the site's stylesheet and header); `inner` is trusted markup. */
export function pageShell(siteUrl: string, inner: string, title = 'Duel Binder'): string {
  const site = esc(siteUrl)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="${site}/site.css">
<style>.note{font-size:13px;color:#e8a87c;margin:-12px 0 20px}form{margin:0}button.btn{font:inherit;font-size:14px;font-weight:500;color:inherit;background:none;cursor:pointer}input.field{display:block;width:100%;max-width:340px;box-sizing:border-box;margin:0 0 16px;padding:10px 12px;font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);border-radius:8px}label.lab{display:block;font-size:13px;margin-bottom:6px;opacity:.8}.actions form{display:inline}</style>
</head>
<body>
<div class="wash" aria-hidden="true"><div></div></div>
<nav><div class="wrap navin"><a class="brand" href="${site}">${MARK}Duel Binder</a></div></nav>
<main class="wrap"><header class="hero">
${inner}
</header></main>
</body>
</html>
`
}

/** The signed-out front page of the app host, and the fallback a signed-in user sees if the web app asset fails to load. */
export function renderHome(v: HomeView): string {
  return pageShell(v.siteUrl, body(v))
}

export async function home(req: Request, deps: AppDeps): Promise<Response> {
  const user = await currentUser(req, deps)
  const row = user
    ? (deps.db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(user.id) as
        { username: string; display_name: string | null } | undefined)
    : undefined
  if (user && (req.method === 'GET' || req.method === 'HEAD')) {
    const res = await deps.assets.fetch(new Request(new URL('/app/web.html', req.url)))
    if (res.ok) {
      return new Response(req.method === 'HEAD' ? null : res.body, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': WEB_CSP
        }
      })
    }
  }
  const html = renderHome({
    siteUrl: deps.env.SITE_URL,
    name: row ? (row.display_name ?? row.username) : null,
    signInFailed: new URL(req.url).searchParams.get('signin') === 'failed',
    emailEnabled: emailEnabled(deps)
  })
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })
}
