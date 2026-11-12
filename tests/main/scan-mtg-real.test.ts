// @vitest-environment node
// The Magic scanner on real photos: the owner's booth shots of a Reality Fracture box, through
// the app's own path per photo: the vision worker's analyze (detect, warp, art), tesseract on the
// code and name bands, then resolveSignals for game 'mtg' with the app's lookups. The photos and
// the catalog live in the private darkharasho/duel-binder-scan-corpus repo (mtg/), so this runs
// only when SCAN_MTG_DIR points at them.
//   SCAN_MTG_DIR=<corpus>/mtg   mtg-truth.json, the photos it names (shots-mtg/), and mtg-work/
//                               (catalog.sqlite and fingerprints-mtg.bin, made by
//                               scripts/scan/mtg-corpus-work.ts)
//   mtg-truth.skip.json         optional, beside the truth file: [{ file, why }] photos left out
//   SCAN_MTG_OUT=<file>         also write the per-photo rows and signals there as JSON
//   SCAN_MTG_DIR=… npx vitest run --maxWorkers=2 --silent=false tests/main/scan-mtg-real.test.ts
// Right is the photo's printing: its set code and language, and its finish, or non-foil named for
// a foil (the owner's default; counted on its own line, "foil defaulted"). Wrong is another set
// code, card or language, or a wrong finish claimed. Unsure asks the user to pick (a draft flagged
// to pick a printing counts here too, with whether the photo's printing was among the choices).
// No floor yet (spec, step 5): this reports.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { decodeFingerprints, type FingerprintIndex } from '../../src/shared/scan/fingerprintFile'
import { scanProfile } from '../../src/shared/scan/profiles'
import type { OcrBand, RgbaImage } from '../../src/shared/scan/types'
import { createOcr } from '../../src/main/scan/ocr'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsByNumber,
  printingsForCards,
  printingsOfArt
} from '../../src/main/repo/scan'
import { localScope } from '../../src/main/repo/scope'
import { resolveSignals, type ResolveContext } from '../../src/renderer/src/features/scan/resolve'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { findCandidates } from '../../src/renderer/src/features/scan/vision/candidates'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { readFramed } from '../../src/renderer/src/features/scan/vision/framing'

vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('../../vendor/opencv/opencv.js') }
})

interface Truth {
  file: string
  /** 'en/FRA 81' */
  sourceId: string | null
  /** The printing's set_rarity: 'Common (Foil)'. */
  version: string | null
  name?: string
}

interface Row {
  file: string
  card: string
  version: string
  /** right, wrong, unsure or none. */
  result: string
  /** Named non-foil for a foil: right, by the owner's default. */
  foilDefaulted: boolean
  /** Unsure with the photo's printing among the choices. */
  inOptions: boolean
  token: boolean
  got: string
  why: string
  /** Tesseract's reads of the code bands, as the engine reads them and unrestricted. */
  code: string
  codeAny: string
  name: string
  /** The closest artwork's printing and distance. */
  art: string
  /** The photo's own look's rank among the closest (1-based), 0 when not among them. */
  ownRank: number
  ms: number
}

const home = (p: string): string => p.replace(/^~/, homedir())
const DIR = process.env.SCAN_MTG_DIR ? home(process.env.SCAN_MTG_DIR) : undefined
const TRUTH = DIR ? join(DIR, 'mtg-truth.json') : undefined
const WORK = DIR ? join(DIR, 'mtg-work') : undefined
const READY = !!DIR && existsSync(TRUTH!) && existsSync(join(WORK!, 'catalog.sqlite'))
if (DIR && !READY)
  console.warn(`Magic real-photo run skipped: no truth file or mtg-work/ in ${DIR}`)

const loadImage = (path: string): RgbaImage =>
  decode(readFileSync(path), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0
const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(1)}%)`
const FOIL = / \((Foil|Etched Foil)\)$/
const quantile = (xs: number[], q: number): number =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0

function summary(rows: Row[]): Record<string, string | number> {
  return {
    photos: rows.length,
    right: pct(rows.filter((r) => r.result === 'right').length, rows.length),
    'foil defaulted': rows.filter((r) => r.foilDefaulted).length,
    wrong: rows.filter((r) => r.result === 'wrong').length,
    unsure: `${rows.filter((r) => r.result === 'unsure').length} (${rows.filter((r) => r.inOptions).length} with it)`,
    none: rows.filter((r) => r.result === 'none').length,
    'own look top-1': pct(rows.filter((r) => r.ownRank === 1).length, rows.length),
    'own look top-5': pct(rows.filter((r) => r.ownRank >= 1).length, rows.length),
    'code read': pct(rows.filter((r) => r.code).length, rows.length),
    median: `${quantile(rows.map((r) => r.ms), 0.5)} ms`,
    p90: `${quantile(rows.map((r) => r.ms), 0.9)} ms`
  }
}

describe.skipIf(!READY)('the Magic scanner on real photos', () => {
  let cv: CV
  let index: FingerprintIndex
  let db: Database.Database
  const ocr = createOcr()
  const rows: Row[] = []
  const raws: Record<string, unknown> = {}
  const skipped: string[] = []
  let expected = 0

  beforeAll(async () => {
    cv = await loadCv()
    index = decodeFingerprints(readFileSync(join(WORK!, 'fingerprints-mtg.bin')))
    db = new Database(join(WORK!, 'catalog.sqlite'), { readonly: true, fileMustExist: true })
    const scope = localScope("'mtg'")
    const lookups: ResolveContext['lookups'] = {
      printingsByCode: async (code) => printingsByCode(db, code, scope),
      printingsByNumber: async (n) => printingsByNumber(db, n, scope),
      printingsForCards: async (ids) => printingsForCards(db, ids, scope),
      printingsOfArt: async (ids) => printingsOfArt(db, ids, scope),
      matchName: async (text) => matchName(db, text, scope),
      cardsForImages: async (ids) => cardsForImages(db, ids, scope)
    }
    const truthPrinting = db.prepare<[string, string, string], number>(
      `SELECT id FROM card_printings WHERE game = 'mtg' AND language = ? AND set_code = ? AND set_rarity = ?`
    )
    const truth = JSON.parse(readFileSync(TRUTH!, 'utf8')) as Truth[]
    const skipPath = TRUTH!.replace(/\.json$/, '.skip.json')
    const skip = new Map<string, string>(
      existsSync(skipPath)
        ? (JSON.parse(readFileSync(skipPath, 'utf8')) as { file: string; why: string }[]).map(
            (s) => [s.file, s.why]
          )
        : []
    )
    const profile = scanProfile('mtg')

    for (const t of truth) {
      const path = join(DIR!, t.file)
      if (skip.has(t.file)) {
        skipped.push(`${t.file}: ${skip.get(t.file)}`)
        continue
      }
      expected++
      if (!t.sourceId || !t.version) {
        skipped.push(`${t.file}: no card`)
        continue
      }
      if (!existsSync(path)) {
        skipped.push(`${t.file}: no such file`)
        continue
      }
      const slash = t.sourceId.indexOf('/')
      const lang = t.sourceId.slice(0, slash)
      const code = t.sourceId.slice(slash + 1)
      const own = truthPrinting.pluck().get(lang, code, t.version)
      const img = loadImage(path)
      const start = performance.now()
      const signals = readFramed(
        img,
        null,
        (im, first) => analyze(cv, im, index, null, true, false, profile, true, first, true),
        (im) => findCandidates(cv, im, profile)
      )
      const codeBands = signals.codeBands.filter(hasPixels)
      const nameBands = signals.nameBands.filter(hasPixels)
      const read = (bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]> =>
        signals.found && bands.length
          ? ocr.read(bands, kind).then((xs) => xs.map((x) => x.trim()).filter(Boolean), () => [])
          : Promise.resolve([])
      const codes = await read(codeBands, 'code')
      const names = await read(nameBands, 'name')
      const signalsRead = {
        found: signals.found,
        quad: signals.quad,
        art: signals.art,
        codeTexts: codes,
        nameTexts: names,
        version: signals.version,
        slab: signals.slab
      }
      const outcome = await resolveSignals(
        { ...signalsRead, textBands: [], cues: null, look: null },
        {
          game: 'mtg',
          setPrintings: null,
          defaultRarity: null,
          filterLanguage: 'en',
          artDistance: async (a, b) => index.distanceBetween(a, b),
          lookups
        }
      )
      const ms = Math.round(performance.now() - start)
      // Measured apart from the time: the unrestricted read of the code bands, for the info line.
      const codesAny = await read(codeBands, 'name')
      if (process.env.SCAN_MTG_OUT) raws[t.file] = { ...signalsRead, codesAny }

      let result: string = outcome.kind
      let got = '-'
      let why = ''
      let foilDefaulted = false
      let inOptions = false
      if (outcome.kind === 'recognized') {
        const { item } = outcome
        const p = item.options.find((o) => o.printingId === item.printingId)
        const problems: string[] = []
        if ((item.setCode ?? '').toUpperCase() !== code.toUpperCase()) problems.push('printing')
        if (p?.language !== lang) problems.push('language')
        if (item.flag === 'pick-printing') {
          result = 'unsure'
          inOptions = own !== undefined && item.options.some((o) => o.printingId === own)
        } else if (problems.length) {
          result = 'wrong'
        } else if (item.rarity === t.version) {
          result = 'right'
        } else if (FOIL.test(t.version) && item.rarity === t.version.replace(FOIL, '')) {
          result = 'right'
          foilDefaulted = true
        } else {
          result = 'wrong'
          problems.push('finish')
        }
        why = problems.join(', ')
        got = `${item.setCode} ${p?.language ?? '?'} ${item.rarity} (${item.via}${item.flag ? `, ${item.flag}` : ''})`
      }
      // The photo's own look's rank among the closest artworks.
      let ownRank = 0
      for (let i = 0; i < signals.art.length && own !== undefined; i++) {
        if (printingsOfArt(db, [signals.art[i].imageId], scope).some((x) => x.printingId === own)) {
          ownRank = i + 1
          break
        }
      }
      const top = signals.art[0]
      const topPrinting = top ? printingsOfArt(db, [top.imageId], scope)[0] : undefined
      rows.push({
        file: t.file.replace(/^shots-mtg\//, '').replace(/\.jpg$/, ''),
        card: code,
        version: t.version,
        result,
        foilDefaulted,
        inOptions,
        token: code.startsWith('TFRA '),
        got,
        why,
        code: codes.join(' | '),
        codeAny: codesAny.join(' | '),
        name: names.join(' | '),
        art: top ? `${topPrinting ? `${topPrinting.setCode} ${topPrinting.name}` : '?'} @${top.distance}` : '-',
        ownRank,
        ms
      })
    }
    console.table(
      rows.map(({ file, card, result, got, why, code, codeAny, name, art, ownRank, ms }) => ({
        file,
        card,
        result,
        got,
        why,
        code,
        codeAny,
        name,
        art,
        ownRank,
        ms
      }))
    )
    if (process.env.SCAN_MTG_OUT)
      writeFileSync(home(process.env.SCAN_MTG_OUT), JSON.stringify({ rows, raws, skipped }, null, 1))
    if (skipped.length) console.log(`Left out:\n  ${skipped.join('\n  ')}`)
    const groups: Record<string, Row[]> = {
      all: rows,
      cards: rows.filter((r) => !r.token),
      tokens: rows.filter((r) => r.token)
    }
    console.table(Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, summary(rs)])))
  }, 7_200_000)

  afterAll(async () => {
    await ocr.dispose()
    db?.close()
  })

  it('ran on every truth row not left out', () => {
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBe(expected)
  })
})
