// @vitest-environment node
// The One Piece scanner on real photos: the testers' Contribute shots (npm run scan:pull-training),
// through the app's own path per photo: the vision worker's analyze (detect, warp, art), tesseract
// on the code bands, then resolveSignals for game 'op' with the app's lookups. The photos and the
// catalog stay out of the (public) repo, so this runs only when SCAN_OP_DIR points at them. CI's
// scan-photos job runs them from a copy in the private darkharasho/duel-binder-scan-corpus repo
// (op/); push changes there too.
//   SCAN_OP_DIR=~/scan-capture   op-truth.json, the photos it names (shots-op/), and op-work/
//                                (catalog.sqlite with the op catalog, fingerprints-op.bin)
//   SCAN_OP_TRUTH=<file>         another truth file (default SCAN_OP_DIR/op-truth.json)
//   op-truth.skip.json           optional, beside the truth file: [{ file, why }] photos left out (no
//                                card in the shot, say); kept apart since each pull rewrites the truth
//   SCAN_OP_OUT=<file>           also write the per-photo rows and signals there as JSON
//   SCAN_OP_SAVE=<dir>           write the card each photo was read as (straightened) there, to look at
//   SCAN_OP_CROP=1               scan each photo at the live scan's centre crop, not the whole photo
//   SCAN_OP_DIR=~/scan-capture npm test -- --silent=false tests/main/scan-op-real.test.ts
// Right is the photo's card (number and language); a printing named as sure must be the photo's
// own (its Bandai image id). Wrong is another card, another language, or a sure printing that
// isn't the photo's. "Unsure" asks the user to pick, which costs a tap but is never wrong.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { decode, encode } from 'jpeg-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OP_MAX_WRONG_SHARE, OP_MIN_RIGHT_SHARE } from '../../scripts/catalog/accuracy'
import { decodeFingerprints, type FingerprintIndex } from '../../src/shared/scan/fingerprintFile'
import { scanProfile } from '../../src/shared/scan/profiles'
import type { OcrBand, RgbaImage } from '../../src/shared/scan/types'
import { createOcr } from '../../src/main/scan/ocr'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsByNumber,
  printingsForCards
} from '../../src/main/repo/scan'
import { localScope } from '../../src/main/repo/scope'
import { resolveSignals, type ResolveContext } from '../../src/renderer/src/features/scan/resolve'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { findCandidates } from '../../src/renderer/src/features/scan/vision/candidates'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { centreCrop } from '../../src/renderer/src/features/scan/crop'
import { readFramed } from '../../src/renderer/src/features/scan/vision/framing'
import { warpCard } from '../../src/renderer/src/features/scan/vision/detect'

vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('../../vendor/opencv/opencv.js') }
})

interface Truth {
  file: string
  /** 'en/OP17-092' */
  sourceId: string | null
  language: string | null
  /** Bandai's image id: the number, with _pN for a parallel. */
  bandaiId: string | null
  version: string | null
  holder: string
  tester: string
}

interface Row {
  file: string
  tester: string
  card: string
  bandai: string
  /** right, wrong, unsure or none. */
  result: string
  got: string
  why: string
  /** Tesseract's reads of the code bands. */
  number: string
  /** The closest artwork's Bandai id and distance. */
  art: string
  /** The photo's own artwork is among the closest. */
  inTop: boolean
  /** The photo's own artwork's rank and distance, when it is among them. */
  own: string
  ms: number
}

const home = (p: string): string => p.replace(/^~/, homedir())
const DIR = process.env.SCAN_OP_DIR ? home(process.env.SCAN_OP_DIR) : undefined
const TRUTH = DIR ? home(process.env.SCAN_OP_TRUTH ?? join(DIR, 'op-truth.json')) : undefined
const WORK = DIR ? join(DIR, 'op-work') : undefined
const READY = !!DIR && existsSync(TRUTH!)
const CROP = process.env.SCAN_OP_CROP === '1'
if (DIR && !READY)
  console.warn(
    `One Piece real-photo gate skipped: no truth file at ${TRUTH} (see the test's header)`
  )

const loadImage = (path: string): RgbaImage =>
  decode(readFileSync(path), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0
const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(1)}%)`

function summary(rows: Row[]): Record<string, string | number> {
  return {
    photos: rows.length,
    right: pct(rows.filter((r) => r.result === 'right').length, rows.length),
    wrong: rows.filter((r) => r.result === 'wrong').length,
    unsure: rows.filter((r) => r.result === 'unsure').length,
    none: rows.filter((r) => r.result === 'none').length,
    'own art in top': pct(rows.filter((r) => r.inTop).length, rows.length)
  }
}

describe.skipIf(!READY)('the One Piece scanner on real photos', () => {
  let cv: CV
  let index: FingerprintIndex
  let db: Database.Database
  const ocr = createOcr()
  const rows: Row[] = []
  const raws: Record<string, unknown> = {}
  const skipped: string[] = []

  beforeAll(async () => {
    cv = await loadCv()
    index = decodeFingerprints(readFileSync(join(WORK!, 'fingerprints-op.bin')))
    db = new Database(join(WORK!, 'catalog.sqlite'), { readonly: true, fileMustExist: true })
    const scope = localScope("'op'")
    const lookups: ResolveContext['lookups'] = {
      printingsByCode: async (code) => printingsByCode(db, code, scope),
      printingsByNumber: async (n) => printingsByNumber(db, n, scope),
      printingsForCards: async (ids) => printingsForCards(db, ids, scope),
      matchName: async (text) => matchName(db, text, scope),
      cardsForImages: async (ids) => cardsForImages(db, ids, scope)
    }
    const bandaiOf = db.prepare<[number], string>(
      'SELECT set_rarity_code FROM card_printings WHERE id = ?'
    )
    // An artwork's Bandai id: the set_rarity_code of a printing that shows it.
    const artBandai = (imageId: number): string => {
      const cards = cardsForImages(db, [imageId], scope)
      if (!cards.length) return '?'
      const ps = printingsForCards(db, [cards[0].cardId], scope)
      const p = ps.find((x) => x.imageIds.includes(imageId))
      return p ? (bandaiOf.pluck().get(p.printingId) ?? '?') : '?'
    }
    const truth = JSON.parse(readFileSync(TRUTH!, 'utf8')) as Truth[]
    const skipPath = TRUTH!.replace(/\.json$/, '.skip.json')
    const skip = new Map<string, string>(
      existsSync(skipPath)
        ? (JSON.parse(readFileSync(skipPath, 'utf8')) as { file: string; why: string }[]).map(
            (s) => [s.file, s.why]
          )
        : []
    )
    const profile = scanProfile('op')

    for (const t of truth) {
      const path = join(DIR!, t.file)
      if (skip.has(t.file)) {
        skipped.push(`${t.file}: ${skip.get(t.file)}`)
        continue
      }
      if (!t.sourceId || !t.bandaiId) {
        skipped.push(`${t.file}: no card`)
        continue
      }
      if (!existsSync(path)) {
        skipped.push(`${t.file}: no such file`)
        continue
      }
      const img = loadImage(path)
      const start = performance.now()
      const region = CROP ? centreCrop(img.width, img.height) : null
      const signals = readFramed(
        img,
        region,
        (im, first) => analyze(cv, im, index, null, true, false, profile, true, first, true),
        (im) => findCandidates(cv, im, profile)
      )
      const codeBands = signals.codeBands.filter(hasPixels)
      const codes =
        signals.found && codeBands.length ? await ocr.read(codeBands, 'number').catch(() => []) : []
      const signalsRead = {
        found: signals.found,
        quad: signals.quad,
        art: signals.art,
        codeTexts: codes.map((c) => c.trim()).filter(Boolean),
        nameTexts: [],
        version: signals.version,
        slab: signals.slab
      }
      const outcome = await resolveSignals(
        { ...signalsRead, textBands: [], cues: null, look: null },
        {
          game: 'op',
          setPrintings: null,
          defaultRarity: null,
          filterLanguage: t.language === 'ja' ? 'ja' : 'en',
          artDistance: async (a, b) => index.distanceBetween(a, b),
          lookups
        }
      )
      const ms = Math.round(performance.now() - start)
      if (process.env.SCAN_OP_SAVE && signals.quad) {
        const card = warpCard(cv, img, signals.quad)
        const name = t.file.replace(/^.*\//, '')
        writeFileSync(join(home(process.env.SCAN_OP_SAVE), name), encode(card, 85).data)
      }
      if (process.env.SCAN_OP_OUT) raws[t.file] = signalsRead

      const [lang, number] = t.sourceId.split('/')
      let result: string = outcome.kind
      let got = '-'
      let why = ''
      if (outcome.kind === 'recognized') {
        const { item } = outcome
        const itemLang = item.options.find((o) => o.printingId === item.printingId)?.language
        const sure = item.flag === null
        const bandai = bandaiOf.pluck().get(item.printingId!) ?? '?'
        const problems: string[] = []
        if ((item.setCode ?? '').toUpperCase() !== number.toUpperCase()) problems.push('card')
        if (itemLang !== lang) problems.push('language')
        if (sure && bandai !== t.bandaiId) problems.push('printing')
        result = problems.length ? 'wrong' : 'right'
        why = problems.join(', ')
        got = `${item.setCode} ${itemLang} ${sure ? bandai : 'pick'} (${item.via})`
      }
      const top = signals.art[0]
      const own = signals.art.findIndex((a) => artBandai(a.imageId) === t.bandaiId)
      rows.push({
        file: t.file.replace(/^shots-op\//, '').slice(0, 8),
        tester: t.tester,
        card: number,
        bandai: t.bandaiId,
        result,
        got,
        why,
        number: codes
          .map((c) => c.trim())
          .filter(Boolean)
          .join(' | '),
        art: top ? `${artBandai(top.imageId)} @${top.distance}` : '-',
        inTop: own >= 0,
        own: own >= 0 ? `#${own + 1} @${signals.art[own].distance}` : '-',
        ms
      })
    }
    console.table(rows)
    if (process.env.SCAN_OP_OUT)
      writeFileSync(home(process.env.SCAN_OP_OUT), JSON.stringify({ rows, raws, skipped }, null, 1))
    if (skipped.length) console.log(`Left out:\n  ${skipped.join('\n  ')}`)
    const groups: Record<string, Row[]> = { all: rows }
    for (const tester of new Set(rows.map((r) => r.tester)))
      groups[tester] = rows.filter((r) => r.tester === tester)
    console.table(Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, summary(rs)])))
    const median = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[rows.length >> 1] ?? 0
    console.log(`median ${median} ms per photo`)
  }, 3_600_000)

  afterAll(async () => {
    await ocr.dispose()
    db?.close()
  })

  it(`names at most ${OP_MAX_WRONG_SHARE * 100}% of the cards it names wrong`, () => {
    const wrong = rows.filter((r) => r.result === 'wrong')
    const named = wrong.length + rows.filter((r) => r.result === 'right').length
    expect(
      wrong.length <= named * OP_MAX_WRONG_SHARE
        ? []
        : wrong.map((r) => `${r.file} (${r.bandai}) as ${r.got}: ${r.why}`)
    ).toEqual([])
  })

  it(`names the right card on at least ${OP_MIN_RIGHT_SHARE * 100}% of the photos`, () => {
    expect(rows.length).toBeGreaterThan(0)
    const right = rows.filter((r) => r.result === 'right').length
    expect(right).toBeGreaterThanOrEqual(Math.ceil(rows.length * OP_MIN_RIGHT_SHARE))
  })
})
