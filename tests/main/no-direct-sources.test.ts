import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const MAIN = resolve(__dirname, '../../src/main')
const DEV = join(MAIN, 'dev')

/** Modules that call card, image or price sources directly; only the dev profile may reach them. */
const DIRECT = [
  'ygo/client',
  'sync/catalog',
  'sync/sync',
  'sync/intl',
  'sync/sets',
  'yugipedia/client',
  'yugipedia/artResolver',
  'yugipedia/setLogos',
  'tcgplayer/catalog',
  'tcgplayer/prices',
  'konami/packArt',
  'konami/logos',
  'prices/client',
  'prices/service',
  'prices/refresh'
]

const IMPORT =
  /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/g

function resolveTs(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec)
  for (const file of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (file.endsWith('.ts') && existsSync(file)) return file
  }
  return null
}

/** Every main-process module reachable from index.ts through relative imports, outside src/main/dev. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = m[1] ?? m[2]
      if (!spec.startsWith('.')) continue
      const target = resolveTs(file, spec)
      if (target === null || target.startsWith(`${DEV}/`)) continue
      queue.push(target)
    }
  }
  return seen
}

it('the main process reaches no direct source outside the dev profile', () => {
  const modules = [...reachable(join(MAIN, 'index.ts'))].map((f) =>
    relative(MAIN, f).replace(/\.ts$/, '')
  )
  expect(modules).toContain('catalog/service')
  expect(modules.filter((m) => DIRECT.includes(m))).toEqual([])
})
