import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { logMagic, runMagicStep } from '../../scripts/catalog/magic'
import { parseBulkLines } from '../../scripts/catalog/magic/scryfall'
import type { ScryCard, ScrySet, ScryfallSource } from '../../scripts/catalog/magic/types'
import { pricedShareProblems } from '../../scripts/catalog/priceShare'
import { openDatabase } from '../../src/main/db/database'

async function* lines(text: string): AsyncIterable<string> {
  for (const l of text.split('\n')) yield l
}

const OBJECTS: ScryCard[] = []
let SETS: ScrySet[] = []
const NOW = new Date('2026-11-09T06:00:00Z')

let dir: string
let work: Database.Database

beforeEach(async () => {
  if (OBJECTS.length === 0) {
    for await (const c of parseBulkLines(
      lines(readFileSync('tests/fixtures/scryfall/default-cards.sample.json', 'utf8'))
    ))
      OBJECTS.push(c)
    SETS = (
      JSON.parse(readFileSync('tests/fixtures/scryfall/sets.sample.json', 'utf8')) as {
        data: ScrySet[]
      }
    ).data
  }
  dir = mkdtempSync(join(tmpdir(), 'mtg-step-'))
  work = openDatabase(join(dir, 'work.sqlite'))
})

afterEach(() => {
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

const source = (objects: ScryCard[], sets: ScrySet[] = SETS): ScryfallSource => ({
  bulkInfo: async () => ({ downloadUri: 'https://x/bulk.json', updatedAt: '2026-11-09T09:00:00Z' }),
  async *cards() {
    yield* objects
  },
  sets: async () => sets
})

const run = (src: ScryfallSource, log: string[] = []): ReturnType<typeof runMagicStep> =>
  runMagicStep(work, {
    cachePath: join(dir, 'magic-src.sqlite'),
    version: 'test',
    log: (l) => log.push(l),
    source: src,
    now: () => NOW
  })

const mtgCount = (t: string): number =>
  (work.prepare(`SELECT count(*) AS n FROM ${t} WHERE game = 'mtg'`).get() as { n: number }).n

describe('runMagicStep', () => {
  it('end to end: rows written, priced counted', async () => {
    const out = await run(source(OBJECTS))
    expect(out.error).toBeNull()
    expect(out.problems).toEqual([])
    const r = out.report!
    expect(r.printings).toBeGreaterThan(0)
    expect(mtgCount('card_printings')).toBe(r.printings)
    expect(mtgCount('cards')).toBe(r.cards)
    const priced = (
      work
        .prepare(
          "SELECT count(*) AS n FROM card_printings WHERE game = 'mtg' AND market_price IS NOT NULL"
        )
        .get() as { n: number }
    ).n
    expect(r.priced).toBe(priced)
    expect(r.priced).toBeGreaterThan(0)
    // A second night with the same file changes nothing.
    const again = await run(source(OBJECTS))
    expect(again.report!.printings).toBe(r.printings)
    expect(again.problems).toEqual([])
  })

  it('a non-English object with no English twin keeps its own game text', async () => {
    const en = OBJECTS.find((o) => o.lang === 'en' && !o.card_faces && o.oracle_text)!
    const ja: ScryCard = {
      ...en,
      id: '00000000-0000-4000-8000-00000000000a',
      oracle_id: '00000000-0000-4000-8000-0000000000aa',
      lang: 'ja',
      printed_name: '日本語の名前',
      oracle_text: 'Only this object has this text.',
      type_line: 'Creature — Test',
      mana_cost: '{9}'
    }
    const out = await run(source([en, ja]))
    expect(out.error).toBeNull()
    const row = work
      .prepare(
        'SELECT oracle_text, type_line, mana_cost, local_name FROM mtg_cards WHERE oracle_id = ?'
      )
      .get(ja.oracle_id) as Record<string, string>
    expect(row).toEqual({
      oracle_text: 'Only this object has this text.',
      type_line: 'Creature — Test',
      mana_cost: '{9}',
      local_name: '日本語の名前'
    })
  })

  it('a throwing source writes nothing', async () => {
    const bad: ScryfallSource = {
      ...source(OBJECTS),
      async *cards() {
        yield OBJECTS[0]
        throw new Error('Scryfall bulk file ended early')
      }
    }
    const out = await run(bad)
    expect(out.report).toBeNull()
    expect(out.error).toBe('Scryfall bulk file ended early')
    expect(mtgCount('card_printings')).toBe(0)
    expect(mtgCount('cards')).toBe(0)
  })

  it('a corrupt source cache is an error, not a throw', async () => {
    writeFileSync(join(dir, 'magic-src.sqlite'), 'garbage '.repeat(64))
    const out = await run(source(OBJECTS))
    expect(out.report).toBeNull()
    expect(out.error).not.toBeNull()
  })

  it('a share drop is a problem', async () => {
    const base = OBJECTS.find((o) => o.prices.usd !== null && o.lang === 'en')!
    const code = base.set
    const set = SETS.find((s) => s.code === code) ?? { code, name: base.set_name, set_type: 'core' }
    const twenty = (price: string | null): ScryCard[] =>
      Array.from({ length: 20 }, (_, i) => ({
        ...base,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        collector_number: String(i + 1),
        finishes: ['nonfoil'],
        prices: { usd: price, usd_foil: null, usd_etched: null }
      }))
    const first = await run(source(twenty('1.00'), [set]))
    expect(first.report!.priced).toBe(20)
    expect(first.problems).toEqual([])
    // writeMagic keeps a stored price when Scryfall drops it, so a fall shows on a rebuilt work database.
    work.close()
    work = openDatabase(join(dir, 'rebuilt.sqlite'))
    const second = await run(source(twenty(null), [set]))
    expect(second.problems).toEqual([`${code.toUpperCase()} priced share fell from 100% to 0%`])
  })
})

describe('runMagicStep after the write', () => {
  it('a set-stats failure keeps the report and is a problem', async () => {
    const { default: Database } = await import('better-sqlite3')
    const path = join(dir, 'magic-src.sqlite')
    const seed = new Database(path)
    // A trigger makes every stats write fail, after writeMagic has committed.
    seed.exec(
      "CREATE TABLE set_stats (set_code TEXT PRIMARY KEY, printings INTEGER NOT NULL, priced INTEGER NOT NULL); CREATE TRIGGER no_put BEFORE INSERT ON set_stats BEGIN SELECT RAISE(ABORT, 'disk full'); END"
    )
    seed.close()
    const out = await run(source(OBJECTS))
    expect(out.error).toBeNull()
    expect(out.report!.printings).toBeGreaterThan(0)
    expect(out.problems).toEqual([expect.stringMatching(/^Magic set stats not saved: .*disk full/)])
    expect(mtgCount('card_printings')).toBe(out.report!.printings)
  })
})

describe('pricedShareProblems', () => {
  it('ignores small sets, growth and new sets', () => {
    const old = new Map([
      ['A', { setCode: 'A', printings: 10, priced: 10 }],
      ['B', { setCode: 'B', printings: 20, priced: 10 }]
    ])
    expect(
      pricedShareProblems(old, [
        { setCode: 'A', printings: 10, priced: 0 },
        { setCode: 'B', printings: 40, priced: 10 },
        { setCode: 'C', printings: 30, priced: 0 }
      ])
    ).toEqual([])
  })
})

describe('logMagic', () => {
  it('logs the summary, poorly priced sets only, then notes', () => {
    const out: string[] = []
    logMagic(
      {
        updatedAt: 'U',
        sets: 2,
        cards: 3,
        images: 4,
        printings: 10,
        priced: 6,
        missing: 1,
        perSet: [
          { setCode: 'AAA', printings: 5, priced: 5 },
          { setCode: 'BBB', printings: 5, priced: 1 }
        ],
        byLanguage: {
          ru: { cards: 1, printings: 2, priced: 0 },
          en: { cards: 3, printings: 10, priced: 6 },
          ja: { cards: 1, printings: 1, priced: 1 }
        },
        notes: ['n1']
      },
      (l) => out.push(l)
    )
    expect(out).toEqual([
      'Magic (U): 2 sets, 3 cards, 4 images, 10 printings (6 priced), 1 missing, 1 notes',
      'Magic en: 3 cards, 10 printings (6 priced)',
      'Magic ja: 1 cards, 1 printings (1 priced)',
      'Magic ru: 1 cards, 2 printings (0 priced)',
      'Magic en BBB: 1/5 priced',
      'Magic en: n1'
    ])
  })
})
