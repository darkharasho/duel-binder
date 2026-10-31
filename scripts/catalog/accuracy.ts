/**
 * The accuracy gate the nightly job runs on a new fingerprint file before uploading it: every
 * shot in tests/fixtures/scan goes through the app's own art matching and `resolveSignals`, with
 * the new file as the index and the work catalog answering the lookups. No set is picked and no
 * text is read, so the art alone has to carry each shot, the hardest case the app sees.
 *
 * Pokémon's file is checked the same way on tests/fixtures/scan-pkm, through the frame analysis
 * (art, version cues, slab) and `resolvePokemonSignals`. Its shots have no text read either: the
 * language a card's text would read as comes from the manifest, so what's under test is that the
 * art and that language name the right card, in the right language and, when sure, version.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from 'jpeg-js'
import type { SqlDb } from '../../src/main/db/sql'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsByNumber,
  printingsForCards
} from '../../src/main/repo/scan'
import { localScope } from '../../src/main/repo/scope'
import type { GameId } from '../../src/shared/games/types'
import type { CollectorNumber } from '../../src/shared/scan/collectorNumber'
import { decodeFingerprints, type FingerprintIndex } from '../../src/shared/scan/fingerprintFile'
import { scanProfile } from '../../src/shared/scan/profiles'
import { ART_MATCH_DEPTH } from '../../src/shared/scan/thresholds'
import type { RgbaImage } from '../../src/shared/scan/types'
import {
  resolveSignals,
  type ResolveContext,
  type ScanOutcome
} from '../../src/renderer/src/features/scan/resolve'
import { resolvePokemonSignals } from '../../src/renderer/src/features/scan/resolvePokemon'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { recognizeArt } from '../../src/renderer/src/features/scan/vision/candidates'
import type { CV } from '../../src/renderer/src/features/scan/vision/cv'

export const FIXTURES_DIR = 'tests/fixtures/scan'
export const PKM_FIXTURES_DIR = 'tests/fixtures/scan-pkm'
/**
 * Share of shots that must be recognized as the right card. Wrong cards fail the gate at any
 * count; this floor catches a file that quietly stopped matching, which accepts nothing wrong.
 */
export const MIN_RIGHT_SHARE = 0.85
/**
 * Pokémon's floor while it is below that bar and owner-only: 85% stays its goal (the real-photo
 * test holds it there), but the file has to ship to be tested. A file that stopped matching still
 * fails; a full build gets 33 of its 48 synthetic shots.
 */
export const PKM_MIN_RIGHT_SHARE = 0.6

/**
 * The private real-photo test's budget: wrong answers as a share of the cards named, the owner's
 * photos and all of them. The Pokémon scanner may name a best guess, marked as one; the nightly
 * gate on the fixtures takes no other card at all, and the same share of the shots as reprints:
 * a promo with the same art can't be told from its original without reading the number.
 */
export const PKM_MAX_WRONG_SHARE = 0.05

export interface AccuracyReport {
  shots: number
  right: number
  /**
   * Shots taken for another card (for Pokémon, or in another language, or as another version
   * named as sure), as "file (name) as card".
   */
  wrong: string[]
  /** The wrong shots of those named as a card of the same name: a reprint, not another card. */
  reprints?: string[]
  /** Shots taken for no card, as "file (name)". */
  missed: string[]
}

interface Shot {
  file: string
  cardId: number
  name: string
  /** Pokémon: the language the card's text reads as. */
  language?: 'en' | 'ja'
  /** Pokémon: the card's version, when the shot is known to be one; null when not told. */
  version?: string | null
}

/**
 * Runs every fixture shot in `dir` through recognition against `fingerprints` and the `work`
 * catalog, for the game's cards.
 */
export async function checkAccuracy(
  work: SqlDb,
  fingerprints: Uint8Array,
  dir = FIXTURES_DIR,
  game: GameId = 'ygo'
): Promise<AccuracyReport> {
  const { shots } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    shots: Shot[]
  }
  // Loaded only here, so importing the job doesn't start OpenCV.
  const { loadCv } = await import('../../src/renderer/src/features/scan/vision/cv')
  const cv = await loadCv()
  const index = decodeFingerprints(fingerprints)
  const scope = game === 'pkm' ? localScope("'pkm'") : undefined
  const lookups = {
    printingsByCode: async (code: string) => printingsByCode(work, code, scope),
    printingsByNumber: async (n: CollectorNumber) => printingsByNumber(work, n, scope),
    printingsForCards: async (ids: number[]) => printingsForCards(work, ids, scope),
    matchName: async (text: string) => matchName(work, text, scope),
    cardsForImages: async (ids: number[]) => cardsForImages(work, ids, scope)
  }
  const nameOf = work.prepare('SELECT name FROM cards WHERE id = ?')
  const report: AccuracyReport = { shots: shots.length, right: 0, wrong: [], missed: [] }
  for (const shot of shots) {
    const img = decode(readFileSync(join(dir, shot.file)), { useTArray: true, formatAsRGBA: true })
    const label = `${shot.file} (${shot.name})`
    if (game === 'pkm') {
      const outcome = await pokemonOutcome(cv, img, index, shot, lookups)
      const problem = pokemonProblem(outcome, shot)
      if (problem === undefined) report.missed.push(label)
      else if (problem === null) report.right++
      else {
        report.wrong.push(`${label} as ${problem}`)
        if (
          outcome.kind === 'recognized' &&
          outcome.item.name === (nameOf.get(shot.cardId) as { name: string } | undefined)?.name
        )
          (report.reprints ??= []).push(`${label} as ${problem}`)
      }
      continue
    }
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
    if (outcome.kind !== 'recognized') report.missed.push(label)
    // Or by name: YGOPRODeck renumbers a card now and then (Monster Reborn's main id moved from
    // 83764718 to 83764719), and card names are unique.
    else if (outcome.item.cardId === shot.cardId || outcome.item.name === shot.name) report.right++
    else report.wrong.push(`${label} as ${outcome.item.name} (${outcome.item.cardId})`)
  }
  return report
}

/** A Pokémon shot through the frame analysis and resolver, its text read as the manifest says. */
async function pokemonOutcome(
  cv: CV,
  img: RgbaImage,
  index: FingerprintIndex,
  shot: Shot,
  lookups: ResolveContext['lookups']
): Promise<ScanOutcome> {
  const signals = analyze(cv, img, index, null, false, false, scanProfile('pkm'))
  return resolvePokemonSignals(
    {
      found: signals.found,
      quad: signals.quad,
      art: signals.art,
      codeTexts: [],
      nameTexts: [],
      textBands: [],
      cues: null,
      version: signals.version,
      slab: signals.slab,
      look: null
    },
    {
      game: 'pkm',
      setName: null,
      setPrintings: null,
      defaultRarity: null,
      lookups,
      readLanguage: async () => shot.language ?? null
    }
  )
}

/**
 * What a Pokémon outcome got wrong: undefined when it named no card, null when it named the
 * right one, else the card it named. Wrong is another card, another language, or a version named
 * as sure that isn't the shot's (a card with one version in the catalog is that version, so it
 * can't be).
 */
function pokemonProblem(outcome: ScanOutcome, shot: Shot): string | null | undefined {
  if (outcome.kind !== 'recognized') return undefined
  const { item } = outcome
  const language = item.options.find((o) => o.printingId === item.printingId)?.language
  const wrongVersion =
    item.flag === null &&
    item.options.length > 1 &&
    shot.version != null &&
    item.rarity !== shot.version
  if (item.cardId === shot.cardId && language === shot.language && !wrongVersion) return null
  const version = item.flag === null ? item.rarity : 'any version'
  return `${item.name} (${item.cardId}) ${language} ${version}`
}

/** Why the report fails the gate, or null when it passes. */
export function accuracyProblem(r: AccuracyReport, game: GameId = 'ygo'): string | null {
  const allowed = game === 'pkm' ? (r.reprints?.length ?? 0) : 0
  const others = r.wrong.length - allowed
  if (others > 0 || allowed > r.shots * PKM_MAX_WRONG_SHARE)
    return `took ${r.wrong.length} shot(s) for the wrong card: ${r.wrong.join('; ')}`
  const share = game === 'pkm' ? PKM_MIN_RIGHT_SHARE : MIN_RIGHT_SHARE
  if (r.right < r.shots * share) {
    return `recognized only ${r.right} of ${r.shots} shots (needs ${Math.ceil(r.shots * share)})`
  }
  return null
}
