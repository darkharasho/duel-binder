/**
 * The phone app's service worker, at /scan/sw.js with scope /scan/. The app's files are kept in
 * `scan-<build>` so the app opens offline; card images go in `scan-img`; the API, sign-in and the
 * fingerprint file always use the network (the store handles being offline).
 *
 * The build (vite.phone.config.ts) replaces the two placeholders below with the precache list and
 * a hash of the build. It must stay one file with no imports.
 */

// Typed without the webworker lib, which can't share a program with the DOM lib.
interface ExtendableEvent {
  waitUntil(p: Promise<unknown>): void
}
interface FetchEvent {
  request: Request
  respondWith(r: Promise<Response>): void
}
const sw = self as unknown as {
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void
  location: Location
}

const PRECACHE = JSON.parse('__SCAN_PRECACHE__') as string[]
const CACHE = 'scan-__SCAN_BUILD__'
const IMAGES = 'scan-img'
const IMAGE_LIMIT = 2000
const PAGE = '/scan/'

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...PRECACHE, PAGE])))
})

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith('scan-') && n !== CACHE && n !== IMAGES)
            .map((n) => caches.delete(n))
        )
      )
  )
})

async function cacheFirst(req: Request): Promise<Response> {
  return (await caches.match(req)) ?? fetch(req)
}

async function networkFirstPage(req: Request): Promise<Response> {
  try {
    return await fetch(req)
  } catch (err) {
    const cached = await caches.match(PAGE)
    if (cached) return cached
    throw err
  }
}

async function cardImage(req: Request): Promise<Response> {
  const cache = await caches.open(IMAGES)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    await cache.put(req, res.clone())
    // Keys come back oldest first: drop the oldest past the limit.
    const keys = await cache.keys()
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - IMAGE_LIMIT)).map((k) => cache.delete(k))
    )
  }
  return res
}

sw.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== sw.location.origin) return
  const path = url.pathname
  if (req.mode === 'navigate' && path === PAGE) e.respondWith(networkFirstPage(req))
  else if (path.startsWith('/app/scan/')) e.respondWith(cacheFirst(req))
  else if (path.startsWith('/img/small/')) e.respondWith(cardImage(req))
  // Everything else, /api/*, /auth/* and /scan/fingerprints among it, goes to the network.
})
