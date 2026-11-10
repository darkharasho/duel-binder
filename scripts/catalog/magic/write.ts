import type Database from 'better-sqlite3'
import { movedEnough } from '../../../src/main/tcgplayer/prices'
import { mtgCardId, mtgImageId } from '../../../src/shared/games/ids'
import { finishOf } from '../../../src/shared/games/magic'
import type { MagicRows } from './rows'

/**
 * The Magic writer: writes the English game = 'mtg' catalog rows into the job's work database in
 * one transaction. Every statement names game = 'mtg' or an mtg_* table. Keys never move: a written
 * set keeps its name and code, a written printing its set name, code and label. Nothing is deleted
 * (an object Scryfall stops listing is flagged missing), and rows are only written when a value
 * differs, so an unchanged night diffs to nothing.
 */

export interface MagicReport {
  updatedAt: string
  sets: number
  cards: number
  images: number
  printings: number
  priced: number
  /** Printings flagged missing tonight. */
  missing: number
  perSet: { setCode: string; printings: number; priced: number }[]
  notes: string[]
}

export interface WriteMagicOpts {
  now: number
  nowIso: string
  updatedAt: string
  /** Test-only: replaces mtgCardId / mtgImageId to force a collision. */
  idOf?: { card: (oracleId: string) => number; image: (scryfallId: string) => number }
}

interface ExistingPrinting {
  id: number
  card_id: number
  set_code: string
  set_rarity_code: string
  set_rarity: string
  market_price: number | null
  missing_from_api: number
}

const bySource = (a: string, b: string): number => a.localeCompare(b, 'en')

/** Throws when two source strings give one id. */
function checkIds(pairs: Map<string, number>): void {
  const seen = new Map<number, string>()
  for (const s of [...pairs.keys()].sort(bySource)) {
    const id = pairs.get(s)!
    const other = seen.get(id)
    if (other !== undefined) throw new Error(`Magic id collision: ${other} and ${s} → ${id}`)
    seen.set(id, s)
  }
}

export function writeMagic(
  work: Database.Database,
  allRows: MagicRows,
  o: WriteMagicOpts
): MagicReport {
  // Until the writer learns languages (next task) it stores the English rows alone.
  const rows: MagicRows = {
    ...allRows,
    cards: new Map([...allRows.cards].filter(([, c]) => c.lang === 'en')),
    images: allRows.images.filter((i) => allRows.cards.get(i.cardId)?.lang === 'en'),
    printings: allRows.printings.filter((p) => p.language === 'en'),
    sets: new Map([...allRows.sets].filter(([, s]) => s.language === 'en'))
  }
  const cardIdOf = o.idOf?.card ?? ((s: string) => mtgCardId('en', s))
  const imageIdOf = o.idOf?.image ?? mtgImageId
  const report: MagicReport = {
    updatedAt: o.updatedAt,
    sets: 0,
    cards: 0,
    images: 0,
    printings: 0,
    priced: 0,
    missing: 0,
    perSet: [],
    notes: [...rows.notes]
  }

  // A short file would flag most of the catalog missing; refuse it before anything is read or written.
  const stored = (
    work
      .prepare("SELECT COUNT(*) AS n FROM card_images WHERE game = 'mtg' AND missing_from_api = 0")
      .get() as { n: number }
  ).n
  if (stored > 0 && rows.images.length < 0.9 * stored)
    throw new Error(`Scryfall file too short: ${rows.images.length} objects, ${stored} stored`)

  const cardPairs = new Map<string, number>()
  for (const r of work.prepare('SELECT card_id, oracle_id FROM mtg_cards').all() as {
    card_id: number
    oracle_id: string
  }[])
    cardPairs.set(r.oracle_id, r.card_id)
  for (const c of rows.cards.values()) cardPairs.set(c.oracleId, cardIdOf(c.oracleId))
  checkIds(cardPairs)
  const imagePairs = new Map<string, number>()
  for (const r of work.prepare('SELECT image_id, scryfall_id FROM mtg_images').all() as {
    image_id: number
    scryfall_id: string
  }[])
    imagePairs.set(r.scryfall_id, r.image_id)
  for (const i of rows.images) imagePairs.set(i.scryfallId, imageIdOf(i.scryfallId))
  checkIds(imagePairs)

  const setByCode = work.prepare(
    "SELECT set_name, tcg_date, series FROM sets WHERE game = 'mtg' AND language = 'en' AND set_code = ?"
  )
  const nameTaken = work.prepare(
    "SELECT 1 FROM sets WHERE game = 'mtg' AND language = 'en' AND set_name = ?"
  )
  const insertSet = work.prepare(
    "INSERT INTO sets (game, language, set_name, set_code, tcg_date, series) VALUES ('mtg', 'en', ?, ?, ?, ?)"
  )
  const updateSet = work.prepare(
    "UPDATE sets SET tcg_date = ?, series = ? WHERE game = 'mtg' AND language = 'en' AND set_name = ?"
  )
  const cardRow = work.prepare(`SELECT name, type, "desc" FROM cards WHERE game = 'mtg' AND id = ?`)
  const insertCard = work.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (?, ?, ?, 'mtg', '', ?, ?, 'mtg')`
  )
  const updateCard = work.prepare(
    `UPDATE cards SET name = ?, type = ?, "desc" = ?, updated_at = ? WHERE game = 'mtg' AND id = ?`
  )
  const columns = [
    'oracle_id',
    'layout',
    'type_line',
    'types',
    'mana_cost',
    'mana_value',
    'colors',
    'color_identity',
    'oracle_text',
    'power',
    'toughness',
    'loyalty',
    'defense',
    'keywords',
    'faces'
  ]
  const upsertDetails = work.prepare(
    `INSERT INTO mtg_cards (card_id, ${columns.join(', ')})
     VALUES (@cardId, ${columns.map((c) => '@' + c).join(', ')})
     ON CONFLICT(card_id) DO UPDATE SET ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}
     WHERE ${columns.map((c) => `mtg_cards.${c} IS NOT excluded.${c}`).join(' OR ')}`
  )
  const upsertImage = work.prepare(
    `INSERT INTO card_images (image_id, card_id, sort_order, missing_from_api, game) VALUES (?, ?, ?, 0, 'mtg')
     ON CONFLICT(image_id) DO UPDATE SET card_id = excluded.card_id, sort_order = excluded.sort_order, missing_from_api = 0
     WHERE card_images.game = 'mtg' AND (card_images.card_id IS NOT excluded.card_id
       OR card_images.sort_order IS NOT excluded.sort_order OR card_images.missing_from_api <> 0)`
  )
  const imageCardOf = work.prepare(
    "SELECT card_id FROM card_images WHERE game = 'mtg' AND image_id = ?"
  )
  const oracleOf = work.prepare('SELECT oracle_id FROM mtg_cards WHERE card_id = ?')
  const imageColumns = [
    'scryfall_id',
    'illustration_id',
    'artist',
    'frame',
    'border_color',
    'full_art',
    'promo_types'
  ]
  const upsertScry = work.prepare(
    `INSERT INTO mtg_images (image_id, ${imageColumns.join(', ')})
     VALUES (@imageId, ${imageColumns.map((c) => '@' + c).join(', ')})
     ON CONFLICT(image_id) DO UPDATE SET ${imageColumns.map((c) => `${c} = excluded.${c}`).join(', ')}
     WHERE ${imageColumns.map((c) => `mtg_images.${c} IS NOT excluded.${c}`).join(' OR ')}`
  )
  const insertPrinting = work.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
       missing_from_api, language, tcg_product_id, variant, market_price, game)
     VALUES (?, ?, ?, ?, ?, NULL, 0, 'en', NULL, NULL, ?, 'mtg')`
  )
  const updatePrinting = work.prepare(
    "UPDATE card_printings SET missing_from_api = ?, market_price = ? WHERE game = 'mtg' AND id = ?"
  )
  const takeOver = work.prepare(
    "UPDATE card_printings SET set_rarity_code = ?, missing_from_api = 0, market_price = ? WHERE game = 'mtg' AND id = ?"
  )
  const flagImage = work.prepare(
    "UPDATE card_images SET missing_from_api = 1 WHERE game = 'mtg' AND image_id = ? AND missing_from_api = 0"
  )

  let cardsChanged = false
  work.transaction(() => {
    // Sets: inserted when absent, then frozen but for tcg_date and series.
    const setNameOf = new Map<string, string>()
    for (const s of [...rows.sets.values()].sort((a, b) => bySource(a.code, b.code))) {
      const old = setByCode.get(s.code) as
        { set_name: string; tcg_date: string | null; series: string | null } | undefined
      if (!old) {
        const name = nameTaken.get(s.name) ? `${s.name} (${s.code})` : s.name
        insertSet.run(name, s.code, s.releasedAt, s.series)
        setNameOf.set(s.code, name)
      } else {
        const date = s.releasedAt ?? old.tcg_date
        if (old.tcg_date !== date || old.series !== s.series)
          updateSet.run(date, s.series, old.set_name)
        setNameOf.set(s.code, old.set_name)
      }
      report.sets++
    }

    for (const c of [...rows.cards.values()].sort((a, b) => a.id - b.id)) {
      const id = cardIdOf(c.oracleId)
      const row = cardRow.get(id) as { name: string; type: string; desc: string } | undefined
      if (!row) {
        insertCard.run(id, c.name, c.type, c.desc, o.nowIso)
        cardsChanged = true
      } else if (row.name !== c.name || row.type !== c.type || row.desc !== c.desc) {
        updateCard.run(c.name, c.type, c.desc, o.nowIso, id)
        cardsChanged = true
      }
      upsertDetails.run({
        cardId: id,
        oracle_id: c.oracleId,
        layout: c.layout,
        type_line: c.typeLine,
        types: JSON.stringify(c.types),
        mana_cost: c.manaCost,
        mana_value: c.manaValue,
        colors: JSON.stringify(c.colors),
        color_identity: JSON.stringify(c.colorIdentity),
        oracle_text: c.oracleText,
        power: c.power,
        toughness: c.toughness,
        loyalty: c.loyalty,
        defense: c.defense,
        keywords: JSON.stringify(c.keywords),
        faces: c.faces
      })
      report.cards++
    }

    // Art order: a card's oldest printing (set release date, then collector number) is sort_order 0,
    // so the tile and the default image show it. The order depends only on the printings.
    const sortOf = new Map<string, number>()
    const codeOf = new Map<string, string>()
    for (const p of rows.printings) if (!codeOf.has(p.scryfallId)) codeOf.set(p.scryfallId, p.code)
    const byCard = new Map<number, typeof rows.images>()
    for (const i of rows.images) {
      const list = byCard.get(i.cardId) ?? []
      list.push(i)
      byCard.set(i.cardId, list)
    }
    const age = (scryfallId: string): [string, string] => {
      const code = codeOf.get(scryfallId) ?? ''
      const [setCode = '', ...num] = code.split(' ')
      return [rows.sets.get(`en|${setCode}`)?.releasedAt ?? '9999-99-99', num.join(' ')]
    }
    for (const list of byCard.values()) {
      list
        .map((i) => ({ id: i.scryfallId, a: age(i.scryfallId) }))
        .sort(
          (x, y) =>
            x.a[0].localeCompare(y.a[0], 'en') ||
            x.a[1].localeCompare(y.a[1], 'en', { numeric: true }) ||
            bySource(x.id, y.id)
        )
        .forEach((x, n) => sortOf.set(x.id, n))
    }

    const seenImages = new Set<string>()
    for (const i of rows.images) {
      const imageId = imageIdOf(i.scryfallId)
      const toCard = cardIdOf(rows.cards.get(i.cardId)!.oracleId)
      const was = imageCardOf.get(imageId) as { card_id: number } | undefined
      if (was && was.card_id !== toCard) {
        const from = (oracleOf.get(was.card_id) as { oracle_id: string } | undefined)?.oracle_id
        report.notes.push(
          `Magic image moved card: ${i.scryfallId} ${from ?? was.card_id} -> ${rows.cards.get(i.cardId)!.oracleId}`
        )
      }
      upsertImage.run(imageId, toCard, sortOf.get(i.scryfallId) ?? 0)
      upsertScry.run({
        imageId,
        scryfall_id: i.scryfallId,
        illustration_id: i.illustrationId,
        artist: i.artist,
        frame: i.frame,
        border_color: i.borderColor,
        full_art: i.fullArt ? 1 : 0,
        promo_types: JSON.stringify(i.promoTypes)
      })
      seenImages.add(i.scryfallId)
      report.images++
    }

    // Printings, loaded once: there is no index on set_rarity_code.
    const existing = new Map<string, ExistingPrinting>()
    const taken = new Map<string, ExistingPrinting>()
    for (const p of work
      .prepare(
        `SELECT id, card_id, set_code, set_rarity_code, set_rarity, market_price, missing_from_api FROM card_printings
         WHERE game = 'mtg' AND language = 'en' AND contributed = 0`
      )
      .all() as ExistingPrinting[]) {
      existing.set(`${p.set_rarity_code}|${finishOf(p.set_rarity)}`, p)
      taken.set(`${p.card_id}|${p.set_code}|${p.set_rarity}`, p)
    }
    const seen = new Set<string>()
    for (const p of rows.printings) {
      const key = `${p.scryfallId}|${p.finish}`
      const old = existing.get(key)
      if (old) {
        seen.add(key)
        // A missing price leaves the stored one; a present one moves it only when it moved enough.
        const price =
          p.price !== null && movedEnough(old.market_price, p.price) ? p.price : old.market_price
        if (old.missing_from_api !== 0 || price !== old.market_price)
          updatePrinting.run(0, price, old.id)
        report.printings++
        if (price !== null) report.priced++
        continue
      }
      const cardId = cardIdOf(rows.cards.get(p.cardId)!.oracleId)
      const pkey = `${cardId}|${p.code}|${p.rarity}`
      const holder = taken.get(pkey)
      if (holder) {
        // Scryfall replaced the object's id: the row it left behind (flagged missing, or no longer
        // listed tonight) passes to the new id, keeping its printing id and any collection entries.
        const gone =
          holder.missing_from_api !== 0 ||
          !rows.printings.some(
            (q) =>
              q.scryfallId === holder.set_rarity_code && finishOf(holder.set_rarity) === q.finish
          )
        if (!gone) {
          report.notes.push(`Magic printing key taken: ${p.code} ${p.rarity}`)
          continue
        }
        const price = p.price ?? holder.market_price
        takeOver.run(p.scryfallId, price, holder.id)
        existing.delete(`${holder.set_rarity_code}|${finishOf(holder.set_rarity)}`)
        holder.set_rarity_code = p.scryfallId
        holder.market_price = price
        holder.missing_from_api = 0
        existing.set(key, holder)
        seen.add(key)
        report.printings++
        if (price !== null) report.priced++
        continue
      }
      const id = Number(
        insertPrinting.run(
          cardId,
          setNameOf.get(p.setCode)!,
          p.code,
          p.rarity,
          p.scryfallId,
          p.price
        ).lastInsertRowid
      )
      const row: ExistingPrinting = {
        id,
        card_id: cardId,
        set_code: p.code,
        set_rarity_code: p.scryfallId,
        set_rarity: p.rarity,
        market_price: p.price,
        missing_from_api: 0
      }
      existing.set(key, row)
      taken.set(pkey, row)
      seen.add(key)
      report.printings++
      if (p.price !== null) report.priced++
    }

    // Sticky: an object Scryfall no longer lists keeps its rows, flagged missing.
    for (const [key, p] of existing) {
      if (seen.has(key) || p.missing_from_api !== 0) continue
      updatePrinting.run(1, p.market_price, p.id)
      report.missing++
    }
    for (const r of work.prepare('SELECT image_id, scryfall_id FROM mtg_images').all() as {
      image_id: number
      scryfall_id: string
    }[]) {
      if (!seenImages.has(r.scryfall_id)) flagImage.run(r.image_id)
    }

    if (cardsChanged) work.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
  })()

  report.perSet = work
    .prepare(
      `SELECT s.set_code AS setCode, COUNT(*) AS printings, COUNT(p.market_price) AS priced
       FROM card_printings p JOIN sets s ON s.game = 'mtg' AND s.language = p.language AND s.set_name = p.set_name
       WHERE p.game = 'mtg' AND p.language = 'en' GROUP BY s.set_code ORDER BY s.set_code`
    )
    .all() as { setCode: string; printings: number; priced: number }[]
  return report
}
