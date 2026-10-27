import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { noNodeBuiltins } from '../../vite.phone.config'

const OUT = resolve('workers/portal/site/app/scan')
/** In src/phone/demo.ts only: the dev-only demo mode must not reach the production build. */
const DEMO_MARKER = 'duel-binder-phone-demo'
/** A line of the card fixture the demo loads. */
const FIXTURE_TEXT = 'The ultimate wizard in terms of attack and defense.'

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })

let built: string[]
const text = (rel: string): string => readFileSync(join(OUT, rel), 'utf8')

beforeAll(() => {
  // Vitest's NODE_ENV=test is passed on: build:phone itself must pin production (no DEV demo).
  execFileSync('npm', ['run', 'build:phone'], { stdio: 'pipe' })
  built = files(OUT).map((f) => relative(OUT, f).split('\\').join('/'))
}, 180_000)

describe('phone build', () => {
  it('output has index.html, sw.js, manifest and the OCR assets', () => {
    for (const f of [
      'index.html',
      'sw.js',
      'manifest.webmanifest',
      'icon-192.png',
      'icon-512.png',
      'ocr/worker.min.js',
      'ocr/core/tesseract-core-lstm.wasm.js',
      'ocr/core/tesseract-core-simd-lstm.wasm.js',
      'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
      'ocr/lang/eng.traineddata.gz',
      'ocr/lang/jpn.traineddata.gz',
      'ocr/lang/kor.traineddata.gz',
      'ocr/lang/chi_sim.traineddata.gz'
    ])
      expect(built, f).toContain(f)
    expect(built.some((f) => /^assets\/sqlite3.*\.wasm$/.test(f))).toBe(true)
    // The data worker is its own bundle.
    expect(built.some((f) => /^assets\/worker-.*\.js$/.test(f))).toBe(true)
  })

  it('index.html has the manifest, the viewport and no CSP meta tag', () => {
    const html = text('index.html')
    expect(html).toContain('<link rel="manifest" href="/scan/manifest.webmanifest"')
    expect(html).toContain('name="apple-mobile-web-app-capable"')
    expect(html).toContain(
      'content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"'
    )
    expect(html).not.toMatch(/Content-Security-Policy/i)
    // The app's files are under /scan/, the service worker's scope (see vite.phone.config.ts).
    expect(html).toMatch(/src="\/scan\/assets\/index-[^"]+\.js"/)
    expect(html).not.toContain('/app/scan/')
  })

  it('the page registers the service worker at /scan/sw.js with scope /scan/', () => {
    const js = built
      .filter((f) => f.startsWith('assets/') && f.endsWith('.js'))
      .map(text)
      .join('\n')
    expect(js).toMatch(/register\((["'`])\/scan\/sw\.js\1,\s*\{\s*scope:\s*(["'`])\/scan\/\2/)
  })

  it('no file references cdn.jsdelivr.net', () => {
    for (const f of built) {
      const body = readFileSync(join(OUT, f))
      expect(body.includes('cdn.jsdelivr.net'), f).toBe(false)
    }
  })

  it('leaves the dev-only demo mode and its fixture out', () => {
    for (const f of built.filter((f) => /\.(js|html)$/.test(f))) {
      expect(text(f).includes(DEMO_MARKER), f).toBe(false)
      expect(text(f).includes(FIXTURE_TEXT), f).toBe(false)
    }
  })

  it('the manifest has start_url and scope /scan/', () => {
    const m = JSON.parse(text('manifest.webmanifest'))
    expect(m).toMatchObject({
      name: 'Duel Binder',
      short_name: 'Duel Binder',
      start_url: '/scan/',
      scope: '/scan/',
      display: 'standalone'
    })
    for (const icon of m.icons as { src: string }[])
      expect(built).toContain(icon.src.replace(/^\/scan\//, ''))
  })

  describe('service worker', () => {
    type Listener = (e: Record<string, unknown>) => void
    interface FakeCache {
      added: string[]
      entries: Map<string, unknown>
    }
    interface FakeCacheApi {
      addAll(urls: string[]): Promise<void>
      match(r: unknown): Promise<unknown>
      put(r: unknown, res: unknown): Promise<void>
      keys(): Promise<{ url: string }[]>
      delete(r: unknown): Promise<boolean>
    }

    /**
     * Runs the built sw.js against fake caches and fetch, and returns its listeners. `wasm` stands
     * in for WebAssembly.validate (the SIMD probes); the default is the real one.
     */
    function loadSw({
      existing = [],
      net = {},
      wasm = (bytes: Uint8Array) => WebAssembly.validate(bytes as Uint8Array<ArrayBuffer>)
    }: {
      existing?: string[]
      /**
       * `status` of every network response (default 200); `failPut` makes cache writes reject;
       * `stalled` holds every response until `release()` (a connection that is up but stuck).
       */
      net?: { offline?: boolean; status?: number; failPut?: boolean; stalled?: boolean }
      wasm?: (bytes: Uint8Array) => boolean
    } = {}): {
      on: Record<string, Listener>
      caches: Map<string, FakeCache>
      fetched: string[]
      /** The timers the worker set, run by hand. */
      timers: { fn: () => void; ms: number; cleared: boolean }[]
      /** Lets the stalled responses through. */
      release(): void
    } {
      const on: Record<string, Listener> = {}
      const caches = new Map<string, FakeCache>()
      const fetched: string[] = []
      const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
      const stalled: (() => void)[] = []
      const open = (name: string): FakeCache => {
        let c = caches.get(name)
        if (!c) caches.set(name, (c = { added: [], entries: new Map() }))
        return c
      }
      for (const name of existing) open(name)
      const keyOf = (r: unknown): string => (typeof r === 'string' ? r : (r as { url: string }).url)
      const cacheApi = (c: FakeCache): FakeCacheApi => ({
        addAll: async (urls: string[]) => {
          c.added.push(...urls)
          for (const u of urls) c.entries.set(new URL(u, 'https://app.test').href, `cached ${u}`)
        },
        match: async (r: unknown) => c.entries.get(new URL(keyOf(r), 'https://app.test').href),
        put: async (r: unknown, res: unknown) => {
          if (net.failPut) throw new DOMException('Quota exceeded', 'QuotaExceededError')
          c.entries.set(new URL(keyOf(r), 'https://app.test').href, res)
        },
        keys: async () => [...c.entries.keys()].map((url) => ({ url })),
        delete: async (r: unknown) => c.entries.delete(new URL(keyOf(r), 'https://app.test').href)
      })
      const context = {
        self: {
          location: { origin: 'https://app.test', href: 'https://app.test/scan/sw.js' },
          addEventListener: (type: string, fn: Listener) => (on[type] = fn)
        },
        caches: {
          open: async (name: string) => cacheApi(open(name)),
          keys: async () => [...caches.keys()],
          delete: async (name: string) => caches.delete(name),
          match: async (r: unknown, opts?: { cacheName?: string }) => {
            const names = opts?.cacheName ? [opts.cacheName] : [...caches.keys()]
            for (const c of names.map((n) => caches.get(n)).filter((c) => c !== undefined)) {
              const hit = await cacheApi(c).match(r)
              if (hit !== undefined) return hit
            }
            return undefined
          }
        },
        fetch: async (r: unknown) => {
          fetched.push(keyOf(r))
          if (net.stalled) await new Promise<void>((resolve) => stalled.push(resolve))
          if (net.offline) throw new TypeError('Failed to fetch')
          const status = net.status ?? 200
          return {
            ok: status >= 200 && status < 300,
            status,
            clone: () => 'network copy',
            body: `network ${keyOf(r)}`
          }
        },
        URL,
        WebAssembly: { validate: wasm },
        setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms, cleared: false }) - 1,
        clearTimeout: (id: number) => {
          if (timers[id]) timers[id].cleared = true
        }
      }
      runInNewContext(text('sw.js'), context)
      const release = (): void => {
        for (const go of stalled.splice(0)) go()
      }
      return { on, caches, fetched, timers, release }
    }

    async function lifecycle(on: Record<string, Listener>, type: string): Promise<void> {
      let wait: Promise<unknown> = Promise.resolve()
      on[type]!({ waitUntil: (p: Promise<unknown>) => (wait = p) })
      await wait
    }

    /** Dispatches a fetch event: its response promise (null if not handled) and its waitUntils. */
    function dispatchFetch(
      on: Record<string, Listener>,
      url: string,
      mode = 'no-cors'
    ): { response: Promise<unknown> | null; waits: Promise<unknown>[] } {
      let response: Promise<unknown> | null = null
      const waits: Promise<unknown>[] = []
      on.fetch!({
        request: { url: new URL(url, 'https://app.test').href, mode, method: 'GET' },
        respondWith: (p: Promise<unknown>) => (response = p),
        waitUntil: (p: Promise<unknown>) => waits.push(p)
      })
      return { response, waits }
    }

    async function fetchEvent(
      on: Record<string, Listener>,
      url: string,
      mode = 'no-cors'
    ): Promise<unknown> {
      const { response, waits } = dispatchFetch(on, url, mode)
      if (response === null) return 'not handled'
      const res = await response
      // The background cache writes: they must never reject.
      await Promise.all(waits)
      return res
    }

    const CORE = (variant: string): string => `/scan/ocr/core/tesseract-core-${variant}lstm.wasm.js`
    /** What the precache leaves out (see NOT_PRECACHED in vite.phone.config.ts). */
    const notPrecached = (f: string): boolean =>
      f === 'sw.js' ||
      f === 'index.html' ||
      /^ocr\/lang\/(jpn|kor|chi_sim)\b/.test(f) ||
      f.startsWith('ocr/core/') ||
      /^assets\/sqlite3-(worker1|opfs-async-proxy)-[^/]*\.js$/.test(f) ||
      f.endsWith('.woff')
    /** The relaxed-SIMD probe holds the relaxed opcode (0xfd 0x80 0x02); the SIMD one doesn't. */
    const isRelaxedProbe = (b: Uint8Array): boolean =>
      [...b].some((x, i) => x === 253 && b[i + 1] === 128 && b[i + 2] === 2)

    async function installed(sw: ReturnType<typeof loadSw>): Promise<string[]> {
      await lifecycle(sw.on, 'install')
      const name = [...sw.caches.keys()].find((n) => n !== 'scan-img')!
      expect(name).toMatch(/^scan-[0-9a-f]{8,}$/)
      return sw.caches.get(name)!.added
    }

    it('install precaches the app, one OCR core and /scan/, and leaves out unused files', async () => {
      const added = await installed(loadSw({ wasm: () => true }))
      const expected = built.filter((f) => !notPrecached(f)).map((f) => `/scan/${f}`)
      expect([...added].sort()).toEqual([...expected, CORE('relaxedsimd-'), '/scan/'].sort())
      expect(added.some((u) => u.endsWith('.woff'))).toBe(false)
      expect(added.some((u) => /sqlite3-(worker1|opfs-async-proxy)/.test(u))).toBe(false)
      // What it leaves out is still built: fetched (and cached) on first use.
      expect(built.some((f) => f.endsWith('.woff'))).toBe(true)
      expect(built.some((f) => f.startsWith('assets/sqlite3-worker1-'))).toBe(true)
    })

    it.each([
      ['relaxed SIMD', () => true, 'relaxedsimd-'],
      ['SIMD only', (b: Uint8Array) => !isRelaxedProbe(b), 'simd-'],
      ['no SIMD', () => false, '']
    ])('install picks the core tesseract will load: %s', async (_name, wasm, variant) => {
      const added = await installed(loadSw({ wasm }))
      expect(added.filter((u) => u.includes('/ocr/core/'))).toEqual([CORE(variant)])
    })

    it('install picks the relaxed-SIMD core with real WebAssembly (V8 has relaxed SIMD)', async () => {
      // tesseract.js makes the same choice from the same probes (wasm-feature-detect 1.x).
      const added = await installed(loadSw())
      expect(added.filter((u) => u.includes('/ocr/core/'))).toEqual([CORE('relaxedsimd-')])
    })

    it('app files that were not precached are cached on first use', async () => {
      const sw = loadSw({ wasm: () => false })
      await installed(sw)
      const font = built.find((f) => f.endsWith('.woff'))!
      for (const u of [CORE('simd-'), `/scan/${font}`]) {
        expect(await fetchEvent(sw.on, u)).toMatchObject({ body: `network https://app.test${u}` })
        expect(await fetchEvent(sw.on, u)).toBe('network copy')
      }
      expect(sw.fetched).toHaveLength(2)
    })

    it('activate deletes the old scan caches and keeps the image cache', async () => {
      const sw = loadSw({ existing: ['scan-old', 'scan-img', 'other'] })
      await lifecycle(sw.on, 'install')
      await lifecycle(sw.on, 'activate')
      const names = [...sw.caches.keys()]
      expect(names).not.toContain('scan-old')
      expect(names).toContain('scan-img')
      expect(names).toContain('other')
      expect(names.filter((n) => /^scan-[0-9a-f]+$/.test(n))).toHaveLength(1)
    })

    it('routes requests: app files cache first, the page network first, the API network only', async () => {
      const sw = loadSw()
      await lifecycle(sw.on, 'install')
      const asset = built.find((f) => f.startsWith('assets/') && f.endsWith('.js'))!
      expect(await fetchEvent(sw.on, `/scan/${asset}`)).toBe(`cached /scan/${asset}`)
      expect(sw.fetched).toEqual([])

      expect(await fetchEvent(sw.on, '/scan/', 'navigate')).toMatchObject({
        body: 'network https://app.test/scan/'
      })

      for (const u of ['/api/sync', '/auth/discord', '/scan/fingerprints'])
        expect(await fetchEvent(sw.on, u)).toBe('not handled')
    })

    it("serves the page's Web Workers and their files from the cache offline", async () => {
      // A Worker's requests go through the service worker whose scope holds the Worker's own URL,
      // so the data, vision and OCR workers (and sqlite's wasm) must live under /scan/ too.
      const net = { offline: false }
      const sw = loadSw({ net, wasm: () => true })
      const added = await installed(sw)
      const needed = [
        built.find((f) => /^assets\/worker-[^/]+\.js$/.test(f)),
        built.find((f) => /^assets\/vision\.worker-[^/]+\.js$/.test(f)),
        built.find((f) => /^assets\/sqlite3[^/]*\.wasm$/.test(f)),
        'ocr/worker.min.js',
        'ocr/lang/eng.traineddata.gz',
        'manifest.webmanifest'
      ]
      net.offline = true
      for (const f of needed) {
        expect(f, String(needed)).toBeDefined()
        expect(added).toContain(`/scan/${f}`)
        expect(await fetchEvent(sw.on, `/scan/${f}`)).toBe(`cached /scan/${f}`)
      }
      expect(await fetchEvent(sw.on, CORE('relaxedsimd-'))).toBe(`cached ${CORE('relaxedsimd-')}`)
      expect(sw.fetched).toEqual([])
    })

    it('the page is network first only for navigations; other /scan/ requests are not cached', async () => {
      const sw = loadSw()
      await lifecycle(sw.on, 'install')
      expect(await fetchEvent(sw.on, '/scan/')).toBe('not handled')
      expect(await fetchEvent(sw.on, '/scan/fingerprints')).toBe('not handled')
    })

    it('on a stalled connection, shows the installed page after 3 s and lets the fetch finish', async () => {
      const net = { stalled: false }
      const sw = loadSw({ net })
      await lifecycle(sw.on, 'install')
      net.stalled = true
      const { response, waits } = dispatchFetch(sw.on, '/scan/', 'navigate')
      let settled = false
      void response!.then(() => (settled = true))
      await Promise.resolve()
      expect(settled).toBe(false)
      const timer = sw.timers.find((t) => !t.cleared)!
      expect(timer.ms).toBe(3000)
      timer.fn()
      expect(await response).toBe('cached /scan/')
      // The network fetch is still kept alive, and it ends without an error.
      expect(sw.fetched).toEqual(['https://app.test/scan/'])
      sw.release()
      await Promise.all(waits)
    })

    it('a page answered in time is the network one, and its timer is cleared', async () => {
      const sw = loadSw()
      await lifecycle(sw.on, 'install')
      expect(await fetchEvent(sw.on, '/scan/', 'navigate')).toMatchObject({
        body: 'network https://app.test/scan/'
      })
      expect(sw.timers.every((t) => t.cleared)).toBe(true)
    })

    it('on a stalled connection with nothing installed, waits for the network', async () => {
      const net = { stalled: true }
      const sw = loadSw({ net })
      const { response } = dispatchFetch(sw.on, '/scan/', 'navigate')
      await Promise.resolve()
      sw.timers.find((t) => !t.cleared)!.fn()
      sw.release()
      expect(await response).toMatchObject({ body: 'network https://app.test/scan/' })
    })

    it('falls back to the cached page offline', async () => {
      const net = { offline: false }
      const sw = loadSw({ net })
      await lifecycle(sw.on, 'install')
      net.offline = true
      expect(await fetchEvent(sw.on, '/scan/', 'navigate')).toBe('cached /scan/')
    })

    it('keeps card images in scan-img, cache first', async () => {
      const sw = loadSw()
      await fetchEvent(sw.on, '/img/small/123.jpg')
      expect(sw.fetched).toEqual(['https://app.test/img/small/123.jpg'])
      expect(sw.caches.get('scan-img')!.entries.size).toBe(1)
      await fetchEvent(sw.on, '/img/small/123.jpg')
      expect(sw.fetched).toHaveLength(1)
    })

    it.each([
      ['a partial (206) response', { status: 206 }],
      ['a cache write that fails', { failPut: true }]
    ])('%s is still returned, and not kept', async (_name, net) => {
      const sw = loadSw({ net, wasm: () => true })
      await installed(sw)
      for (const u of [CORE('simd-'), '/img/small/9.jpg']) {
        expect(await fetchEvent(sw.on, u)).toMatchObject({ body: `network https://app.test${u}` })
        expect(await fetchEvent(sw.on, u)).toMatchObject({ body: `network https://app.test${u}` })
      }
      expect(sw.fetched).toHaveLength(4)
      expect(sw.caches.get('scan-img')?.entries.size ?? 0).toBe(0)
    })

    it('keeps at most 2000 card images, dropping the oldest', async () => {
      const sw = loadSw({ existing: ['scan-img'] })
      const images = sw.caches.get('scan-img')!.entries
      for (let i = 0; i < 2001; i++) images.set(`https://app.test/img/small/${i}.jpg`, 'old')
      await fetchEvent(sw.on, '/img/small/new.jpg')
      expect(images.size).toBe(2000)
      expect(images.has('https://app.test/img/small/0.jpg')).toBe(false)
      expect(images.has('https://app.test/img/small/1.jpg')).toBe(false)
      expect(images.has('https://app.test/img/small/2.jpg')).toBe(true)
      expect(images.has('https://app.test/img/small/new.jpg')).toBe(true)
    })
  })

  it('a Node builtin import fails the build', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phone-build-'))
    try {
      const entry = join(dir, 'entry.js')
      writeFileSync(entry, "import { readFileSync } from 'node:fs'\nconsole.log(readFileSync)\n")
      await expect(
        build({
          configFile: false,
          root: dir,
          logLevel: 'silent',
          plugins: [noNodeBuiltins()],
          build: { write: false, rollupOptions: { input: entry } }
        })
      ).rejects.toThrow(/node:fs/)
      expect(existsSync(join(dir, 'dist'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a package outside the allow-list importing a Node builtin fails the build', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phone-build-'))
    try {
      const pkg = join(dir, 'node_modules', 'some-pkg')
      mkdirSync(pkg, { recursive: true })
      writeFileSync(join(pkg, 'package.json'), '{"name":"some-pkg","main":"index.js"}')
      writeFileSync(join(pkg, 'index.js'), "import fs from 'fs'\nexport default fs\n")
      const entry = join(dir, 'entry.js')
      writeFileSync(entry, "import fs from 'some-pkg'\nconsole.log(fs)\n")
      await expect(
        build({
          configFile: false,
          root: dir,
          logLevel: 'silent',
          plugins: [noNodeBuiltins()],
          build: { write: false, rollupOptions: { input: entry } }
        })
      ).rejects.toThrow(/"fs" \(imported by [^)]*some-pkg/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
