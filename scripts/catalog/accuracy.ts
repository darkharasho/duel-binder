/**
 * The accuracy gate the nightly job runs on a new fingerprint file before uploading it: every
 * shot in tests/fixtures/scan goes through the app's own art matching and `resolveSignals`, with
 * the new file as the index and the work catalog answering the lookups. No set is picked and no
 * text is read, so the art alone has to carry each shot, the hardest case the app sees.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import type { SqlDb } from '../../src/main/db/sql'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsForCards
} from '../../src/main/repo/scan'
import { decodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { ART_MATCH_DEPTH } from '../../src/shared/scan/thresholds'
import { resolveSignals } from '../../src/renderer/src/features/scan/resolve'
import { recognizeArt } from '../../src/renderer/src/features/scan/vision/candidates'

export const FIXTURES_DIR = 'tests/fixtures/scan'
/**
 * Share of shots that must be recognized as the right card. Wrong cards fail the gate at any
 * count; this floor catches a file that quietly stopped matching, which accepts nothing wrong.
 */
export const MIN_RIGHT_SHARE = 0.85

export interface AccuracyReport {
  shots: number
  right: number
  /** Shots taken for another card, as "file (name) as card". */
  wrong: string[]
  /** Shots taken for no card, as "file (name)". */
  missed: string[]
}

interface Shot {
  file: string
  cardId: number
  name: string
}

/** Runs every fixture shot through recognition against `fingerprints` and the `work` catalog. */
export async function checkAccuracy(
  work: SqlDb,
  fingerprints: Uint8Array,
  dir = FIXTURES_DIR
): Promise<AccuracyReport> {
  const { shots } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    shots: Shot[]
  }
  // Loaded only here, so importing the job doesn't start OpenCV.
  const { loadCv } = await import('../../src/renderer/src/features/scan/vision/cv')
  const cv = await loadCv()
  const index = decodeFingerprints(fingerprints)
  const lookups = {
    printingsByCode: async (code: string) => printingsByCode(work, code),
    printingsForCards: async (ids: number[]) => printingsForCards(work, ids),
    matchName: async (text: string) => matchName(work, text),
    cardsForImages: async (ids: number[]) => cardsForImages(work, ids)
  }
  const report: AccuracyReport = { shots: shots.length, right: 0, wrong: [], missed: [] }
  for (const shot of shots) {
    const img = decode(readFileSync(join(dir, shot.file)), { useTArray: true, formatAsRGBA: true })
    const found = recognizeArt(cv, img, index, undefined, ART_MATCH_DEPTH)
    const outcome = await resolveSignals(
      {
        found: found !== null,
        quad: found?.quad ?? null,
        art: found?.matches ?? [],
        codeTexts: [],
        nameTexts: [],
        textBands: [],
        cues: null,
        look: null
      },
      { setName: null, setPrintings: null, defaultRarity: null, lookups }
    )
    const label = `${shot.file} (${shot.name})`
    if (outcome.kind !== 'recognized') report.missed.push(label)
    // Or by name: YGOPRODeck renumbers a card now and then (Monster Reborn's main id moved from
    // 83764718 to 83764719), and card names are unique.
    else if (outcome.item.cardId === shot.cardId || outcome.item.name === shot.name) report.right++
    else report.wrong.push(`${label} as ${outcome.item.name} (${outcome.item.cardId})`)
  }
  return report
}

/** Why the report fails the gate, or null when it passes. */
export function accuracyProblem(r: AccuracyReport): string | null {
  if (r.wrong.length > 0)
    return `took ${r.wrong.length} shot(s) for the wrong card: ${r.wrong.join('; ')}`
  if (r.right < r.shots * MIN_RIGHT_SHARE) {
    return `recognized only ${r.right} of ${r.shots} shots (needs ${Math.ceil(r.shots * MIN_RIGHT_SHARE)})`
  }
  return null
}
