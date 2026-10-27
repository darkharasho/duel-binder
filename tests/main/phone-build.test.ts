import { execFileSync } from 'node:child_process'
import {
  existsSync,
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
  // Vitest sets NODE_ENV=test, which would make Vite build in dev mode (import.meta.env.DEV).
  execFileSync('npm', ['run', 'build:phone'], {
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' }
  })
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
    expect(html).toMatch(/src="\/app\/scan\/assets\/index-[^"]+\.js"/)
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
      expect(built).toContain(icon.src.replace('/app/scan/', ''))
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

    /** Runs the built sw.js against fake caches and fetch, and returns its listeners. */
    function loadSw(
      existing: string[] = [],
      net: { offline: boolean } = { offline: false }
    ): {
      on: Record<string, Listener>
      caches: Map<string, FakeCache>
      fetched: string[]
    } {
      const on: Record<string, Listener> = {}
      const caches = new Map<string, FakeCache>()
      const fetched: string[] = []
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
          match: async (r: unknown) => {
            for (const c of caches.values()) {
              const hit = await cacheApi(c).match(r)
              if (hit !== undefined) return hit
            }
            return undefined
          }
        },
        fetch: async (r: unknown) => {
          fetched.push(keyOf(r))
          if (net.offline) throw new TypeError('Failed to fetch')
          return { ok: true, clone: () => 'network copy', body: `network ${keyOf(r)}` }
        },
        URL
      }
      runInNewContext(text('sw.js'), context)
      return { on, caches, fetched }
    }

    async function lifecycle(on: Record<string, Listener>, type: string): Promise<void> {
      let wait: Promise<unknown> = Promise.resolve()
      on[type]!({ waitUntil: (p: Promise<unknown>) => (wait = p) })
      await wait
    }

    async function fetchEvent(
      on: Record<string, Listener>,
      url: string,
      mode = 'no-cors'
    ): Promise<unknown> {
      let response: Promise<unknown> | null = null
      on.fetch!({
        request: { url: new URL(url, 'https://app.test').href, mode, method: 'GET' },
        respondWith: (p: Promise<unknown>) => (response = p)
      })
      return response === null ? 'not handled' : await response
    }

    it('install precaches every built file but the non-English OCR models, and /scan/', async () => {
      const sw = loadSw()
      await lifecycle(sw.on, 'install')
      const [name] = [...sw.caches.keys()]
      expect(name).toMatch(/^scan-[0-9a-f]{8,}$/)
      const added = sw.caches.get(name!)!.added
      expect(added).toContain('/scan/')
      for (const f of built.filter(
        (f) => f !== 'sw.js' && !/^ocr\/lang\/(jpn|kor|chi_sim)/.test(f)
      ))
        expect(added, f).toContain(`/app/scan/${f}`)
      for (const model of ['jpn', 'kor', 'chi_sim'])
        expect(added.some((u) => u.includes(`ocr/lang/${model}`))).toBe(false)
    })

    it('activate deletes the old scan caches and keeps the image cache', async () => {
      const sw = loadSw(['scan-old', 'scan-img', 'other'])
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
      expect(await fetchEvent(sw.on, `/app/scan/${asset}`)).toBe(`cached /app/scan/${asset}`)
      expect(sw.fetched).toEqual([])

      expect(await fetchEvent(sw.on, '/scan/', 'navigate')).toMatchObject({
        body: 'network https://app.test/scan/'
      })

      for (const u of ['/api/sync', '/auth/discord', '/scan/fingerprints'])
        expect(await fetchEvent(sw.on, u)).toBe('not handled')
    })

    it('falls back to the cached page offline', async () => {
      const net = { offline: false }
      const sw = loadSw([], net)
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
})
