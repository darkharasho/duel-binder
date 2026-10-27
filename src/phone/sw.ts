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
const CORES = '/app/scan/ocr/core/'

/**
 * The OCR core this phone's tesseract.js will load. It decides with wasm-feature-detect's
 * relaxedSimd() and simd(); these are the same probe modules (wasm-feature-detect 1.x).
 */
function ocrCore(): string {
  const valid = (bytes: number[]): boolean => {
    try {
      return WebAssembly.validate(new Uint8Array(bytes))
    } catch {
      return false
    }
  }
  const relaxedSimd = valid([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253,
    15, 65, 2, 253, 15, 253, 128, 2, 11
  ])
  const simd = valid([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
    15, 253, 98, 11
  ])
  const variant = relaxedSimd ? 'relaxedsimd-' : simd ? 'simd-' : ''
  return `${CORES}tesseract-core-${variant}lstm.wasm.js`
}

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...PRECACHE, ocrCore(), PAGE])))
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

/** The app's files: from the cache, else the network, kept for next time (and offline). */
async function cacheFirst(req: Request): Promise<Response> {
  const hit = await caches.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    const copy = res.clone()
    await caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return res
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
