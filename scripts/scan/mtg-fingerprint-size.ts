/**
 * How big Magic's fingerprint file will be, and how long a frame's art lookup takes over it: runs
 * the nightly job's Magic selection (magicFingerprintTargets) on a real catalog, hashing nothing.
 * A measurement, not shipped.
 *
 *   vite build --config scripts/catalog/vite.config.ts && ELECTRON_RUN_AS_NODE=1 npx electron out/catalog/mtg-fingerprint-size.mjs [catalog.sqlite]
 *
 * The default catalog is ~/.config/duel-binder/collection.db, opened read-only (the app may have
 * it open; readers don't get in its way).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { magicFingerprintTargets } from '../catalog/fingerprints'
import { HASH_WORDS } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { MTG_ID_MIN } from '../../src/shared/games/ids'

const RUNS = 100
const LIMIT_MB = 6

const path = process.argv[2] ?? join(homedir(), '.config/duel-binder/collection.db')
const db = new Database(path, { readonly: true, fileMustExist: true })
const t0 = performance.now()
const targets = magicFingerprintTargets(db)
const selectMs = performance.now() - t0
const backs = [...targets.values()].filter((t) => t.url.includes('/back/')).length
const images = db
  .prepare("SELECT COUNT(*) FROM card_images WHERE game = 'mtg'")
  .pluck()
  .get() as number
db.close()

const records = targets.size
const randomHash = (): Uint32Array =>
  Uint32Array.from({ length: HASH_WORDS }, () => (Math.random() * 2 ** 32) >>> 0)
const bytes = encodeFingerprints(
  Array.from({ length: records }, (_, i) => ({ imageId: MTG_ID_MIN + i, hash: randomHash() }))
)
const index = decodeFingerprints(bytes)
const probes = Array.from({ length: RUNS }, randomHash)
index.nearest(probes[0], 5)
const t1 = performance.now()
for (const p of probes) index.nearest(p, 5)
const lookupMs = (performance.now() - t1) / RUNS

const mb = bytes.byteLength / 1024 / 1024
console.log(`Magic images: ${images}`)
console.log(
  `Records: ${records} (${records - backs} looks, ${backs} back faces); selected in ${selectMs.toFixed(0)} ms`
)
console.log(`File: ${bytes.byteLength} bytes (${mb.toFixed(2)} MB; 11 + 44 x ${records})`)
console.log(
  `Lookup: ${lookupMs.toFixed(2)} ms per nearest(5) over ${index.count} records (desktop CPU)`
)
if (mb > LIMIT_MB) {
  console.log(`Over ${LIMIT_MB} MB: stop and report back (spec).`)
  process.exitCode = 1
}
