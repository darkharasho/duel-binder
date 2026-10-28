import { esc, footer, MARK, REPO_URL } from './page'

export interface LegalView {
  appUrl: string
}

export interface LegalPage {
  /** The site path, e.g. /privacy. */
  path: string
  title: string
  description: string
  heading: string
  lead: string
  /** Shown under the lead, e.g. "Last updated October 28, 2026". */
  updated: string
  /** Heading and HTML body of each section, in order. */
  sections: [heading: string, body: string][]
}

function section(heading: string, body: string): string {
  return `<section class="f"><div class="ft"><h2>${heading}</h2></div><div>${body}</div></section>`
}

/** The privacy policy and terms share this page: the site's nav, a header, then titled sections. */
export function renderLegal(page: LegalPage, view: LegalView): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<link rel="canonical" href="https://duelbinder.com${page.path}">
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
<h1>${page.heading}</h1>
<p class="lead">${page.lead}</p>
<p class="meta">${page.updated}</p>
</header>
${page.sections.map(([h, body]) => section(h, body)).join('\n')}
</main>
<div class="wrap">${footer()}</div>
</body>
</html>
`
}
