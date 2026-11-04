import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { movedEnough } from '../../../src/main/tcgplayer/prices'
import { onePieceCardId, onePieceDonCardId, onePieceDonImageId, onePieceImageId } from '../../../src/shared/games'
import { OP_CARD_TYPES } from '../../../src/shared/games/onePiece'
import { OP_TCG_ART_RE, opTcgArtKey } from '../../../src/shared/imageSources'
import type { TcGroup } from '../pokemon/types'
import type { DonCard } from './don'
import type { OpMatch } from './match'
import type { BandaiEntry, BandaiSeries } from './types'
import { entryKind } from './versions'

/**
 * The One Piece writer: writes one region's (English, or Japanese) game = 'op' catalog rows into the job's work database
 * in one transaction, in the card model of the SCHEMA_V40 doc comment (one printing per Bandai
 * entry, Builder's call 1). Every statement names game = 'op' or an onepiece_* table. Keys never
 * move: a written set keeps its name and code, a written printing its set name, code and label.
 * Nothing is deleted (an entry Bandai stops listing is flagged missing), and rows are only written
 * when a value differs, so an unchanged night diffs to nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** A DON!! card's onepiece_cards.number and its printings' set_code: it has no number of its own. */
export const DON_NUMBER = 'DON!!'
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
  /**
   * Tonight's DON!! cards (donCards); `listed` holds every DON!! product seen, and `complete` says
   * every TCGCSV group was read, so a stored DON!! product not listed is really gone. Absent: none.
   */
  don?: { cards: DonCard[]; listed: Set<number>; complete: boolean }
  /**
   * Japanese: Bandai id to the version label its English twin (by art) has, e.g. `Manga`. A Japanese
   * parallel takes it when first written, else `Parallel`; there is no TCGplayer match to wait for.
   */
  labels?: Map<string, string>
  /**
   * Series id to its pack (or deck box) shot on Bandai's product listing (packShots). Absent (the
   * listing wasn't read tonight), or a series not in it: its set keeps the shot it has.
   */
  packShots?: Map<string, string>
}

/** A One Piece set's pack shot key: 'ob-' + the first 20 hex chars of sha1(url), as Pokémon's 'bp-'. */
export const opPackKey = (url: string): string =>
  `ob-${createHash('sha1').update(url).digest('hex').slice(0, 20)}`

export interface OnePieceReport {
  series: number
  cards: number
  printings: number
  priced: number
  /** Unmatched parallels waiting out HOLD_UNMATCHED_MS, with no printing yet. */
  held: number
  images: number
  /** DON!! cards written, and their priced printings (both within the totals above). */
  don: number
  donPriced: number
  perSet: { setCode: string; printings: number; priced: number }[]
  notes: string[]
}

export interface WriteOnePieceOpts {
  now: number
  nowIso: string
  /** Test-only: replaces onePieceCardId / onePieceImageId to force a collision. */
  idOf?: { card: (number: string) => number; image: (bandaiId: string) => number }
  /**
   * The card list's region, 'en' by default. Every read and write keeps to its language, so one
   * region's run never flags, prices or counts the other's rows.
   */
  region?: 'en' | 'ja'
}

/**
 * The `onepiece_images.bandai_id` of a region's Bandai entry: the id itself in English (as shipped),
 * `ja:<id>` in Japanese, which tells the image proxy which site the art is on.
 */
export const opArtKey = (region: string, bandaiId: string): string =>
  region === 'en' ? bandaiId : `${region}:${bandaiId}`
/** The region of a stored `bandai_id`: a two-letter prefix, else English (a bare id, or DON!!'s `tcg:`). */
const keyRegion = (key: string): string => /^([a-z]{2}):/.exec(key)?.[1] ?? 'en'

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

/** The English card a Japanese one of the same number reads as. */
interface EnglishTwin {
  name: string
  desc: string
  traits: string
  effect: string | null
  trigger: string | null
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
function checkIds(sources: Iterable<string>, idOf: (s: string) => number, extra: [string, number][] = []): void {
  const seen = new Map<number, string>()
  const pairs = [...[...new Set(sources)].sort(byBandaiId).map((s): [string, number] => [s, idOf(s)]), ...extra]
  for (const [s, id] of pairs) {
    const other = seen.get(id)
    if (other !== undefined) throw new Error(`One Piece id collision: ${other} and ${s} → ${id}`)
    seen.set(id, s)
  }
}

/** The product id of a stored DON!! printing's code or image key (`tcg:593801/Foil`, `tcg:593801`); null for a Bandai id. */
const donProduct = (code: string): number | null => {
  const m = OP_TCG_ART_RE.exec(code.split('/')[0])
  return m ? Number(m[1]) : null
}

export function writeOnePiece(work: Database.Database, plan: OpPlan, o: WriteOnePieceOpts): OnePieceReport {
  const region = o.region ?? 'en'
  const english = region === 'en'
  const cardIdOf = o.idOf?.card ?? ((n: string) => onePieceCardId(region, n))
  const imageIdOf = o.idOf?.image ?? ((b: string) => onePieceImageId(region, b))
  const artKey = (b: string): string => opArtKey(region, b)
  const seriesById = new Map(plan.series.map((s) => [s.id, s]))
  const report: OnePieceReport = {
    series: 0, cards: 0, printings: 0, priced: 0, held: 0, images: 0, don: 0, donPriced: 0, perSet: [], notes: []
  }
  // DON!! cards come from TCGplayer, which is English only.
  const don = (english ? plan.don : undefined) ?? { cards: [], listed: new Set<number>(), complete: true }
  const donCards = don.cards.filter((d) => {
    if (seriesById.has(d.seriesId)) return true
    report.notes.push(`DON!! ${d.productId}: series ${d.seriesId} is not in the series list; skipped`)
    return false
  })

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

  const storedCards = work.prepare('SELECT card_id, number FROM onepiece_cards').all() as { card_id: number; number: string }[]
  const storedNumbers = storedCards.map((r) => r.number)
  const allImages = work.prepare('SELECT image_id, bandai_id FROM onepiece_images').all() as { image_id: number; bandai_id: string }[]
  // This region's images, by the bare Bandai id (or DON!!'s `tcg:` key).
  const storedImages = allImages
    .filter((r) => keyRegion(r.bandai_id) === region)
    .map((r) => ({ image_id: r.image_id, bandai_id: english ? r.bandai_id : r.bandai_id.slice(region.length + 1) }))
  // The other region's stored ids share the id range, so tonight's ids must not land on them either.
  // (This region's DON!! cards are checked through donPids below.)
  const otherCardIds = storedCards
    .filter((r) => !(english && r.number === DON_NUMBER) && r.card_id !== cardIdOf(r.number))
    .map((r): [string, number] => [`stored card ${r.card_id} (${r.number})`, r.card_id])
  const otherImageIds = allImages
    .filter((r) => keyRegion(r.bandai_id) !== region)
    .map((r): [string, number] => [`stored image ${r.bandai_id}`, r.image_id])
  // DON!! ids come from product ids (tonight's and the stored ones), in the same id range.
  const donPids = [
    ...new Set([...donCards.map((d) => d.productId), ...storedImages.map((r) => donProduct(r.bandai_id)).filter((x): x is number => x !== null)])
  ].sort((x, y) => x - y)
  checkIds(
    [...listed.map((e) => e.number), ...storedNumbers.filter((n) => n !== DON_NUMBER)],
    cardIdOf,
    [...donPids.map((pid): [string, number] => [`DON!! ${pid}`, onePieceDonCardId('en', pid)]), ...otherCardIds]
  )
  checkIds(
    [...listed.map((e) => e.bandaiId), ...storedImages.map((r) => r.bandai_id).filter((b) => donProduct(b) === null)],
    imageIdOf,
    [...donPids.map((pid): [string, number] => [opTcgArtKey(pid), onePieceDonImageId('en', pid)]), ...otherImageIds]
  )

  const setByCode = work.prepare(
    `SELECT set_name, tcg_date, image_url FROM sets WHERE game = 'op' AND language = '${region}' AND set_code = ?`
  )
  const updateSetShot = work.prepare(
    `UPDATE sets SET image_url = ?, image_key = ? WHERE game = 'op' AND language = '${region}' AND set_name = ?`
  )
  const insertSet = work.prepare(
    `INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('op', '${region}', ?, ?, ?)`
  )
  const updateSetDate = work.prepare(
    `UPDATE sets SET tcg_date = ? WHERE game = 'op' AND language = '${region}' AND set_name = ?`
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
     VALUES (?, ?, ?, ?, ?, NULL, 0, '${region}', ?, NULL, ?, 'op')`
  )
  const updatePrinting = work.prepare(
    "UPDATE card_printings SET missing_from_api = ?, tcg_product_id = ?, market_price = ? WHERE game = 'op' AND id = ?"
  )
  const flagImage = work.prepare(
    "UPDATE card_images SET missing_from_api = 1 WHERE game = 'op' AND image_id = ? AND missing_from_api = 0"
  )
  const twinOf = work.prepare(
    `SELECT c.name, c."desc" AS "desc", oc.traits, oc.effect, oc.trigger
     FROM cards c JOIN onepiece_cards oc ON oc.card_id = c.id WHERE c.game = 'op' AND c.id = ?`
  )

  let cardsChanged = false
  work.transaction(() => {
    // Sets: inserted when absent, then frozen but for tcg_date. A set is found by its code, so a
    // renamed series keeps its first name.
    const setNameOf = new Map<string, string>()
    const seriesWritten = new Set([...written.map((e) => e.seriesId), ...donCards.map((d) => d.seriesId)])
    for (const s of plan.series) {
      if (!seriesWritten.has(s.id)) continue
      const date = plan.groupOf.get(s.id)?.publishedOn?.slice(0, 10) ?? null
      const old = setByCode.get(s.setCode) as
        { set_name: string; tcg_date: string | null; image_url: string | null } | undefined
      if (!old) insertSet.run(s.setName, s.setCode, date)
      else if (date !== null && old.tcg_date !== date) updateSetDate.run(date, old.set_name)
      const name = old?.set_name ?? s.setName
      setNameOf.set(s.id, name)
      // A booster's or deck's own product shot; the promotion and other-product pages have none.
      const shot = s.kind === 'booster' || s.kind === 'deck' ? plan.packShots?.get(s.id) : undefined
      if (shot !== undefined && shot !== (old?.image_url ?? null)) updateSetShot.run(shot, opPackKey(shot), name)
      report.series++
    }

    // Cards: one per number with a written entry.
    const cardNumbers = [...new Set(written.map((e) => e.number))]
    for (const number of cardNumbers) {
      const src = cardSource.get(number)!
      const id = cardIdOf(number)
      const type = cardType(src.cardType)
      // A Japanese card whose number English has reads as the English card: its name, text and traits.
      const twin = english ? undefined : (twinOf.get(onePieceCardId('en', number)) as EnglishTwin | undefined)
      const name = twin?.name ?? src.name
      const effect = twin ? twin.effect : src.effect
      const trigger = twin ? twin.trigger : src.trigger
      const traits = twin?.traits ?? JSON.stringify(src.traits)
      const desc = twin?.desc ?? [effect, trigger].filter((x): x is string => !!x).join('\n')
      const row = cardRow.get(id) as { name: string; type: string; desc: string } | undefined
      if (!row) {
        insertCard.run(id, name, type, desc, o.nowIso)
        cardsChanged = true
      } else if (row.name !== name || row.type !== type || row.desc !== desc) {
        updateCard.run(name, type, desc, o.nowIso, id)
        cardsChanged = true
      }
      upsertDetails.run({
        cardId: id, number, colors: JSON.stringify(src.colors), cardType: type, cost: src.cost, power: src.power,
        counter: src.counter, life: src.life, attribute: JSON.stringify(src.attribute), traits,
        effect, trigger, block: src.block
      })
      report.cards++
    }

    // DON!! cards: one per product, its picture TCGplayer's (the image key names the product).
    for (const d of donCards) {
      const id = onePieceDonCardId('en', d.productId)
      const desc = d.description ?? ''
      const row = cardRow.get(id) as { name: string; type: string; desc: string } | undefined
      if (!row) {
        insertCard.run(id, d.name, DON_NUMBER, desc, o.nowIso)
        cardsChanged = true
      } else if (row.name !== d.name || row.type !== DON_NUMBER || row.desc !== desc) {
        updateCard.run(d.name, DON_NUMBER, desc, o.nowIso, id)
        cardsChanged = true
      }
      upsertDetails.run({
        cardId: id, number: DON_NUMBER, colors: '[]', cardType: DON_NUMBER, cost: null, power: null, counter: null,
        life: null, attribute: '[]', traits: '[]', effect: d.description, trigger: null, block: null
      })
      const imageId = onePieceDonImageId('en', d.productId)
      upsertImage.run(imageId, id, 0)
      insertBandaiId.run(imageId, opTcgArtKey(d.productId))
      report.cards++
      report.images++
      report.don++
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
         FROM card_printings WHERE game = 'op' AND language = '${region}' AND contributed = 0`
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
      insertBandaiId.run(imageIdOf(e.bandaiId), artKey(e.bandaiId))
      report.images++

      const borrowed = plan.labels?.get(e.bandaiId)
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
        if (kind === 'parallel' && borrowed && unnumbered(p.set_rarity) !== `${e.rarity} (${borrowed})`) {
          report.notes.push(`${e.bandaiId}: its English twin is ${borrowed}, keeps "${p.set_rarity}"`)
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
      // Japanese has no TCGplayer match to wait for.
      else if (!english) label = `${e.rarity} (${borrowed ?? 'Parallel'})`
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

    // DON!! printings: one per finish, keyed by product and finish.
    for (const d of donCards) {
      const cardId = onePieceDonCardId('en', d.productId)
      const setName = setNameOf.get(d.seriesId)!
      for (const v of d.versions) {
        const p = existing.get(v.code)
        let price = v.price
        if (p) {
          price = movedEnough(p.market_price, v.price) ? v.price : p.market_price
          if (p.missing_from_api !== 0 || p.tcg_product_id !== d.productId || price !== p.market_price)
            updatePrinting.run(0, d.productId, price, p.id)
        } else {
          const id = Number(insertPrinting.run(cardId, setName, DON_NUMBER, v.label, v.code, d.productId, price).lastInsertRowid)
          existing.set(v.code, {
            id, card_id: cardId, set_name: setName, set_code: DON_NUMBER, set_rarity: v.label, set_rarity_code: v.code,
            tcg_product_id: d.productId, market_price: price, missing_from_api: 0
          })
        }
        report.printings++
        if (price !== null) {
          report.priced++
          report.donPriced++
        }
      }
    }

    // Sticky: an entry Bandai no longer lists keeps its rows, flagged missing. A DON!! product is
    // gone when TCGplayer stops listing it, and only a night every group was read can say so.
    const donWritten = new Set(donCards.flatMap((d) => d.versions.map((v) => v.code)))
    const gone = (key: string): boolean => {
      const pid = donProduct(key)
      if (pid === null) return !listedIds.has(key)
      return don.complete && !don.listed.has(pid) && !donWritten.has(key)
    }
    for (const p of existing.values()) {
      if (p.missing_from_api !== 0 || !gone(p.set_rarity_code)) continue
      updatePrinting.run(1, p.tcg_product_id, p.market_price, p.id)
    }
    for (const i of storedImages) {
      if (gone(i.bandai_id)) flagImage.run(i.image_id)
    }

    if (cardsChanged) work.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
  })()

  report.perSet = (
    work
      .prepare(
        `SELECT s.set_code AS setCode, COUNT(*) AS printings, COUNT(p.market_price) AS priced
         FROM card_printings p JOIN sets s ON s.game = 'op' AND s.language = p.language AND s.set_name = p.set_name
         WHERE p.game = 'op' AND p.language = '${region}' GROUP BY s.set_code ORDER BY s.set_code`
      )
      .all() as { setCode: string; printings: number; priced: number }[]
  )
  return report
}
