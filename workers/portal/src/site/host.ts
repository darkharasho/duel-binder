export type HostRoute = { kind: 'site' } | { kind: 'redirect'; location: string } | { kind: 'app' } | { kind: 'app-asset' }

/** Icons the app host serves from the shared assets so its pages show the same favicon as the site. */
export const ICON_PATHS = ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']

/** The site host serves the page, www.<site host> redirects to it, everything else is the app. */
export function routeHost(url: URL, siteUrl: string): HostRoute {
  const site = new URL(siteUrl)
  if (url.host === site.host) return { kind: 'site' }
  if (url.host === `www.${site.host}`) {
    return { kind: 'redirect', location: `${site.origin}${url.pathname}${url.search}` }
  }
  if (url.pathname.startsWith('/app/') || ICON_PATHS.includes(url.pathname)) return { kind: 'app-asset' }
  return { kind: 'app' }
}
