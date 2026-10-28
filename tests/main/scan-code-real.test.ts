// @vitest-environment node
/// <reference types="electron" />
// Type-checked under tsconfig.phone.json (web and node types), since it reaches the renderer's
// scan engine as well as main's OCR, which needs Electron's process types.
// Set-code reading on the owner's real webcam photos and on card scans, through the scanner's own
// path: the vision worker's analyze, tesseract, then resolveSignals with the app's lookups. The
// photos and the catalog stay out of the (public) repo, so this runs only when pointed at them:
//   SCAN_REAL_DIR=<dir with truth.json and shot_*.jpg>       real photos
//   SCAN_CARD_SCANS=<dir of <cardId>__<anything>.png|jpg>    card scans, laid on a dark desk
//   SCAN_DB=<a copy of collection.db>  SCAN_FINGERPRINTS=<fingerprints.bin>   both needed
//   npx cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run \
//     --maxWorkers=2 --silent=false tests/main/scan-code-real.test.ts
// It reports, per frame type and bare, in a plain case or in a labelled case: how often a code read names the right card,
// how often the frame is recognized as it, and any frame recognized as the wrong card.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { decodeFingerprints, type FingerprintIndex } from '../../src/shared/scan/fingerprintFile'
import { setCodeCandidates } from '../../src/shared/scan/setCode'
import type { RgbaImage } from '../../src/shared/scan/types'
import { createOcr } from '../../src/main/scan/ocr'
import {
  cardsForImages,
  matchName,
  printingsByCode,
  printingsForCards
} from '../../src/main/repo/scan'
import { resolveSignals, type ResolveContext } from '../../src/renderer/src/features/scan/resolve'
import { analyze } from '../../src/renderer/src/features/scan/vision/analyze'
import { loadCv, type CV } from '../../src/renderer/src/features/scan/vision/cv'

// Same reason as in scan-vision-detect.test.ts: hand vitest the plain OpenCV module.
vi.mock('@techstark/opencv-js', async () => {
  const { createRequire } = await import('node:module')
  return { default: createRequire(import.meta.url)('@techstark/opencv-js') }
})

const REAL = process.env.SCAN_REAL_DIR
const SCANS = process.env.SCAN_CARD_SCANS
const DB = process.env.SCAN_DB
const FP = process.env.SCAN_FINGERPRINTS

interface Shot {
  file: string
  cardId: number | null
  frameType: string
  /** bare, plain case (a clear magnetic one) or labelled case (with a printed label insert). */
  holder: string
  load(): RgbaImage
}

interface Row {
  file: string
  frameType: string
  holder: string
  /** A code read names a printing of the right card. */
  codeRight: boolean
  /** The code resolveSignals would take names another card. */
  codeWrong: boolean
  outcome: string
  codeTexts: string
  /** The closest artwork's card and distance. */
  art: string
  /** The right card is among the closest artworks. */
  inTop: boolean
  visionMs: number
  ocrMs: number
}

function loadImage(path: string): RgbaImage {
  const bytes = readFileSync(path)
  if (bytes[0] === 0x89) {
    const png = PNG.sync.read(bytes)
    return { width: png.width, height: png.height, data: png.data }
  }
  return decode(bytes, { useTArray: true, formatAsRGBA: true })
}

/** A card scan on a dark, slightly noisy desk with room around it, as a camera frame. */
function onDesk(card: RgbaImage): RgbaImage {
  const width = Math.round(card.width * 1.6)
  const height = Math.round(card.height * 1.4)
  const data = new Uint8ClampedArray(width * height * 4)
  let seed = 7
  for (let i = 0; i < width * height; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    const v = 38 + ((seed >>> 16) % 12)
    data.set([v, v, v + 4, 255], i * 4)
  }
  const x0 = Math.round((width - card.width) / 2)
  const y0 = Math.round((height - card.height) / 2)
  for (let y = 0; y < card.height; y++)
    for (let x = 0; x < card.width; x++) {
      const s = (y * card.width + x) * 4
      const d = ((y0 + y) * width + x0 + x) * 4
      data.set([card.data[s], card.data[s + 1], card.data[s + 2], 255], d)
    }
  return { width, height, data }
}

const pct = (n: number, of: number): string => `${n}/${of} (${((100 * n) / (of || 1)).toFixed(0)}%)`

function summarize(label: string, rows: Row[]): void {
  console.table(rows)
  const groups = new Map<string, Row[]>()
  const add = (key: string, r: Row): void => {
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  for (const r of rows) {
    add('all', r)
    add(`frame ${r.frameType}`, r)
    add(r.holder, r)
  }
  const ok = (r: Row): boolean => r.outcome.startsWith('right')
  console.log(label)
  console.table(
    Object.fromEntries(
      [...groups].map(([key, rs]) => [
        key,
        {
          'code names the card': pct(rs.filter((r) => r.codeRight).length, rs.length),
          'recognized right': pct(rs.filter(ok).length, rs.length),
          'by code': rs.filter((r) => r.outcome === 'right code').length,
          wrong: rs.filter((r) => r.outcome.startsWith('wrong')).length,
          'missed, card in top art': rs.filter((r) => !ok(r) && r.inTop).length,
          'code wrong': rs.filter((r) => r.codeWrong).length
        }
      ])
    )
  )
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0
  console.log(
    `${label}: vision median ${median(rows.map((r) => r.visionMs))} ms, OCR median ${median(
      rows.map((r) => r.ocrMs)
    )} ms per frame`
  )
}

describe.skipIf(!DB || !FP || (!REAL && !SCANS))('set codes read on real photos and scans', () => {
  let cv: CV
  let index: FingerprintIndex
  let db: Database.Database
  const ocr = createOcr()

  beforeAll(async () => {
    cv = await loadCv()
    index = decodeFingerprints(readFileSync(FP!))
    db = new Database(DB!, { readonly: true, fileMustExist: true })
  }, 120_000)

  afterAll(async () => {
    await ocr.dispose()
    db?.close()
  })

  async function measure(shots: Shot[]): Promise<Row[]> {
    const ctx: ResolveContext = {
      setName: null,
      setPrintings: null,
      defaultRarity: null,
      lookups: {
        printingsByCode: async (code) => printingsByCode(db, code),
        printingsForCards: async (ids) => printingsForCards(db, ids),
        matchName: async (text) => matchName(db, text),
        cardsForImages: async (ids) => cardsForImages(db, ids)
      }
    }
    const rows: Row[] = []
    for (const s of shots) {
      const img = s.load()
      let t = performance.now()
      const signals = analyze(cv, img, index, null, true)
      const visionMs = Math.round(performance.now() - t)
      t = performance.now()
      const [codes, names] = await Promise.all([
        signals.codeBands.length ? ocr.read(signals.codeBands, 'code') : [],
        signals.nameBands.length ? ocr.read(signals.nameBands, 'name') : []
      ])
      const ocrMs = Math.round(performance.now() - t)
      const codeTexts = codes.map((c) => c.trim()).filter(Boolean)
      const outcome = await resolveSignals(
        {
          found: signals.found,
          quad: signals.quad,
          art: signals.art,
          codeTexts,
          nameTexts: names.map((c) => c.trim()).filter(Boolean),
          textBands: [],
          cues: null,
          look: null
        },
        ctx
      )
      const named = codeTexts.flatMap((text) =>
        setCodeCandidates(text).flatMap((code) => printingsByCode(db, code))
      )
      const firstNamed = named[0]
      rows.push({
        file: s.file,
        frameType: s.frameType,
        holder: s.holder,
        codeRight: s.cardId !== null && named.some((p) => p.cardId === s.cardId),
        codeWrong: firstNamed !== undefined && firstNamed.cardId !== s.cardId,
        outcome:
          outcome.kind === 'recognized'
            ? `${outcome.item.cardId === s.cardId ? 'right' : 'wrong'} ${outcome.item.via}`
            : outcome.kind,
        codeTexts: codeTexts.join(' | '),
        art: artOf(signals.art),
        inTop:
          s.cardId !== null &&
          cardsForImages(
            db,
            signals.art.map((a) => a.imageId)
          ).some((c) => c.cardId === s.cardId),
        visionMs,
        ocrMs
      })
    }
    return rows
  }

  const artOf = (art: { imageId: number; distance: number }[]): string => {
    if (!art[0]) return '-'
    const card = cardsForImages(db, [art[0].imageId])[0]
    const name = card
      ? (db.prepare('SELECT name FROM cards WHERE id = ?').get(card.cardId) as { name: string })
          .name
      : '?'
    return `${card?.cardId ?? art[0].imageId} ${name.slice(0, 28)} @${art[0].distance}`
  }

  const frameOf = (cardId: number | null): string =>
    cardId === null
      ? '-'
      : ((
          db.prepare('SELECT frame_type AS f FROM cards WHERE id = ?').get(cardId) as
            { f: string } | undefined
        )?.f ?? '-')

  it.skipIf(!REAL)(
    'real photos',
    async () => {
      const truth = JSON.parse(readFileSync(join(REAL!, 'truth.json'), 'utf8')) as {
        file: string
        cardId: number | null
        imageCandidates?: number[]
        frameType?: string | null
        flags: string[]
      }[]
      const shots: Shot[] = truth
        .filter((t) => !t.flags.includes('unsure') && !t.flags.includes('multiple'))
        .map((t) => {
          const cardId = t.cardId ?? cardsForImages(db, t.imageCandidates ?? [])[0]?.cardId ?? null
          return {
            file: t.file,
            cardId,
            frameType: t.frameType ?? frameOf(cardId),
            holder: t.flags.includes('labelled')
              ? 'labelled case'
              : t.flags.includes('cased')
                ? 'plain case'
                : 'bare',
            load: () => loadImage(join(REAL!, t.file))
          }
        })
      const rows = await measure(shots)
      summarize(`real photos in ${REAL}`, rows)
      // A wrong code read must never be taken for the card.
      expect(rows.filter((r) => r.outcome === 'wrong code').map((r) => r.file)).toEqual([])
    },
    1_800_000
  )

  it.skipIf(!SCANS)(
    'card scans',
    async () => {
      const shots: Shot[] = readdirSync(SCANS!)
        .filter((f) => /^\d+__.*\.(png|jpe?g)$/i.test(f))
        .sort()
        .map((f) => {
          const cardId = Number(f.split('__')[0])
          return {
            file: f,
            cardId,
            frameType: frameOf(cardId),
            holder: 'bare',
            load: () => onDesk(loadImage(join(SCANS!, f)))
          }
        })
      const rows = await measure(shots)
      summarize(`card scans in ${SCANS}`, rows)
      expect(rows.filter((r) => r.outcome === 'wrong code').map((r) => r.file)).toEqual([])
    },
    1_800_000
  )
})
