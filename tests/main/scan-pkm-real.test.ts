// @vitest-environment node
// The Pokémon scanner on real photos: the owner's shots and eBay listing photos, through the
// app's own path per photo: the vision worker's analyze (detect, warp, art, version cues, slab),
// tesseract for the collector number and the language (one read per model, as the scan window
// reads scan:readText), then resolveSignals with the app's lookups. The photos and the catalog
// stay out of the (public) repo, so this runs only when SCAN_PKM_DIR points at them:
//   SCAN_PKM_DIR=~/scan-capture   pkm-truth.json, the photos it names, and pkm-work/ (catalog.sqlite
//                                 and fingerprints-pkm.bin, from scripts/scan/pokemon-corpus/prep.ts)
//   SCAN_PKM_TRUTH=<file>         another truth file (default SCAN_PKM_DIR/pkm-truth.json)
//   SCAN_PKM_OUT=<file>           also write the per-photo rows there as JSON, with every signal the
//                                 resolver takes (raws), so resolver changes can be replayed offline
//   SCAN_PKM_LIVE=1               as a live frame: short holder search, language preset from the truth
//   SCAN_PKM_CROP=1               scan each photo at the app's framing: the live scan's centre crop
//                                 (810x1080 of a 1080p frame), not the whole photo
//   SCAN_PKM_DIR=~/scan-capture npm test -- --silent=false tests/main/scan-pkm-real.test.ts
// (--silent=false shows the per-photo and summary tables when the tests pass.)
// Wrong is another card, another language, a version named as sure that isn't the photo's, a
// graded tag on a card that isn't in a slab, or any card named for a Chinese or other-language
// photo. At most PKM_MAX_WRONG_SHARE of the cards named may be wrong, and the right card must be
// named on MIN_RIGHT_SHARE of the photos that can be (English or Japanese, the card known), over all
// photos and the owner's alone. The latter is the owner's goal and fails for now.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MIN_RIGHT_SHARE, PKM_MAX_WRONG_SHARE } from '../../scripts/catalog/accuracy'
import { pokemonId } from '../../src/shared/games/ids'
import { PKM_PHOTO_REPRINT_LEAD } from '../../src/shared/scan/thresholds'
import { decodeFingerprints, type FingerprintIndex } from '../../src/shared/scan/fingerprintFile'
import { readTexts } from '../../src/shared/scan/ocr'
import {
  tellPokemonLanguage,
  type PokemonTextLanguage
} from '../../src/shared/scan/pokemonLanguage'
import { scanProfile } from '../../src/shared/scan/profiles'
import type { OcrBand, RgbaImage } from '../../src/shared/scan/types'
import { createOcr } from '../../src/main/scan/ocr'
import {
  cardsForImages,
  imagesForLanguage,
  matchName,
  printingsByCode,
  printingsByNumber,
  printingsForCards
} from '../../src/main/repo/scan'
import { localScope } from '../../src/main/repo/scope'
import { resolveSignals, type ResolveContext } from '../../src/renderer/src/features/scan/resolve'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'
import { appFrame } from './scan-app-frame'
import { problemsOf, type Truth } from './scan-pkm-score'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

interface Row {
  file: string
  source: string
  card: string
  lang: string
  holder: string
  version: string
  /** right, wrong, unsure or none. */
  result: string
  /** What was named: card, language, version (or "any version") and slab. */
  got: string
  /** Why it is wrong, when it is. */
  why: string
  number: string
  /** The name band's reads, and with the Japanese model when the language wasn't told. */
  name: string
  localName: string
  read: string
  /** The closest artwork's card and distance. */
  art: string
  /** The photo's card is among the closest artworks. */
  inTop: boolean
  ms: number
  /** Can count toward the right share: English or Japanese, the card known. */
  scorable: boolean
  /** The stamp's kind (stampKind), or '' for none. */
  stamp: string
  /** 'holder' when the art matched only on the holder search's second look. */
  via: string
}

/** A stamp grouped loosely by kind, for the breakdown. */
function stampKind(stamp: string): string {
  const s = stamp.toLowerCase()
  if (s.includes('mcdonald')) return "McDonald's"
  if (s.includes('1st edition')) return '1st Edition'
  if (s.includes('staff')) return 'Staff'
  if (s.includes('prerelease') || s.includes('pre release')) return 'Prerelease'
  if (s.includes('30th')) return '30th'
  if (s.includes('25th') || s.includes('celebration')) return '25th/Celebrations'
  if (s.includes('cosmos')) return 'Cosmos'
  if (s.includes('set-logo') || s.includes('set logo')) return 'Set logo'
  if (/league|championship|play! pok|winner|gym challenge|qualifier/.test(s))
    return 'League/Championships'
  if (s.includes('pokemon center') || s.includes('pokémon center')) return 'Pokemon Center'
  return 'other'
}

const home = (p: string): string => p.replace(/^~/, homedir())
const DIR = process.env.SCAN_PKM_DIR ? home(process.env.SCAN_PKM_DIR) : undefined
const TRUTH = DIR ? home(process.env.SCAN_PKM_TRUTH ?? join(DIR, 'pkm-truth.json')) : undefined
const WORK = DIR ? join(DIR, 'pkm-work') : undefined
const READY = !!DIR && existsSync(TRUTH!)
const CROP = process.env.SCAN_PKM_CROP === '1'
// A live frame: the short holder search, and the language told rather than read.
const LIVE = process.env.SCAN_PKM_LIVE === '1'
const preset = (t: Truth): 'en' | 'ja' => (t.language === 'ja' ? 'ja' : 'en')
if (DIR && !READY)
  console.warn(`Pokémon real-photo gate skipped: no truth file at ${TRUTH} (see the test's header)`)

function loadImage(path: string): RgbaImage {
  const bytes = readFileSync(path)
  if (bytes[0] === 0x89) {
    const png = PNG.sync.read(bytes)
    return { width: png.width, height: png.height, data: png.data }
  }
  return decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
}

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0

const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(1)}%)`

function summary(rows: Row[]): Record<string, string | number> {
  const scorable = rows.filter((r) => r.scorable)
  return {
    photos: rows.length,
    scorable: scorable.length,
    right: pct(scorable.filter((r) => r.result === 'right').length, scorable.length),
    wrong: rows.filter((r) => r.result === 'wrong').length,
    unsure: rows.filter((r) => r.result === 'unsure').length,
    none: rows.filter((r) => r.result === 'none').length,
    'card in top art': pct(scorable.filter((r) => r.inTop).length, scorable.length)
  }
}

describe.skipIf(!READY)('the Pokémon scanner on real photos', () => {
  let cv: CV
  let index: FingerprintIndex
  let db: Database.Database
  const ocr = createOcr()
  const rows: Row[] = []
  /** The text box's reads per photo, for SCAN_PKM_OUT. */
  const texts: Record<string, { eng: string[]; jpn: string[] }> = {}
  /** The version cues per photo, for SCAN_PKM_OUT. */
  const cues: Record<string, unknown> = {}
  /** The signals per photo, language and name reads forced, for SCAN_PKM_OUT. */
  const raws: Record<string, unknown> = {}
  /** Truth rows left out: unclear which card, or the photo isn't there. */
  const skipped: string[] = []

  beforeAll(async () => {
    cv = await loadCv()
    index = decodeFingerprints(readFileSync(join(WORK!, 'fingerprints-pkm.bin')))
    db = new Database(join(WORK!, 'catalog.sqlite'), { readonly: true, fileMustExist: true })
    const scope = localScope("'pkm'")
    const lookups: ResolveContext['lookups'] = {
      printingsByCode: async (code) => printingsByCode(db, code, scope),
      printingsByNumber: async (n) => printingsByNumber(db, n, scope),
      printingsForCards: async (ids) => printingsForCards(db, ids, scope),
      matchName: async (text) => matchName(db, text, scope),
      cardsForImages: async (ids) => cardsForImages(db, ids, scope)
    }
    const nameOf = (cardId: number): string =>
      (db.prepare('SELECT name FROM cards WHERE id = ?').pluck().get(cardId) as string) ?? '?'
    const truth = JSON.parse(readFileSync(TRUTH!, 'utf8')) as Truth[]
    const profile = scanProfile('pkm')
    const narrowed = new Map<string, FingerprintIndex>()
    const liveIndex = (language: 'en' | 'ja'): FingerprintIndex => {
      const had = narrowed.get(language)
      if (had) return had
      const only = index.only(new Set(imagesForLanguage(db, language, scope)))
      narrowed.set(language, only)
      return only
    }

    for (const t of truth) {
      const path = join(DIR!, t.file)
      if (t.unclear === 'card') {
        skipped.push(`${t.file}: unclear card`)
        continue
      }
      if (!existsSync(path)) {
        skipped.push(`${t.file}: no such file`)
        continue
      }
      let img: RgbaImage
      try {
        img = loadImage(path)
        if (CROP) img = appFrame(img)
      } catch (e) {
        skipped.push(`${t.file}: ${e instanceof Error ? e.message : e}`)
        continue
      }
      const start = performance.now()
      const signals = analyze(
        cv,
        img,
        LIVE ? liveIndex(preset(t)) : index,
        null,
        true,
        false,
        profile,
        true,
        null,
        !LIVE
      )
      cues[t.file] = signals.version
      // As the scan engine reads them: empty bands dropped, the code band as a collector number.
      const codeBands = signals.codeBands.filter(hasPixels)
      const nameBands = signals.nameBands.filter(hasPixels)
      const textBands = signals.textBands.filter(hasPixels)
      const read = (bands: OcrBand[], kind: 'number' | 'name'): Promise<string[]> =>
        bands.length ? ocr.read(bands, kind).catch(() => []) : Promise.resolve([])
      const [codes, names] = signals.found
        ? await Promise.all([read(codeBands, 'number'), read(nameBands, 'name')])
        : [[], []]
      let language = '-'
      let localName = ''
      // As the scan loop's pokemonLanguageOf; a failed read counts as not told.
      const readLanguage = async (): Promise<PokemonTextLanguage> => {
        if (LIVE) return preset(t)
        if (!textBands.length) return null
        try {
          const heard = { eng: [] as string[], jpn: [] as string[] }
          const lang = await tellPokemonLanguage(textBands, async (bands, model) => {
            const read = await readTexts(ocr, bands, model)
            heard[model].push(...read)
            return read
          })
          texts[t.file] = heard
          language = lang ?? 'null'
          return lang
        } catch {
          language = 'failed'
          return null
        }
      }
      // As the scan loop's pokemonNamesOf, on one frame: the name band with the Japanese model.
      const readLocalName = async (): Promise<string[]> => {
        if (!nameBands.length) return []
        const reads = await readTexts(ocr, nameBands, 'jpn').catch(() => [])
        localName = reads
          .map((r) => r.trim())
          .filter(Boolean)
          .join(' | ')
        return reads
      }
      const once = <T>(read: () => Promise<T>): (() => Promise<T>) => {
        let done: Promise<T> | null = null
        return () => (done ??= read())
      }
      const langOnce = once(readLanguage)
      const namesOnce = once(readLocalName)
      const signalsRead = {
        found: signals.found,
        quad: signals.quad,
        art: signals.art,
        codeTexts: codes.map((c) => c.trim()).filter(Boolean),
        nameTexts: names.map((c) => c.trim()).filter(Boolean),
        version: signals.version,
        slab: signals.slab,
        ...(signals.artVia ? { artVia: signals.artVia } : {})
      }
      const outcome = await resolveSignals(
        { ...signalsRead, textBands, cues: null, look: null },
        {
          game: 'pkm',
          ...(LIVE ? {} : { reprintLead: PKM_PHOTO_REPRINT_LEAD }),
          setName: null,
          setPrintings: null,
          defaultRarity: null,
          lookups,
          readLanguage: langOnce,
          readLocalName: namesOnce
        }
      )
      const ms = Math.round(performance.now() - start)
      if (process.env.SCAN_PKM_OUT && signals.found)
        raws[t.file] = {
          ...signalsRead,
          language: await langOnce(),
          localNames: await namesOnce()
        }

      const cardId = t.sourceId ? pokemonId(t.sourceId) : null
      const scorable = cardId !== null && (t.language === 'en' || t.language === 'ja')
      let result: string = outcome.kind
      let got = '-'
      let why = ''
      if (outcome.kind === 'recognized') {
        const { item } = outcome
        const lang = item.options.find((o) => o.printingId === item.printingId)?.language
        const sure = item.flag === null
        const problems = problemsOf(t, cardId, item)
        result = problems.length ? 'wrong' : 'right'
        why = problems.join(', ')
        got = `${item.name} ${lang} ${sure ? item.rarity : 'any version'}${item.slab ? ' slab' : ''}`
      }
      const top = signals.art[0]
      const artCards = cardsForImages(
        db,
        signals.art.map((a) => a.imageId),
        scope
      )
      const topCard = top ? artCards.find((c) => c.imageId === top.imageId) : undefined
      rows.push({
        file: t.file,
        source: t.source,
        card: cardId === null ? '-' : nameOf(cardId),
        lang: t.language,
        holder: t.holder,
        version: t.unclear === 'version' ? '?' : (t.version ?? '-'),
        result,
        got,
        why,
        number: codes.filter(Boolean).join(' | '),
        name: names
          .map((c) => c.trim())
          .filter(Boolean)
          .join(' | '),
        localName,
        read: language,
        art: top ? `${topCard ? nameOf(topCard.cardId).slice(0, 24) : '?'} @${top.distance}` : '-',
        inTop: cardId !== null && artCards.some((c) => c.cardId === cardId),
        ms,
        scorable,
        stamp: t.stamp ? stampKind(t.stamp) : '',
        via: signals.artVia ?? ''
      })
    }
    console.table(rows)
    if (process.env.SCAN_PKM_OUT)
      writeFileSync(
        home(process.env.SCAN_PKM_OUT),
        JSON.stringify({ rows, texts, cues, raws, skipped }, null, 1)
      )
    if (skipped.length) console.log(`Left out:\n  ${skipped.join('\n  ')}`)
    const owner = rows.filter((r) => r.source === 'owner')
    const groups: Record<string, Row[]> = {
      all: rows,
      owner,
      ebay: rows.filter((r) => r.source === 'ebay')
    }
    for (const holder of ['bare', 'toploader', 'case', 'slab']) {
      groups[holder] = rows.filter((r) => r.holder === holder)
      for (const source of ['owner', 'ebay'])
        groups[`${source} ${holder}`] = rows.filter(
          (r) => r.holder === holder && r.source === source
        )
    }
    groups.ja = rows.filter((r) => r.lang === 'ja')
    groups.stamped = rows.filter((r) => r.stamp)
    console.table(Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, summary(rs)])))
    // Stamped photos by kind: their version is the stamp's label, or unscored when the catalog
    // has none.
    const kinds = [...new Set(rows.map((r) => r.stamp).filter(Boolean))].sort()
    console.table(
      Object.fromEntries(
        kinds.map((k) => [`stamp ${k}`, summary(rows.filter((r) => r.stamp === k))])
      )
    )
    const median = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[rows.length >> 1] ?? 0
    console.log(`median ${median} ms per photo`)
  }, 7_200_000)

  afterAll(async () => {
    await ocr.dispose()
    db?.close()
  })

  const wrongOf = (rs: Row[]): string[] =>
    rs.filter((r) => r.result === 'wrong').map((r) => `${r.file} (${r.card}) as ${r.got}: ${r.why}`)
  const rightShare = (rs: Row[]): { right: number; need: number } => {
    const scorable = rs.filter((r) => r.scorable)
    return {
      right: scorable.filter((r) => r.result === 'right').length,
      need: Math.ceil(scorable.length * MIN_RIGHT_SHARE)
    }
  }

  /** The wrong answers, listed when they're past the budget. */
  const overBudget = (rs: Row[]): string[] => {
    const wrong = wrongOf(rs)
    const named = wrong.length + rs.filter((r) => r.result === 'right').length
    return wrong.length <= named * PKM_MAX_WRONG_SHARE ? [] : wrong
  }

  it(`names at most ${PKM_MAX_WRONG_SHARE * 100}% of the cards it names wrong`, () => {
    expect(overBudget(rows)).toEqual([])
  })

  it(`names the right card on at least ${MIN_RIGHT_SHARE * 100}% of the photos`, () => {
    const { right, need } = rightShare(rows)
    expect(right).toBeGreaterThanOrEqual(need)
  })

  it(`names at most ${PKM_MAX_WRONG_SHARE * 100}% of the owner's photos it names wrong`, () => {
    expect(overBudget(rows.filter((r) => r.source === 'owner'))).toEqual([])
  })

  it(`names the right card on at least ${MIN_RIGHT_SHARE * 100}% of the owner's photos`, () => {
    const owner = rows.filter((r) => r.source === 'owner')
    // Without the owner's photos the bar would pass on nothing.
    expect(owner.length).toBeGreaterThan(0)
    const { right, need } = rightShare(owner)
    expect(right).toBeGreaterThanOrEqual(need)
  })
})
