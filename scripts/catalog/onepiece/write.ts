import type Database from 'better-sqlite3'
import { movedEnough } from '../../../src/main/tcgplayer/prices'
import { onePieceCardId, onePieceImageId } from '../../../src/shared/games'
import { OP_CARD_TYPES } from '../../../src/shared/games/onePiece'
import type { TcGroup } from '../pokemon/types'
import type { OpMatch } from './match'
import type { BandaiEntry, BandaiSeries } from './types'
import { entryKind } from './versions'

/**
 * The One Piece writer: writes the English game = 'op' catalog rows into the job's work database
 * in one transaction, in the card model of the SCHEMA_V40 doc comment (one printing per Bandai
 * entry, Builder's call 1). Every statement names game = 'op' or an onepiece_* table. Keys never
 * move: a written set keeps its name and code, a written printing its set name, code and label.
 * Nothing is deleted (an entry Bandai stops listing is flagged missing), and rows are only written
 * when a value differs, so an unchanged night diffs to nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** How long a parallel waits for a TCGplayer match before it is written as `<rarity> (Parallel)`. */
export const HOLD_UNMATCHED_MS = 7 * DAY_MS

export interface OpPlan {
  /** Every series, and its deduped entries (dedupeEntries). */
  series: BandaiSeries[]
  entries: BandaiEntry[]
  /** seriesId to its mapped TCGCSV group (for tcg_date). */
  groupOf: Map<string, TcGroup>
  matches: Map<string, OpMatch>
  /** productId to its market price (null: none or several rows). */
  prices: Map<number, number | null>
  /** Bandai ids whose art is hashed (and so exists); only these are written. */
  hashed: Set<string>
  /** Bandai ids whose art changed after it was hashed (isFrozen); their rows are left as they are. */
  frozen: Set<string>
  /** Bandai id to when the source cache first saw it. */
  firstSeen: Map<string, number>
}

export interface OnePieceReport {
  series: number
  cards: number
  printings: number
  priced: number
  /** Unmatched parallels waiting out HOLD_UNMATCHED_MS, with no printing yet. */
  held: number
  images: number
  perSet: { setCode: string; printings: number; priced: number }[]
  notes: string[]
}

export interface WriteOnePieceOpts {
  now: number
  nowIso: string
  /** Test-only: replaces onePieceCardId / onePieceImageId to force a collision. */
  idOf?: { card: (number: string) => number; image: (bandaiId: string) => number }
}

interface ExistingPrinting {
  id: number
  card_id: number
  set_name: string
  set_code: string
  set_rarity: string
  set_rarity_code: string
  tcg_product_id: number | null
  market_price: number | null
  missing_from_api: number
}

const byBandaiId = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

/** `CHARACTER` → `Character`; a known card type keeps its own spelling (`DON!!`). */
function cardType(raw: string): string {
  const known = OP_CARD_TYPES.find((t) => t.toLowerCase() === raw.trim().toLowerCase())
  if (known) return known
  return raw.trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

/** The N of a `_pN` entry, else 0. */
function sortOrder(bandaiId: string): number {
  const m = /_p(\d+)$/.exec(bandaiId)
  return m ? Number(m[1]) : 0
}

/** `SR (Alternate Art)` → `SR (Alternate Art 2)`; `SP` → `SP (2)`. */
function numbered(label: string, n: number): string {
  return label.endsWith(')') ? `${label.slice(0, -1)} ${n})` : `${label} (${n})`
}

/** A stored label without its number (`SR (Alternate Art 2)` → `SR (Alternate Art)`). */
const unnumbered = (label: string): string => label.replace(/ \d+\)$/, ')').replace(/ \(\d+\)$/, '')

/** Throws when two source strings give one id, over tonight's and the stored ones. */
function checkIds(sources: Iterable<string>, idOf: (s: string) => number): void {
  const seen = new Map<number, string>()
  for (const s of [...new Set(sources)].sort(byBandaiId)) {
    const id = idOf(s)
    const other = seen.get(id)
    if (other !== undefined) throw new Error(`One Piece id collision: ${other} and ${s} → ${id}`)
    seen.set(id, s)
  }
}

export function writeOnePiece(work: Database.Database, plan: OpPlan, o: WriteOnePieceOpts): OnePieceReport {
  const cardIdOf = o.idOf?.card ?? ((n: string) => onePieceCardId('en', n))
  const imageIdOf = o.idOf?.image ?? ((b: string) => onePieceImageId('en', b))
  const report: OnePieceReport = { series: 0, cards: 0, printings: 0, priced: 0, held: 0, images: 0, perSet: [], notes: [] }

  const seriesById = new Map(plan.series.map((s) => [s.id, s]))
  const listed = [...plan.entries].sort((a, b) => byBandaiId(a.bandaiId, b.bandaiId))
  const written: BandaiEntry[] = []
  for (const e of listed) {
    if (!plan.hashed.has(e.bandaiId)) continue
    if (!seriesById.has(e.seriesId)) {
      report.notes.push(`${e.bandaiId}: series ${e.seriesId} is not in the series list; skipped`)
      continue
    }
    written.push(e)
  }
  const listedIds = new Set(listed.map((e) => e.bandaiId))

  // One card per number: its base entry, else its lowest id (Builder's call 13).
  const cardSource = new Map<string, BandaiEntry>()
  for (const e of listed) {
    const old = cardSource.get(e.number)
    if (!old || (e.bandaiId === e.number && old.bandaiId !== old.number)) cardSource.set(e.number, e)
  }

  const storedNumbers = (work.prepare('SELECT number FROM onepiece_cards').all() as { number: string }[]).map((r) => r.number)
  const storedImages = work.prepare('SELECT image_id, bandai_id FROM onepiece_images').all() as { image_id: number; bandai_id: string }[]
  checkIds([...listed.map((e) => e.number), ...storedNumbers], cardIdOf)
  checkIds([...listed.map((e) => e.bandaiId), ...storedImages.map((r) => r.bandai_id)], imageIdOf)

  const setByCode = work.prepare(
    "SELECT set_name, tcg_date FROM sets WHERE game = 'op' AND language = 'en' AND set_code = ?"
  )
  const insertSet = work.prepare(
    "INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('op', 'en', ?, ?, ?)"
  )
  const updateSetDate = work.prepare(
    "UPDATE sets SET tcg_date = ? WHERE game = 'op' AND language = 'en' AND set_name = ?"
  )
  const cardRow = work.prepare(`SELECT name, type, "desc" FROM cards WHERE game = 'op' AND id = ?`)
  const insertCard = work.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (?, ?, ?, 'op', '', ?, ?, 'op')`
  )
  const updateCard = work.prepare(
    `UPDATE cards SET name = ?, type = ?, "desc" = ?, updated_at = ? WHERE game = 'op' AND id = ?`
  )
  const upsertDetails = work.prepare(
    `INSERT INTO onepiece_cards (card_id, number, colors, card_type, cost, power, counter, life, attribute, traits, effect, trigger, block_icon)
     VALUES (@cardId, @number, @colors, @cardType, @cost, @power, @counter, @life, @attribute, @traits, @effect, @trigger, @block)
     ON CONFLICT(card_id) DO UPDATE SET number = excluded.number, colors = excluded.colors,
       card_type = excluded.card_type, cost = excluded.cost, power = excluded.power, counter = excluded.counter,
       life = excluded.life, attribute = excluded.attribute, traits = excluded.traits, effect = excluded.effect,
       trigger = excluded.trigger, block_icon = excluded.block_icon
     WHERE onepiece_cards.number IS NOT excluded.number OR onepiece_cards.colors IS NOT excluded.colors
       OR onepiece_cards.card_type IS NOT excluded.card_type OR onepiece_cards.cost IS NOT excluded.cost
       OR onepiece_cards.power IS NOT excluded.power OR onepiece_cards.counter IS NOT excluded.counter
       OR onepiece_cards.life IS NOT excluded.life OR onepiece_cards.attribute IS NOT excluded.attribute
       OR onepiece_cards.traits IS NOT excluded.traits OR onepiece_cards.effect IS NOT excluded.effect
       OR onepiece_cards.trigger IS NOT excluded.trigger OR onepiece_cards.block_icon IS NOT excluded.block_icon`
  )
  const upsertImage = work.prepare(
    `INSERT INTO card_images (image_id, card_id, sort_order, missing_from_api, game) VALUES (?, ?, ?, 0, 'op')
     ON CONFLICT(image_id) DO UPDATE SET card_id = excluded.card_id, sort_order = excluded.sort_order, missing_from_api = 0
     WHERE card_images.game = 'op' AND (card_images.card_id IS NOT excluded.card_id
       OR card_images.sort_order IS NOT excluded.sort_order OR card_images.missing_from_api <> 0)`
  )
  const insertBandaiId = work.prepare(
    'INSERT INTO onepiece_images (image_id, bandai_id) VALUES (?, ?) ON CONFLICT(image_id) DO NOTHING'
  )
  const insertPrinting = work.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
       missing_from_api, language, tcg_product_id, variant, market_price, game)
     VALUES (?, ?, ?, ?, ?, NULL, 0, 'en', ?, NULL, ?, 'op')`
  )
  const updatePrinting = work.prepare(
    "UPDATE card_printings SET missing_from_api = ?, tcg_product_id = ?, market_price = ? WHERE game = 'op' AND id = ?"
  )
  const flagImage = work.prepare(
    "UPDATE card_images SET missing_from_api = 1 WHERE game = 'op' AND image_id = ? AND missing_from_api = 0"
  )

  let cardsChanged = false
  work.transaction(() => {
    // Sets: inserted when absent, then frozen but for tcg_date. A set is found by its code, so a
    // renamed series keeps its first name.
    const setNameOf = new Map<string, string>()
    const seriesWritten = new Set(written.map((e) => e.seriesId))
    for (const s of plan.series) {
      if (!seriesWritten.has(s.id)) continue
      const date = plan.groupOf.get(s.id)?.publishedOn?.slice(0, 10) ?? null
      const old = setByCode.get(s.setCode) as { set_name: string; tcg_date: string | null } | undefined
      if (!old) insertSet.run(s.setName, s.setCode, date)
      else if (date !== null && old.tcg_date !== date) updateSetDate.run(date, old.set_name)
      setNameOf.set(s.id, old?.set_name ?? s.setName)
      report.series++
    }

    // Cards: one per number with a written entry.
    const cardNumbers = [...new Set(written.map((e) => e.number))]
    for (const number of cardNumbers) {
      const src = cardSource.get(number)!
      const id = cardIdOf(number)
      const type = cardType(src.cardType)
      const desc = [src.effect, src.trigger].filter((x): x is string => !!x).join('\n')
      const row = cardRow.get(id) as { name: string; type: string; desc: string } | undefined
      if (!row) {
        insertCard.run(id, src.name, type, desc, o.nowIso)
        cardsChanged = true
      } else if (row.name !== src.name || row.type !== type || row.desc !== desc) {
        updateCard.run(src.name, type, desc, o.nowIso, id)
        cardsChanged = true
      }
      upsertDetails.run({
        cardId: id, number, colors: JSON.stringify(src.colors), cardType: type, cost: src.cost, power: src.power,
        counter: src.counter, life: src.life, attribute: JSON.stringify(src.attribute), traits: JSON.stringify(src.traits),
        effect: src.effect, trigger: src.trigger, block: src.block
      })
      report.cards++
    }

    // Printings, loaded once: there is no index on set_rarity_code.
    const existing = new Map<string, ExistingPrinting>()
    const taken = new Map<string, Set<string>>()
    const takenOf = (cardId: number, setCode: string): Set<string> => {
      const k = `${cardId}|${setCode}`
      let t = taken.get(k)
      if (!t) taken.set(k, (t = new Set()))
      return t
    }
    for (const p of work
      .prepare(
        `SELECT id, card_id, set_name, set_code, set_rarity, set_rarity_code, tcg_product_id, market_price, missing_from_api
         FROM card_printings WHERE game = 'op' AND contributed = 0`
      )
      .all() as ExistingPrinting[]) {
      existing.set(p.set_rarity_code, p)
      takenOf(p.card_id, p.set_code).add(p.set_rarity)
    }

    for (const e of written) {
      const cardId = cardIdOf(e.number)
      const p = existing.get(e.bandaiId)
      if (plan.frozen.has(e.bandaiId)) {
        // Changed art: nothing about the entry moves until a human clears the freeze.
        report.images++
        if (p) {
          report.printings++
          if (p.market_price !== null) report.priced++
        }
        continue
      }

      upsertImage.run(imageIdOf(e.bandaiId), cardId, sortOrder(e.bandaiId))
      insertBandaiId.run(imageIdOf(e.bandaiId), e.bandaiId)
      report.images++

      const match = plan.matches.get(e.bandaiId)
      const product = match ? match.product.productId : null
      const price = product === null ? null : (plan.prices.get(product) ?? null)
      const kind = entryKind(e, seriesById.get(e.seriesId)!)

      if (p) {
        let nextProduct = p.tcg_product_id
        let nextPrice = p.market_price
        if (product !== null && product !== p.tcg_product_id) {
          // A different product's old price says nothing about this one.
          nextProduct = product
          nextPrice = price
        } else if (product !== null && movedEnough(p.market_price, price)) {
          nextPrice = price
        }
        if (p.missing_from_api !== 0 || nextProduct !== p.tcg_product_id || nextPrice !== p.market_price) {
          updatePrinting.run(0, nextProduct, nextPrice, p.id)
        }
        if (kind === 'parallel' && match?.label && unnumbered(p.set_rarity) !== `${e.rarity} (${match.label})`) {
          report.notes.push(`${e.bandaiId}: matches ${product} (${match.label}), keeps "${p.set_rarity}"`)
        }
        report.printings++
        if (nextPrice !== null) report.priced++
        continue
      }

      let label: string
      if (kind === 'base') label = e.rarity
      else if (kind === 'sp') label = 'SP'
      else if (kind === 'tr') label = 'TR'
      else if (kind === 'reprint') label = `${e.rarity} (Reprint)`
      else if (kind === 'promo') label = e.cardSets ? `${e.rarity} (${e.cardSets})` : e.rarity
      else if (match) label = `${e.rarity} (${match.label ?? 'Parallel'})`
      else if (o.now - (plan.firstSeen.get(e.bandaiId) ?? o.now) >= HOLD_UNMATCHED_MS) label = `${e.rarity} (Parallel)`
      else {
        report.held++
        continue
      }
      const used = takenOf(cardId, e.number)
      let final = label
      for (let n = 2; used.has(final); n++) final = numbered(label, n)
      used.add(final)

      const setName = setNameOf.get(e.seriesId)!
      const id = Number(insertPrinting.run(cardId, setName, e.number, final, e.bandaiId, product, price).lastInsertRowid)
      existing.set(e.bandaiId, {
        id, card_id: cardId, set_name: setName, set_code: e.number, set_rarity: final, set_rarity_code: e.bandaiId,
        tcg_product_id: product, market_price: price, missing_from_api: 0
      })
      report.printings++
      if (price !== null) report.priced++
    }

    // Sticky: an entry Bandai no longer lists keeps its rows, flagged missing.
    for (const p of existing.values()) {
      if (listedIds.has(p.set_rarity_code) || p.missing_from_api !== 0) continue
      updatePrinting.run(1, p.tcg_product_id, p.market_price, p.id)
    }
    for (const i of storedImages) {
      if (!listedIds.has(i.bandai_id)) flagImage.run(i.image_id)
    }

    if (cardsChanged) work.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
  })()

  report.perSet = (
    work
      .prepare(
        `SELECT s.set_code AS setCode, COUNT(*) AS printings, COUNT(p.market_price) AS priced
         FROM card_printings p JOIN sets s ON s.game = 'op' AND s.language = p.language AND s.set_name = p.set_name
         WHERE p.game = 'op' GROUP BY s.set_code ORDER BY s.set_code`
      )
      .all() as { setCode: string; printings: number; priced: number }[]
  )
  return report
}
