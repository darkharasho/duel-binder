// @vitest-environment node
// Rarity from the card's look on the owner's real webcam photos. They stay out of the (public)
// repo, so this only runs when SCAN_REAL_DIR points at a folder like scan-real.test.ts's that
// also holds rarity-labels.json: [{ file, rarity, available }], the rarity each shot shows and
// the rarities its code was printed in.
//   SCAN_REAL_DIR=<dir> npx vitest run --maxWorkers=2 --silent=false tests/main/scan-rarity-real.test.ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { artHash, fingerprintSource } from '../../src/shared/scan/fingerprint'
import { decodeFingerprints, encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { pickRarityByLook } from '../../src/shared/scan/look'
import { LOOK_MODEL } from '../../src/shared/scan/lookModel'
import { pickRarityByCues, type RarityCues } from '../../src/shared/scan/rarity'
import type { RgbaImage } from '../../src/shared/scan/types'
import { loadCv } from '../../src/renderer/src/features/scan/vision/cv'
import { recognizeArt } from '../../src/renderer/src/features/scan/vision/candidates'
import { rarityLook } from '../../src/renderer/src/features/scan/vision/rarityCues'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

/** Share of confident picks that must be right. */
const MIN_PRECISION = 0.95
/** Rarities each shot is paired against, as if its code had been printed in both. */
const RIVALS = [
  'Common',
  'Super Rare',
  'Ultra Rare',
  'Secret Rare',
  'Starlight Rare',
  'Quarter Century Secret Rare'
]

interface Label {
  file: string
  rarity: string
  available: string[]
}

interface Truth {
  file: string
  cardId: number | null
  frameType: string | null
}

interface Shot extends RarityCues {
  file: string
  rarity: string
  frameType: string
  available: string[]
  /** The look model's features, as the phone scanner's worker measures them. */
  features: number[]
}

const DIR = process.env.SCAN_REAL_DIR
const LABELS = DIR && join(DIR, 'rarity-labels.json')

const load = (path: string): RgbaImage =>
  decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })

const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(1)}%)`

describe.skipIf(!LABELS || !existsSync(LABELS))('rarity from the look of real photos', () => {
  const shots: Shot[] = []
  /** Pair "shown vs rival" to its confident right and wrong picks and declines. */
  const pairs = new Map<string, { right: number; wrong: number; declined: number }>()
  let unrecognized = 0

  beforeAll(async () => {
    const dir = DIR!
    const cv = await loadCv()
    const arts = JSON.parse(readFileSync(join(dir, 'cropped', 'index.json'), 'utf8')) as {
      imageId: number
      cardId: number
      frameType: string
    }[]
    const cardOf = new Map(arts.map((a) => [a.imageId, a.cardId]))
    const index = decodeFingerprints(
      encodeFingerprints(
        arts.map((a) => ({
          imageId: a.imageId,
          hash: artHash(
            fingerprintSource(load(join(dir, 'cropped', `${a.imageId}.jpg`)), a.frameType)
          )
        }))
      )
    )
    const truth = new Map(
      (JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth[]).map((t) => [t.file, t])
    )
    for (const label of JSON.parse(readFileSync(LABELS!, 'utf8')) as Label[]) {
      const t = truth.get(label.file)
      const found = recognizeArt(cv, load(join(dir, label.file)), index)
      const top = found?.matches[0]
      // Only cards the scanner would have recognized, and so turned upright, are looked at.
      if (!found || !top || !t?.frameType || cardOf.get(top.imageId) !== t.cardId) {
        unrecognized++
        continue
      }
      const { cues, features } = rarityLook(found.card, true)
      const shot = { ...label, frameType: t.frameType, ...cues, features: features! }
      shots.push(shot)
      for (const rival of RIVALS.filter((r) => r !== label.rarity)) {
        const { rarity, certain } = pickRarityByCues([label.rarity, rival], shot, shot.frameType)
        const key = `${label.rarity} vs ${rival}`
        const counts = pairs.get(key) ?? { right: 0, wrong: 0, declined: 0 }
        counts[!certain ? 'declined' : rarity === label.rarity ? 'right' : 'wrong']++
        pairs.set(key, counts)
      }
    }
    // Without the look features: 83 numbers a shot.
    console.table(shots.map((s) => ({ ...s, features: s.features.length })))
    console.table(Object.fromEntries(pairs))
    console.log(`not recognized: ${unrecognized}`)
  }, 600_000)

  it(`picks among a code's own rarities right ${MIN_PRECISION * 100}% of the time it is sure`, () => {
    const picks = shots.map((s) => ({
      ...s,
      pick: pickRarityByCues(s.available, s, s.frameType)
    }))
    const sure = picks.filter((p) => p.pick.certain)
    const right = sure.filter((p) => p.pick.rarity === p.rarity)
    console.log(`own rarities: right ${pct(right.length, sure.length)} of ${picks.length} shots`)
    expect(right.length).toBeGreaterThanOrEqual(MIN_PRECISION * sure.length)
  })

  it(`is right ${MIN_PRECISION * 100}% of the time it is sure between two rarities`, () => {
    const all = [...pairs.values()]
    const right = all.reduce((n, c) => n + c.right, 0)
    const wrong = all.reduce((n, c) => n + c.wrong, 0)
    const declined = all.reduce((n, c) => n + c.declined, 0)
    console.log(`pairs: right ${pct(right, right + wrong)}, declined ${declined}`)
    expect(right).toBeGreaterThanOrEqual(MIN_PRECISION * (right + wrong))
  })

  // The phone scanner's path: the rules, then the look model where they abstain. These are
  // desktop webcam shots, where the model adds nothing, which is why the desktop keeps to the
  // rules: on the owner's set it made one pick the rules didn't, and that one was wrong (a cased
  // Secret Rare, shot_0116, read as Starlight at p 0.9998). Held to the same bar as the rules.
  it(`with the look model after the rules (the phone path), is right ${MIN_PRECISION * 100}% of the time it is sure`, () => {
    const picks = shots.map((s) => ({
      ...s,
      rules: pickRarityByCues(s.available, s, s.frameType),
      pick: pickRarityByLook(LOOK_MODEL, s.available, s, [s.features], s.frameType)
    }))
    const sure = picks.filter((p) => p.pick.certain)
    const right = sure.filter((p) => p.pick.rarity === p.rarity)
    const added = sure.filter((p) => !p.rules.certain)
    for (const p of added.filter((a) => a.pick.rarity !== a.rarity))
      console.log(`look model wrong: ${p.file} ${p.rarity} picked as ${p.pick.rarity}`)
    console.log(
      `phone path: right ${pct(right.length, sure.length)}, ${added.length} beyond the rules`
    )
    expect(right.length).toBeGreaterThanOrEqual(MIN_PRECISION * sure.length)
  })
})
