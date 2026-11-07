import type { SqlDb } from '../db/sql'
import type { Language } from '../../shared/languages'
import type { PokedexCard, PokedexSpecies, PokedexSummary } from '../../shared/types'
import { LOCAL, type Scope } from './scope'

const SET_DATE = 'COALESCE(s.tcg_date, es.tcg_date)'
const SET_JOINS = `LEFT JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
  LEFT JOIN sets es ON es.game = p.game AND es.language = 'en' AND es.set_name = p.set_name`

/** Parses `pokemon_cards.dex_extra` ('644' or '25,26'), the species after the first. */
const parseExtra = (extra: string | null): number[] =>
  (extra ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)

/** Copies owned per Pokédex number. Empty unless the scope shows Pokémon (the joins find nothing else). */
export function pokedexSummary(db: SqlDb, scope: Scope = LOCAL): PokedexSummary {
  const rows = db
    .prepare(
      `SELECT pc.dex_no, pc.dex_extra, SUM(e.quantity) AS copies FROM collection_entries e
       JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
       JOIN pokemon_cards pc ON pc.card_id = p.card_id
       WHERE ${scope.where('e')} AND e.quantity > 0 AND pc.dex_no IS NOT NULL
       GROUP BY pc.dex_no, pc.dex_extra`
    )
    .all() as { dex_no: number; dex_extra: string | null; copies: number }[]
  const byDex = new Map<number, number>()
  for (const r of rows)
    for (const n of [r.dex_no, ...parseExtra(r.dex_extra)])
      byDex.set(n, (byDex.get(n) ?? 0) + r.copies)
  return {
    caught: [...byDex].sort((a, b) => a[0] - b[0]).map(([dexNo, copies]) => ({ dexNo, copies }))
  }
}

/** Cards of the species: the first-species lookup, then the rows whose extra list holds it. */
function speciesCardIds(db: SqlDb, dexNo: number, scope: Scope): number[] {
  const ids = new Set<number>()
  const first = db
    .prepare(
      `SELECT pc.card_id FROM pokemon_cards pc JOIN cards c ON c.id = pc.card_id AND +c.game = ${scope.game}
       WHERE pc.dex_no = ?`
    )
    .all(dexNo) as { card_id: number }[]
  for (const r of first) ids.add(r.card_id)
  const extra = db
    .prepare(
      `SELECT pc.card_id FROM pokemon_cards pc JOIN cards c ON c.id = pc.card_id AND +c.game = ${scope.game}
       WHERE pc.dex_extra IS NOT NULL AND ',' || pc.dex_extra || ',' LIKE ?`
    )
    .all(`%,${dexNo},%`) as { card_id: number }[]
  for (const r of extra) ids.add(r.card_id)
  return [...ids]
}

interface Pick {
  cardId: number
  imageId: number
  name: string
  setName: string
  language: string
  date: string
  copies: number
}

/** Newest set first; the card id breaks ties so the order is stable. */
const newestFirst = (a: Pick, b: Pick): number =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.cardId - b.cardId

const toCard = (p: Pick): PokedexCard => ({
  cardId: p.cardId,
  imageId: p.imageId,
  name: p.name,
  setName: p.setName,
  language: p.language as Language,
  copies: p.copies
})

export function pokedexSpecies(db: SqlDb, dexNo: number, scope: Scope = LOCAL): PokedexSpecies {
  const cardIds = speciesCardIds(db, dexNo, scope)
  if (cardIds.length === 0) return { dexNo, owned: [], missing: [] }
  const json = JSON.stringify(cardIds)

  // Owned: one row per live entry, folded to one pick per card (copies summed, newest set shown).
  const entries = db
    .prepare(
      `SELECT c.id AS card_id, c.name, e.image_id, e.quantity, p.set_name, p.language,
              COALESCE(${SET_DATE}, '') AS date
       FROM collection_entries e
       JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
       JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
       ${SET_JOINS}
       WHERE ${scope.where('e')} AND e.quantity > 0 AND p.card_id IN (SELECT value FROM json_each(?))`
    )
    .all(json) as {
    card_id: number
    name: string
    image_id: number
    quantity: number
    set_name: string
    language: string
    date: string
  }[]
  const owned = new Map<number, Pick>()
  for (const r of entries) {
    const pick: Pick = {
      cardId: r.card_id,
      imageId: r.image_id,
      name: r.name,
      setName: r.set_name,
      language: r.language,
      date: r.date,
      copies: r.quantity
    }
    const had = owned.get(r.card_id)
    if (!had) owned.set(r.card_id, pick)
    else {
      const copies = had.copies + r.quantity
      owned.set(r.card_id, { ...(newestFirst(pick, had) < 0 ? pick : had), copies })
    }
  }

  // Missing: the species' other cards, shown by their newest English printing (any language if none is English).
  const rest = cardIds.filter((id) => !owned.has(id))
  const printings =
    rest.length === 0
      ? []
      : (db
          .prepare(
            `SELECT c.id AS card_id, c.name, p.set_name, p.language, COALESCE(${SET_DATE}, '') AS date
             FROM card_printings p
             JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
             ${SET_JOINS}
             WHERE +p.game = ${scope.game} AND p.card_id IN (SELECT value FROM json_each(?))`
          )
          .all(JSON.stringify(rest)) as {
          card_id: number
          name: string
          set_name: string
          language: string
          date: string
        }[])
  const images = new Map<number, number>()
  if (printings.length > 0) {
    const imgs = db
      .prepare(
        `SELECT i.card_id, i.image_id FROM card_images i
         WHERE +i.game = ${scope.game} AND i.card_id IN (SELECT value FROM json_each(?))
         ORDER BY i.sort_order, i.image_id`
      )
      .all(JSON.stringify(rest)) as { card_id: number; image_id: number }[]
    for (const i of imgs) if (!images.has(i.card_id)) images.set(i.card_id, i.image_id)
  }
  const toPick = (r: (typeof printings)[number]): Pick => ({
    cardId: r.card_id,
    imageId: images.get(r.card_id) ?? 0,
    name: r.name,
    setName: r.set_name,
    language: r.language,
    date: r.date,
    copies: 0
  })
  const english = printings.filter((r) => r.language === 'en')
  const pool = english.length > 0 ? english : printings
  const best = new Map<number, Pick>()
  for (const r of pool) {
    const pick = toPick(r)
    const had = best.get(r.card_id)
    if (!had || newestFirst(pick, had) < 0) best.set(r.card_id, pick)
  }

  return {
    dexNo,
    owned: [...owned.values()].sort(newestFirst).map(toCard),
    missing: [...best.values()].sort(newestFirst).map(toCard)
  }
}
