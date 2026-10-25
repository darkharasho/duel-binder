export type HostRoute = { kind: 'site' } | { kind: 'redirect'; location: string } | { kind: 'app' }

/** The site host serves the page, www.<site host> redirects to it, everything else is the app. */
export function routeHost(url: URL, siteUrl: string): HostRoute {
  const site = new URL(siteUrl)
  if (url.host === site.host) return { kind: 'site' }
  if (url.host === `www.${site.host}`) {
    return { kind: 'redirect', location: `${site.origin}${url.pathname}${url.search}` }
  }
  return { kind: 'app' }
}
