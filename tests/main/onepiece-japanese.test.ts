import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'
import { openOpCache } from '../../scripts/catalog/onepiece/cache'
import {
  englishArt,
  logOnePieceJapanese,
  runOnePieceJapaneseStep,
  twinLabel,
  versionOfLabel
} from '../../scripts/catalog/onepiece/japanese'
import type { OnePieceSources } from '../../scripts/catalog/onepiece/sources'
import type { BandaiEntry } from '../../scripts/catalog/onepiece/types'
import { writeOnePiece } from '../../scripts/catalog/onepiece/write'
import { decodeImage } from '../../scripts/catalog/references'
import { openDatabase } from '../../src/main/db/database'
import { onePieceCardId, onePieceImageId } from '../../src/shared/games'
import { artHash } from '../../src/shared/scan/fingerprint'
import { hashHex } from '../../src/shared/scan/fingerprintRefs'

const read = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')
const EN_SERIES = parseSeriesList(read('bandai-op17.html')).series
const EN = parseCardList(read('bandai-op17.html'), EN_SERIES[0].id).entries
const en = (id: string): BandaiEntry => EN.find((e) => e.bandaiId === id)!
const JA_SERIES = parseSeriesList(read('bandai-ja-op17.html')).series.filter(
  (s) => s.id === '550117'
)
const JA = parseCardList(read('bandai-ja-op17.html'), '550117').entries
const ja = (id: string): BandaiEntry => JA.find((e) => e.bandaiId === id)!
/** The Japanese OP17-005 versions, made from the Leader's block; `_p3` is Japanese only. */
const JA_005 = ['OP17-005', 'OP17-005_p1', 'OP17-005_p2', 'OP17-005_p3'].map((bandaiId) => ({
  ...ja('OP17-001'),
  bandaiId,
  number: 'OP17-005',
  rarity: 'SR',
  cardType: 'Character',
  life: null,
  cost: 7
}))
const NOW = Date.parse('2026-11-04T06:00:00Z')

/** A 60x84 picture of random grey blocks; `tweak` shifts one block, a few hash bits away. */
function png(seed: number, tweak = 0): Uint8Array {
  const p = new PNG({ width: 60, height: 84 })
  let s = (seed * 2654435761) >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const cells = Array.from({ length: 6 * 7 }, () => Math.floor(rnd() * 256))
  for (let y = 0; y < 84; y++) {
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 4
      let v = cells[Math.floor(y / 12) * 6 + Math.floor(x / 10)]
      if (tweak && x < 10 && y < 12) v = (v + tweak) % 256
      p.data[i] = p.data[i + 1] = p.data[i + 2] = v
      p.data[i + 3] = 255
    }
  }
  return new Uint8Array(PNG.sync.write(p))
}
const hashOf = (b: Uint8Array): string => hashHex(artHash(decodeImage(b)!))

/** English art: base 1, Manga 2, Alternate Art 3. */
const EN_ART: Record<string, number> = { 'OP17-005': 1, 'OP17-005_p1': 2, 'OP17-005_p2': 3 }
/** Japanese art: the same pictures re-encoded, in another order; _p3 is new. */
const JA_ART: Record<string, number> = {
  'OP17-005': 1,
  'OP17-005_p1': 3,
  'OP17-005_p2': 2,
  'OP17-005_p3': 9
}

function jaSources(entries: BandaiEntry[], requests: string[] = []): OnePieceSources {
  return {
    async series() {
      return { series: JA_SERIES.map((s) => ({ ...s })), notes: [] }
    },
    async entries(series) {
      return {
        entries: entries.filter((e) => series.some((s) => s.id === e.seriesId)),
        problems: [],
        notes: []
      }
    },
    async bandaiImage(id) {
      requests.push(id)
      return { bytes: png(JA_ART[id] ?? 50 + requests.length, 40), lastModified: null }
    }
  } as unknown as OnePieceSources
}

let dir: string
let work: Database.Database
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'op-ja-'))
  work = openDatabase(join(dir, 'work.sqlite'))
})
afterEach(() => {
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

/** The English rows and art hashes the English step would have left. */
function english(): void {
  const entries = ['OP17-005', 'OP17-005_p1', 'OP17-005_p2'].map(en)
  writeOnePiece(
    work,
    {
      series: EN_SERIES,
      entries,
      groupOf: new Map(),
      prices: new Map(),
      matches: new Map([
        [
          'OP17-005_p1',
          {
            bandaiId: 'OP17-005_p1',
            label: 'Manga',
            product: {
              productId: 1,
              groupId: 1,
              name: '',
              number: 'OP17-005',
              rarity: 'SR',
              imageUrl: null
            }
          }
        ],
        [
          'OP17-005_p2',
          {
            bandaiId: 'OP17-005_p2',
            label: 'Alternate Art',
            product: {
              productId: 2,
              groupId: 1,
              name: '',
              number: 'OP17-005',
              rarity: 'SR',
              imageUrl: null
            }
          }
        ]
      ]),
      hashed: new Set(entries.map((e) => e.bandaiId)),
      frozen: new Set(),
      firstSeen: new Map()
    },
    { now: NOW, nowIso: new Date(NOW).toISOString() }
  )
  const cache = openOpCache(join(dir, 'onepiece-src.sqlite'))
  for (const [bandaiId, seed] of Object.entries(EN_ART)) {
    cache.putBandaiArt({
      bandaiId,
      hash: hashOf(png(seed)),
      lastModified: null,
      checkedAt: NOW,
      storedAt: NOW,
      changedHash: null,
      notedAt: null,
      tooLargeAt: null
    })
  }
  cache.close()
}

const step = (
  sources: OnePieceSources,
  log: string[] = []
): ReturnType<typeof runOnePieceJapaneseStep> =>
  runOnePieceJapaneseStep(work, {
    cachePath: join(dir, 'onepiece-ja-src.sqlite'),
    englishCachePath: join(dir, 'onepiece-src.sqlite'),
    version: 'test',
    log: (l) => log.push(l),
    sources,
    now: () => new Date(NOW)
  })

const jaRows = (): [string, string][] =>
  (
    work
      .prepare(
        "SELECT set_rarity_code AS c, set_rarity AS r FROM card_printings WHERE game = 'op' AND language = 'ja' ORDER BY c"
      )
      .all() as { c: string; r: string }[]
  ).map((x) => [x.c, x.r])

describe('Japanese One Piece step', () => {
  test('labels parallels by their English twin, not by suffix; a Japanese-only parallel is Parallel', async () => {
    english()
    const log: string[] = []
    const out = await step(jaSources(JA_005), log)
    expect(out.error).toBeNull()
    expect(out.problems).toEqual([])
    expect(jaRows()).toEqual([
      ['OP17-005', 'SR'],
      ['OP17-005_p1', 'SR (Alternate Art)'],
      ['OP17-005_p2', 'SR (Manga)'],
      ['OP17-005_p3', 'SR (Parallel)']
    ])
    // The Japanese set takes the English set's name; the card reads as the English card.
    expect(
      work.prepare("SELECT set_name FROM sets WHERE game = 'op' AND language = 'ja'").all()
    ).toEqual([{ set_name: 'THE WORLD’S STRONGEST WARRIORS [OP-17]' }])
    const name = (id: number): unknown =>
      work.prepare('SELECT name FROM cards WHERE id = ?').get(id)
    expect(name(onePieceCardId('ja', 'OP17-005'))).toEqual(name(onePieceCardId('en', 'OP17-005')))
    expect(
      work
        .prepare('SELECT bandai_id FROM onepiece_images WHERE image_id = ?')
        .get(onePieceImageId('ja', 'OP17-005_p3'))
    ).toEqual({ bandai_id: 'ja:OP17-005_p3' })
    expect(out.report).toMatchObject({ cards: 1, printings: 4, priced: 0, labelled: 2 })
    logOnePieceJapanese(out.report!, (l) => log.push(l))
    expect(log).toContain(
      'One Piece ja: 1 series, 1 cards, 4 printings (0 held), 4 images, 2 parallels labelled from English, 0 notes'
    )
  })

  test('with no English yet, every parallel is Parallel and the Japanese name stays', async () => {
    const out = await step(jaSources([ja('OP17-001'), ja('OP17-001_p1')]))
    expect(out.error).toBeNull()
    expect(jaRows()).toEqual([
      ['OP17-001', 'L'],
      ['OP17-001_p1', 'L (Parallel)']
    ])
    expect(
      work.prepare('SELECT name FROM cards WHERE id = ?').get(onePieceCardId('ja', 'OP17-001'))
    ).toEqual({ name: 'エドワード・ニューゲート' })
    expect(
      work.prepare("SELECT set_name FROM sets WHERE game = 'op' AND language = 'ja'").all()
    ).toEqual([{ set_name: '世界最強の戦士 [OP-17]' }])
  })

  test('a source failure is the error; nothing is written', async () => {
    const sources = {
      ...jaSources([]),
      series: async () => {
        throw new Error('GET https://www.onepiece-cardgame.com/cardlist/ returned 503')
      }
    } as OnePieceSources
    const out = await step(sources)
    expect(out.error).toMatch(/returned 503/)
    expect(jaRows()).toEqual([])
  })

  test('twinLabel needs one close English entry, with a margin', () => {
    const h = (seed: number, tweak = 0): string => hashOf(png(seed, tweak))
    const english = [
      { bandaiId: 'X', label: 'SR', hash: h(1) },
      { bandaiId: 'X_p1', label: 'SR (Manga)', hash: h(2) }
    ]
    expect(twinLabel(h(2, 40), english)).toBe('Manga')
    // Base art: the base's label names no version.
    expect(twinLabel(h(1, 40), english)).toBeNull()
    expect(twinLabel(h(7), english)).toBeNull()
    // Two English entries of the same art (a plain parallel foil): no label.
    expect(
      twinLabel(h(2, 40), [
        ...english,
        { bandaiId: 'X_p2', label: 'SR (Parallel)', hash: h(2, 20) }
      ])
    ).toBeNull()
    expect(twinLabel(h(2), [])).toBeNull()
  })

  test('versionOfLabel', () => {
    expect(versionOfLabel('SR (Alternate Art 2)')).toBe('Alternate Art')
    expect(versionOfLabel('SEC (Manga)')).toBe('Manga')
    expect(versionOfLabel('SR')).toBeNull()
    expect(versionOfLabel('SP (2)')).toBeNull()
    expect(versionOfLabel('C (Reprint)')).toBeNull()
  })

  test('englishArt reads nothing from a missing cache', () => {
    expect(englishArt(join(dir, 'none.sqlite')).size).toBe(0)
  })
})
