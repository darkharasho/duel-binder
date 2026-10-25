import type { AppDeps } from './app'
import { currentUser } from './auth'
import { MARK, esc } from './site/page'

/** What the app host's front page knows about the visitor. */
export interface HomeView {
  siteUrl: string
  name: string | null
  signInFailed: boolean
}

/** Matches the CSP in src/renderer/web.html; sent as a header so it applies even if the meta tag is edited out. */
const WEB_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"

function body(v: HomeView): string {
  const download = `<a class="btn out" href="${esc(v.siteUrl)}/#download">Get the desktop app</a>`
  if (v.name) {
    return `<h1>Signed in as ${esc(v.name)}.</h1>
<p class="lead">The web app isn't ready yet. When it is, you'll browse your binder and your friends' binders here. Until then, your collection lives in the desktop app.</p>
<div class="actions">${download}<form method="post" action="/auth/logout"><button class="btn out" type="submit">Sign out</button></form></div>`
  }
  const failed = v.signInFailed ? `<p class="note">Sign-in didn't go through. Try again.</p>` : ''
  return `<h1>Duel Binder on the web.</h1>
<p class="lead">Sign in with Discord to save your spot. The web app is on its way; until then, your collection lives in the desktop app.</p>
${failed}<div class="actions"><a class="btn pri" href="/auth/discord/start">Sign in with Discord</a>${download}</div>`
}

/** The placeholder front page of the app host until the web app ships. */
export function renderHome(v: HomeView): string {
  const site = esc(v.siteUrl)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Duel Binder</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${site}/favicon.ico" sizes="48x48">
<link rel="icon" href="${site}/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${site}/site.css">
<style>.note{font-size:13px;color:#e8a87c;margin:-12px 0 20px}form{margin:0}button.btn{font:inherit;font-size:14px;font-weight:500;color:inherit;background:none;cursor:pointer}</style>
</head>
<body>
<div class="wash" aria-hidden="true"><div></div></div>
<nav><div class="wrap navin"><a class="brand" href="${site}">${MARK}Duel Binder</a></div></nav>
<main class="wrap"><header class="hero">
${body(v)}
</header></main>
</body>
</html>
`
}

export async function home(req: Request, deps: AppDeps): Promise<Response> {
  const user = await currentUser(req, deps)
  const row = user
    ? (deps.db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(user.id) as
        | { username: string; display_name: string | null }
        | undefined)
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
    signInFailed: new URL(req.url).searchParams.get('signin') === 'failed'
  })
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })
}
