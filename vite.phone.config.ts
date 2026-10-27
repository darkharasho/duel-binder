import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The phone app, at app.duelbinder.com/scan/. Its files are built into site/app/scan/, and the
 * portal serves them at /scan/<file>: every file the page and its Web Workers load is then inside
 * the service worker's /scan/ scope, so the app opens offline (a Worker's own requests go through
 * the service worker whose scope holds the Worker's URL, not the page's).
 */
const BASE = '/scan/'
const PUBLIC_DIR = resolve('src/phone/public')
const OCR_MODELS = ['eng', 'jpn', 'kor', 'chi_sim']
/**
 * Built files the service worker doesn't install up front:
 * - the non-English OCR models: tesseract fetches (and keeps) one on first use;
 * - the three OCR cores: sw.ts installs only the one this phone's tesseract will load;
 * - sqlite's OPFS proxy and Worker1 scripts: the data worker uses the SAH pool VFS, and the page
 *   isn't cross-origin isolated, so sqlite never loads them;
 * - the legacy .woff fonts: every browser that runs the app takes the .woff2.
 * Anything under /scan/ that is fetched anyway is cached on first use.
 */
const NOT_PRECACHED = [
  // The page is cached as /scan/, with its CSP; the bare file would be a copy without it.
  /^index\.html$/,
  /^ocr\/lang\/(jpn|kor|chi_sim)\b/,
  /^ocr\/core\//,
  /^assets\/sqlite3-(worker1|opfs-async-proxy)-[^/]*\.js$/,
  /\.woff$/
]
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

const STUB = '\0node-builtin-stub'

/**
 * Packages allowed to import Node builtins, which get an empty module: OpenCV's Emscripten build
 * reaches for `fs` and `path` only inside its Node branch.
 */
const BUILTIN_STUB_IMPORTERS = [/[\\/]node_modules[\\/]@techstark[\\/]opencv-js[\\/]/]

/**
 * Fails the build when anything imports a Node builtin, Electron or better-sqlite3, naming the
 * importer; only the packages in BUILTIN_STUB_IMPORTERS get an empty module for a builtin, with a
 * warning naming each one.
 */
export function noNodeBuiltins(): Plugin {
  return {
    name: 'no-node-builtins',
    enforce: 'pre',
    resolveId(id, importer) {
      const bare = id.startsWith('node:') ? id.slice(5) : id
      const name = bare.startsWith('@')
        ? bare.split('/').slice(0, 2).join('/')
        : bare.split('/')[0]!
      const native = name === 'electron' || name === 'better-sqlite3'
      if (!id.startsWith('node:') && !native && !builtinModules.includes(bare)) return null
      if (!native && importer && BUILTIN_STUB_IMPORTERS.some((re) => re.test(importer))) {
        this.warn(`"${id}" is an empty module for ${importer} (its Node-only branch)`)
        return `${STUB}:${bare}`
      }
      throw new Error(`The phone build can't use "${id}" (imported by ${importer ?? 'an entry'})`)
    },
    load(id) {
      return id.startsWith(STUB) ? 'export default {}' : null
    }
  }
}

/**
 * tesseract.js falls back to jsDelivr for any path it isn't given. The app gives every path (see
 * src/phone/ocr.ts), and the page's CSP blocks other origins anyway; pointing the fallbacks at a
 * path of the app's own that doesn't exist makes a missed one fail plainly, on this origin.
 */
const noCdn = (code: string): string =>
  code.replaceAll('https://cdn.jsdelivr.net/npm/', `${BASE}no-cdn/`)

function tesseractWithoutCdn(): Plugin {
  return {
    name: 'tesseract-without-cdn',
    transform: {
      filter: { id: /[\\/]node_modules[\\/]tesseract\.js[\\/]/ },
      handler(code) {
        return code.includes('cdn.jsdelivr.net') ? { code: noCdn(code), map: null } : null
      }
    }
  }
}

/** The tesseract worker, cores and language data, as the app's own files (see src/phone/ocr.ts). */
function ocrAssets(): Plugin {
  const mod = (path: string): string => resolve('node_modules', path)
  const files: Record<string, string> = {
    'ocr/worker.min.js': mod('tesseract.js/dist/worker.min.js')
  }
  for (const core of ['lstm', 'simd-lstm', 'relaxedsimd-lstm'])
    files[`ocr/core/tesseract-core-${core}.wasm.js`] = mod(
      `tesseract.js-core/tesseract-core-${core}.wasm.js`
    )
  for (const model of OCR_MODELS)
    files[`ocr/lang/${model}.traineddata.gz`] = mod(
      `@tesseract.js-data/${model}/4.0.0_best_int/${model}.traineddata.gz`
    )
  return {
    name: 'ocr-assets',
    apply: 'build',
    generateBundle() {
      for (const [fileName, path] of Object.entries(files))
        this.emitFile({
          type: 'asset',
          fileName,
          source: path.endsWith('worker.min.js')
            ? noCdn(readFileSync(path, 'utf8'))
            : readFileSync(path)
        })
    }
  }
}

const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })

/**
 * Writes the precache list and the build hash into sw.js: every emitted file (and every public
 * file) but sw.js and NOT_PRECACHED. A new build changes sw.js, so phones update.
 */
function precache(): Plugin {
  return {
    name: 'scan-precache',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const hash = createHash('sha256')
        const names: string[] = []
        const add = (name: string, body: string | Uint8Array): void => {
          if (name === 'sw.js') return
          hash.update(name).update(body)
          if (!NOT_PRECACHED.some((re) => re.test(name))) names.push(name)
        }
        for (const file of Object.values(bundle))
          add(file.fileName, file.type === 'chunk' ? file.code : file.source)
        for (const path of listFiles(PUBLIC_DIR))
          add(relative(PUBLIC_DIR, path).split('\\').join('/'), readFileSync(path))
        const sw = bundle['sw.js']
        if (!sw || sw.type !== 'chunk') throw new Error('The build has no sw.js')
        const urls = names.sort().map((n) => BASE + n)
        // JSON.parse('__SCAN_PRECACHE__') becomes JSON.parse("[…]").
        const list = /(["'`])__SCAN_PRECACHE__\1/
        if (!list.test(sw.code)) throw new Error('sw.js lost its precache placeholder')
        sw.code = sw.code.replace(list, () => JSON.stringify(JSON.stringify(urls)))
        if (!sw.code.includes('__SCAN_BUILD__')) throw new Error('sw.js lost its build placeholder')
        sw.code = sw.code.replaceAll('__SCAN_BUILD__', hash.digest('hex').slice(0, 16))
      }
    }
  }
}

export default defineConfig({
  root: resolve('src/phone'),
  base: BASE,
  publicDir: PUBLIC_DIR,
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    noNodeBuiltins(),
    react(),
    tailwindcss(),
    tesseractWithoutCdn(),
    ocrAssets(),
    precache()
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es', plugins: () => [noNodeBuiltins()] },
  build: {
    outDir: resolve('workers/portal/site/app/scan'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve('src/phone/index.html'), sw: resolve('src/phone/sw.ts') },
      output: {
        // The service worker keeps one URL (/scan/sw.js maps to it); everything else is hashed.
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js')
      }
    }
  }
})
