/**
 * Builds src/shared/scan/reverseRefs.json: body stats of the English reference image of every card
 * in the sets the reverse-holo check covers (REVERSE_CHECKED_SETS).
 *
 *   vite build --config scripts/catalog/vite.config.ts && ELECTRON_RUN_AS_NODE=1 npx electron out/catalog/reverse-refs.mjs [catalog.sqlite]
 *
 * Run from the repo root.
 *
 * The default catalog is ~/.config/duel-binder/collection.db, opened read-only. Exits non-zero if
 * any image can't be fetched.
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pokemonImageUrl } from '../catalog/fingerprints'
import { decodeImage } from '../catalog/references'
import { REVERSE_CHECKED_SETS, bodyStats } from '../../src/shared/scan/reverseHolo'
import type { RgbaImage } from '../../src/shared/scan/types'
import { upright } from '../../src/shared/upright'

/** From the repo root, two levels up from both scripts/scan/ and the bundle in out/catalog/. */
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../..', 'src/shared/scan/reverseRefs.json')
const ROUND = 10000

const round = (n: number): number => Math.round(n * ROUND) / ROUND

/** Stats for each row's image; the ids whose image couldn't be loaded are in `failed`. */
export async function buildReverseRefs(
  rows: { imageId: number; url: string }[],
  load: (url: string) => Promise<RgbaImage | null>
): Promise<{ refs: Record<string, [number, number]>; failed: number[] }> {
  const refs: Record<string, [number, number]> = {}
  const failed: number[] = []
  for (const row of rows) {
    let img: RgbaImage | null = null
    for (let attempt = 0; attempt < 2 && !img; attempt++) {
      try {
        img = await load(row.url)
      } catch {
        img = null
      }
    }
    if (!img) {
      failed.push(row.imageId)
      continue
    }
    const s = bodyStats(upright(img))
    refs[String(row.imageId)] = [round(s.ratio), round(s.spread)]
  }
  return { refs, failed }
}

async function fetchImage(url: string): Promise<RgbaImage | null> {
  const res = await fetch(pokemonImageUrl(url))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return decodeImage(new Uint8Array(await res.arrayBuffer()))
}

async function main(): Promise<void> {
  const { default: Database } = await import('better-sqlite3')
  const path = process.argv[2] ?? join(homedir(), '.config', 'duel-binder', 'collection.db')
  const db = new Database(path, { readonly: true })
  const query = db.prepare(
    `SELECT DISTINCT i.image_id AS imageId, p.image_url AS url FROM card_images i
     JOIN pokemon_cards p ON p.card_id = i.card_id
     JOIN card_printings cp ON cp.card_id = i.card_id
     WHERE i.game = 'pkm' AND cp.language = 'en' AND p.source_id LIKE 'en/%'
       AND p.image_url IS NOT NULL AND cp.set_code LIKE ? || ' %'`
  )
  const rows = REVERSE_CHECKED_SETS.flatMap((prefix) => query.all(prefix) as { imageId: number; url: string }[])
  db.close()
  const { refs, failed } = await buildReverseRefs(rows, fetchImage)
  const sorted = Object.fromEntries(Object.entries(refs).sort(([a], [b]) => Number(a) - Number(b)))
  writeFileSync(OUT, JSON.stringify({ v: 1, refs: sorted }, null, 1) + '\n')
  console.log(`${Object.keys(refs).length} refs, ${failed.length} failed`)
  if (failed.length) {
    console.error('failed:', failed.join(', '))
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
