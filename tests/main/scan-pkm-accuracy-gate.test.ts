// @vitest-environment node
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { scanProfile } from '../../src/shared/scan/profiles'
import { accuracyProblem, checkAccuracy, PKM_FIXTURES_DIR } from '../../scripts/catalog/accuracy'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

interface Art {
  imageId: number
  cardId: number
  sourceId: string
  name: string
  language: 'en' | 'ja'
  setCode: string
  versions: string[]
}

interface Shot extends Art {
  file: string
}

const manifest = JSON.parse(readFileSync(join(PKM_FIXTURES_DIR, 'manifest.json'), 'utf8')) as {
  shots: Shot[]
  distractors: Art[]
}
const arts = [
  ...new Map([...manifest.shots, ...manifest.distractors].map((a) => [a.imageId, a])).values()
]

/** The reference images' fingerprints: what a nightly Pokémon file would hold for these cards. */
let fingerprints: Uint8Array
beforeAll(() => {
  const pkm = scanProfile('pkm')
  fingerprints = encodeFingerprints(
    readdirSync(join(PKM_FIXTURES_DIR, 'full')).map((f) => {
      const img = decode(readFileSync(join(PKM_FIXTURES_DIR, 'full', f)), {
        useTArray: true,
        formatAsRGBA: true
      })
      return {
        imageId: Number(f.replace('.jpg', '')),
        hash: artHash(fingerprintSource(img, 'pokemon', pkm))
      }
    })
  )
})

let dir: string
let work: Database.Database
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pkm-accuracy-'))
  work = openDatabase(join(dir, 'work.sqlite'))
})
afterEach(() => {
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Catalogs every fixture artwork as a Pokémon card, with one printing per version. */
function catalog(): void {
  const card = work.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (?, ?, 'Pokemon', 'pokemon', '', '', '2026-01-01', 'pkm')`
  )
  const image = work.prepare(
    "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'pkm')"
  )
  const printing = work.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
     VALUES (?, 'Fixture Set', ?, ?, ?, 'pkm')`
  )
  for (const a of arts) {
    card.run(a.cardId, a.name)
    image.run(a.imageId, a.cardId)
    for (const v of a.versions) printing.run(a.cardId, a.setCode, v, a.language)
  }
}

describe('checkAccuracy for Pokémon', () => {
  it('pkm fixtures pass with zero wrong', async () => {
    catalog()
    const report = await checkAccuracy(work, fingerprints, PKM_FIXTURES_DIR, 'pkm')
    expect(report.shots).toBe(48)
    expect(report.wrong).toEqual([])
    expect(accuracyProblem(report)).toBeNull()
  }, 120_000)

  it('a twin with the other language read is wrong', async () => {
    catalog()
    // An English shot whose Japanese twin is in the catalog, read as Japanese: its art and the
    // language agree on the twin, which is the wrong card.
    const shot = manifest.shots.find((s) => s.sourceId === 'en/sv03.5-025')!
    const fixtures = mkdtempSync(join(dir, 'fixtures-'))
    copyFileSync(join(PKM_FIXTURES_DIR, shot.file), join(fixtures, shot.file))
    writeFileSync(
      join(fixtures, 'manifest.json'),
      JSON.stringify({ shots: [{ ...shot, language: 'ja' }], distractors: [] })
    )
    const report = await checkAccuracy(work, fingerprints, fixtures, 'pkm')
    expect(report.wrong).toEqual([expect.stringContaining(shot.file)])
    expect(accuracyProblem(report)).toMatch(/wrong card/)
  }, 60_000)
})
