import { esc, footer, MARK, REPO_URL } from './page'

export interface PrivacyView {
  appUrl: string
}

const TITLE = 'Privacy — Duel Binder'
const DESCRIPTION = 'What Duel Binder stores about you, why, and how to delete it.'

function section(heading: string, body: string): string {
  return `<section class="f"><div class="ft"><h2>${heading}</h2></div><div>${body}</div></section>`
}

export function renderPrivacy(view: PrivacyView): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="canonical" href="https://duelbinder.com/privacy">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<div class="wash" aria-hidden="true"><div></div></div>
<nav><div class="wrap navin">
<a class="brand" href="/">${MARK}Duel Binder</a>
<a href="${REPO_URL}">GitHub</a>
<span class="grow"></span><a class="signin" href="${esc(view.appUrl)}">Sign in</a>
</div></nav>
<main class="wrap">
<header class="hero">
<h1>Privacy</h1>
<p class="lead">What Duel Binder keeps about you, why, and how to delete it.</p>
</header>
${section(
  'What is stored',
  '<p>When you sign in with Discord, the portal stores your Discord id, username, display name and avatar; your collection, notes and value history; your friends and blocks; and your sign-in sessions.</p>'
)}
${section(
  'Why',
  '<p>It keeps these to sync and show your binder: so your collection is the same on the web, on your computers and on your phone, and so friends you add can look through it.</p>'
)}
${section(
  'What is not done with it',
  '<p>Nothing is sold or used for ads.</p><p>There are no third-party trackers.</p><p>When you scan cards, the camera picture is processed on your phone and never uploaded.</p><p>Card images come through the portal, in every app and on the web, so the sites that host them don’t see you. Two things load from elsewhere: Discord avatars, yours and your friends’, come straight from Discord, and the desktop app checks GitHub for updates.</p>'
)}
${section(
  'Deleting your account',
  '<p>Go to Settings → Delete account, on the web or in the phone app. This removes your synced collection, friends and sign-ins on every device. Desktop apps keep their own copy on that computer and are signed out.</p>'
)}
${section(
  'Contact',
  `<p>Questions or requests: <a href="${REPO_URL}/issues">open an issue on GitHub</a>.</p>`
)}
</main>
<div class="wrap">${footer()}</div>
</body>
</html>
`
}
