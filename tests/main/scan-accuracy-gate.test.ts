// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import {
  accuracyProblem,
  checkAccuracy,
  FIXTURES_DIR,
  MIN_RIGHT_SHARE
} from '../../scripts/catalog/accuracy'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

interface Art {
  imageId: number
  cardId: number
  name: string
  frame: string
}

const { shots, distractors } = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8')
) as { shots: (Art & { setCode: string })[]; distractors: Art[] }
const arts = [...new Map([...shots, ...distractors].map((a) => [a.imageId, a])).values()]

/** The fixture artworks' fingerprints: what a nightly file would hold for these cards. */
let fingerprints: Uint8Array
beforeAll(() => {
  fingerprints = encodeFingerprints(
    readdirSync(join(FIXTURES_DIR, 'cropped')).map((f) => {
      const imageId = Number(f.replace('.jpg', ''))
      const img = decode(readFileSync(join(FIXTURES_DIR, 'cropped', f)), {
        useTArray: true,
        formatAsRGBA: true
      })
      return {
        imageId,
        hash: artHash(fingerprintSource(img, arts.find((a) => a.imageId === imageId)!.frame))
      }
    })
  )
})

let dir: string
let work: Database.Database
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'accuracy-'))
  work = openDatabase(join(dir, 'work.sqlite'))
})
afterEach(() => {
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Catalogs every fixture artwork under its card, with one printing per card. */
function catalog(cardOf: (a: Art) => number = (a) => a.cardId, nameOf = (a: Art) => a.name): void {
  const card = work.prepare(
    `INSERT OR IGNORE INTO cards (id, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, ?, 'Normal Monster', ?, 'Spellcaster', '', '2026-01-01')`
  )
  const image = work.prepare(
    'INSERT INTO card_images (image_id, card_id, sort_order) VALUES (?, ?, ?)'
  )
  const printing = work.prepare(
    `INSERT OR IGNORE INTO card_printings (card_id, set_name, set_code, set_rarity, language)
     VALUES (?, 'Fixture Set', ?, 'Common', 'en')`
  )
  arts.forEach((a, i) => {
    const id = cardOf(a)
    card.run(id, nameOf(a), a.frame)
    image.run(a.imageId, id, i)
    printing.run(id, `FIX-EN${String(i).padStart(3, '0')}`)
  })
}

describe('checkAccuracy', () => {
  it('passes the fixture fingerprints over a catalog that matches them', async () => {
    catalog()
    const report = await checkAccuracy(work, fingerprints)
    expect(report.wrong).toEqual([])
    expect(report.right).toBeGreaterThanOrEqual(MIN_RIGHT_SHARE * report.shots)
    expect(accuracyProblem(report)).toBeNull()
  }, 60_000)

  it('counts a renumbered card as right when its name is unchanged', async () => {
    catalog((a) => (a.name === 'Kuriboh' ? 99_999_999 : a.cardId))
    const report = await checkAccuracy(work, fingerprints)
    expect(report.wrong).toEqual([])
  }, 60_000)

  it('fails a catalog that files an artwork under the wrong card', async () => {
    const kuriboh = shots.find((s) => s.name === 'Kuriboh')!
    catalog(
      (a) => (a.imageId === kuriboh.imageId ? 99_999_999 : a.cardId),
      (a) => (a.imageId === kuriboh.imageId ? 'Winged Kuriboh' : a.name)
    )
    const report = await checkAccuracy(work, fingerprints)
    expect(report.wrong.length).toBeGreaterThan(0)
    expect(report.wrong.every((w) => w.includes('(Kuriboh) as Winged Kuriboh'))).toBe(true)
    expect(accuracyProblem(report)).toMatch(/wrong card/)
  }, 60_000)

  it('fails a fingerprint file that stopped matching', async () => {
    catalog()
    const report = await checkAccuracy(work, encodeFingerprints([]))
    expect(report.right).toBe(0)
    expect(accuracyProblem(report)).toMatch(/^recognized only 0 of \d+ shots/)
  }, 60_000)
})

describe('accuracyProblem', () => {
  it('holds Pokémon to its own floor, and to no wrong cards', () => {
    const report = { shots: 48, right: 33, wrong: [], missed: [] }
    expect(accuracyProblem(report)).toMatch(/needs 41/)
    expect(accuracyProblem(report, 'pkm')).toBeNull()
    expect(accuracyProblem({ ...report, right: 28 }, 'pkm')).toMatch(/needs 29/)
    expect(accuracyProblem({ ...report, wrong: ['a'] }, 'pkm')).toMatch(/wrong card/)
  })

  it('passes a report at the floor with nothing wrong', () => {
    expect(accuracyProblem({ shots: 20, right: 17, wrong: [], missed: ['a', 'b', 'c'] })).toBeNull()
    expect(accuracyProblem({ shots: 20, right: 16, wrong: [], missed: [] })).toMatch(/needs 17/)
  })
})
