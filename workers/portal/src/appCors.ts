/**
 * CORS for the iOS app, whose pages load from capacitor://localhost and call the portal with a
 * Bearer token. Only that origin and only the routes a Bearer token works on are opened, and never
 * with credentials, so a cookie still can't be spent from another origin.
 */
export const IOS_APP_ORIGIN = 'capacitor://localhost'

const BEARER_ROUTES = [
  /^\/api\//,
  /^\/img\//,
  /^\/scan\/fingerprints$/,
  /^\/auth\/desktop\/(token|revoke)$/
]

const opensTo = (req: Request): boolean =>
  req.headers.get('origin') === IOS_APP_ORIGIN &&
  BEARER_ROUTES.some((re) => re.test(new URL(req.url).pathname))

const ALLOW = {
  'access-control-allow-origin': IOS_APP_ORIGIN,
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE',
  'access-control-allow-headers': 'authorization, content-type, if-none-match',
  'access-control-max-age': '86400',
  vary: 'origin'
}

/** The preflight answer for an app request, or null for anything else. */
export function appPreflight(req: Request): Response | null {
  return req.method === 'OPTIONS' && opensTo(req)
    ? new Response(null, { status: 204, headers: ALLOW })
    : null
}

/** The response, with the app's CORS headers when the request came from it. */
export function withAppCors(req: Request, res: Response): Response {
  if (!opensTo(req)) return res
  const out = new Response(res.body, res)
  out.headers.set('access-control-allow-origin', IOS_APP_ORIGIN)
  // The fingerprint download keeps its ETag for the next If-None-Match.
  out.headers.set('access-control-expose-headers', 'etag, retry-after')
  out.headers.append('vary', 'origin')
  return out
}
