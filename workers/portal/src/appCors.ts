/**
 * CORS for the iOS and Android apps, whose pages load from capacitor://localhost and
 * https://localhost and call the portal with a Bearer token. Only those origins and only the
 * routes a Bearer token works on are opened, and never with credentials, so a cookie still can't
 * be spent from another origin.
 */
export const APP_ORIGINS: readonly string[] = ['capacitor://localhost', 'https://localhost']

const BEARER_ROUTES = [
  /^\/api\//,
  /^\/img\//,
  /^\/scan\/fingerprint(s|-refs)$/,
  /^\/auth\/desktop\/(token|revoke)$/,
  /^\/auth\/apple\/token$/
]

/** The app origin the request came from when it may cross, else null. */
function appOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')
  return origin !== null &&
    APP_ORIGINS.includes(origin) &&
    BEARER_ROUTES.some((re) => re.test(new URL(req.url).pathname))
    ? origin
    : null
}

const allow = (origin: string): Record<string, string> => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE',
  'access-control-allow-headers': 'authorization, content-type, if-none-match, x-duel-game',
  'access-control-max-age': '86400',
  vary: 'origin'
})

/** The preflight answer for an app request, or null for anything else. */
export function appPreflight(req: Request): Response | null {
  const origin = req.method === 'OPTIONS' ? appOrigin(req) : null
  return origin ? new Response(null, { status: 204, headers: allow(origin) }) : null
}

/** The response, with the app's CORS headers when the request came from it. */
export function withAppCors(req: Request, res: Response): Response {
  const origin = appOrigin(req)
  if (!origin) return res
  const out = new Response(res.body, res)
  out.headers.set('access-control-allow-origin', origin)
  // The fingerprint download keeps its ETag for the next If-None-Match.
  out.headers.set('access-control-expose-headers', 'etag, retry-after')
  out.headers.append('vary', 'origin')
  return out
}
