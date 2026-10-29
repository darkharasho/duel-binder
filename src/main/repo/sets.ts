import type { SqlDb } from '../db/sql'
import { RARITY_LABEL } from '../db/schema'
import { pickDefaultCode, setNumber, setPrefix } from '../../shared/sets'
import type { ChecklistCard, ChecklistRarity, SetChecklist, SetSummary } from '../../shared/types'
import type { Language } from '../../shared/languages'
import { setImageKey } from '../../shared/setImages'
import { addEntry, CollectionError } from './collection'
import { LOCAL, type Scope } from './scope'
import { EN_TWIN_PRICE } from './enTwin'

interface SummaryDbRow {
  language: Language
  set_name: string
  s_code: string | null
  min_code: string
  tcg_date: string | null
  image_url: string | null
  image_key: string | null
  pack_key: string | null
  logo_key: string | null
  list_rows: number | null
  unmatched_rows: number | null
  total_cards: number
  owned_cards: number
  total_rarities: number
  owned_rarities: number
}

// One row per distinct (language, set_name); callers limit it to the scope's game with `p.game = <game>`.
// A (card, rarity) pair is keyed as "<card_id>|<rarity>"; card_id is an integer, so the first "|"
// always ends it. Pack art and logos are Yu-Gi-Oh only, keyed by set name alone.
// Ownership is an uncorrelated IN list (built once, then a keyed lookup per printing). A LEFT JOIN
// to the owned printings made SQLite scan them for every printing (~1 s on a full catalog).
const summary = (scope: Scope): string => {
  const owned = `p.id IN (SELECT printing_id FROM collection_entries e WHERE ${scope.where('e')})`
  return `
  SELECT p.language, p.set_name, s.set_code AS s_code, MIN(p.set_code) AS min_code, s.tcg_date, s.image_url,
         s.image_key, pa.image_key AS pack_key, COALESCE(sl.image_key, kl.image_key) AS logo_key, s.list_rows, s.unmatched_rows,
         COUNT(DISTINCT p.card_id) AS total_cards,
         COUNT(DISTINCT CASE WHEN ${owned} THEN p.card_id END) AS owned_cards,
         COUNT(DISTINCT p.card_id || '|' || p.set_rarity) AS total_rarities,
         COUNT(DISTINCT CASE WHEN ${owned} THEN p.card_id || '|' || p.set_rarity END)
           AS owned_rarities
  FROM card_printings p
  LEFT JOIN sets s ON s.game = p.game AND s.language = p.language AND s.set_name = p.set_name
  LEFT JOIN pack_art pa ON p.game = 'ygo' AND p.language = 'en' AND pa.set_name = p.set_name
  LEFT JOIN set_logos sl ON p.game = 'ygo' AND p.language = 'en' AND sl.set_name = p.set_name
  LEFT JOIN konami_logos kl ON p.game = 'ygo' AND p.language = 'en' AND kl.set_name = p.set_name`
}

/**
 * Each set's headline card: its rarest printing (lowest code, skipping 000 bonus cards). Its
 * artwork identifies the set better than a pack photo.
 */
const coversSql = (scope: Scope): string => `
  WITH per_card AS (
    SELECT p.language, p.set_name, p.card_id, MIN(p.set_code) AS code,
      MIN(CASE
        WHEN p.set_rarity LIKE '%Starlight%' THEN 1
        WHEN p.set_rarity LIKE '%Quarter Century%' THEN 2
        WHEN p.set_rarity LIKE '%Ghost%' THEN 3
        WHEN p.set_rarity LIKE '%Ultimate%' THEN 4
        WHEN p.set_rarity LIKE '%Collector%' THEN 5
        WHEN p.set_rarity LIKE '%Secret%' THEN 6
        WHEN p.set_rarity LIKE '%Ultra%' THEN 7
        WHEN p.set_rarity LIKE '%Super%' THEN 8
        WHEN p.set_rarity LIKE '%Rare%' THEN 9
        ELSE 10 END) AS rank
    FROM card_printings p WHERE p.game = ${scope.game} AND p.missing_from_api = 0 AND p.contributed = 0 %WHERE%
    GROUP BY p.language, p.set_name, p.card_id),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY language, set_name
      ORDER BY rank, code LIKE '%000', code, card_id) AS rn
    FROM per_card)
  SELECT r.language, r.set_name,
    (SELECT ci.image_id FROM card_images ci WHERE ci.card_id = r.card_id AND ci.game = ${scope.game}
     ORDER BY ci.sort_order, ci.image_id LIMIT 1) AS image_id
  FROM ranked r WHERE r.rn = 1`

function coverImages(
  db: SqlDb,
  scope: Scope,
  only?: { language: Language; setName: string }
): Map<string, number> {
  const sql = coversSql(scope).replace('%WHERE%', only ? 'AND p.language = ? AND p.set_name = ?' : '')
  const rows = (only
    ? db.prepare(sql).all(only.language, only.setName)
    : db.prepare(sql).all()) as { language: string; set_name: string; image_id: number | null }[]
  const out = new Map<string, number>()
  for (const r of rows) if (r.image_id !== null) out.set(`${r.language}|${r.set_name}`, r.image_id)
  return out
}

function toSummary(r: SummaryDbRow, covers: Map<string, number>): SetSummary {
  return {
    language: r.language,
    setName: r.set_name,
    setCode: r.s_code ? r.s_code : setPrefix(r.min_code),
    tcgDate: r.tcg_date,
    imageKey: r.image_key ?? setImageKey(r.image_url),
    packImageKey: r.pack_key,
    logoImageKey: r.logo_key,
    coverImageId: covers.get(`${r.language}|${r.set_name}`) ?? null,
    totalCards: r.total_cards,
    ownedCards: r.owned_cards,
    totalRarities: r.total_rarities,
    ownedRarities: r.owned_rarities,
    listRows: r.list_rows,
    unmatchedRows: r.unmatched_rows
  }
}

/** Completion summary of every (language, set); English first within a name. */
/** Source URL of a stored set image key: a Yugipedia set image or logo, an official pack render, or a Konami logo. */
export function findSetImageUrl(db: SqlDb, key: string): string | null {
  const row = db
    .prepare(
      `SELECT image_url FROM sets WHERE image_key = ?
       UNION ALL SELECT image_url FROM pack_art WHERE image_key = ?
       UNION ALL SELECT image_url FROM set_logos WHERE image_key = ?
       UNION ALL SELECT image_url FROM konami_logos WHERE image_key = ? LIMIT 1`
    )
    .get(key, key, key, key) as { image_url: string | null } | undefined
  return row?.image_url ?? null
}

export function listSets(db: SqlDb, scope: Scope = LOCAL): SetSummary[] {
  const covers = coverImages(db, scope)
  return (db.prepare(`${summary(scope)} WHERE p.game = ${scope.game} AND p.contributed = 0 GROUP BY p.language, p.set_name ORDER BY p.set_name, p.language <> 'en', p.language`).all() as SummaryDbRow[]).map((r) => toSummary(r, covers))
}

interface PrintingDbRow {
  id: number
  card_id: number
  set_code: string
  set_rarity: string
  name: string
  type: string
  image_id: number | null
  set_price: number | null
  card_price: number | null
  atk: number | null
  def: number | null
  level: number | null
}

interface EntryDbRow {
  id: number
  printing_id: number
  quantity: number
  updated_at: string
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Most recently updated entry (ties: highest id). */
function latest(entries: EntryDbRow[]): number | null {
  let best: EntryDbRow | null = null
  for (const e of entries) {
    if (
      !best ||
      e.updated_at > best.updated_at ||
      (e.updated_at === best.updated_at && e.id > best.id)
    )
      best = e
  }
  return best?.id ?? null
}

/**
 * A checklist printing's own price. English: TCGplayer market, then YGOPRODeck's set price. Other
 * European languages: their eBay price (intl_prices), else the English twin's market price as an estimate.
 * Asian languages: only their eBay price, never the English card's TCGplayer price, which is a different
 * product (an OCG Prismatic Secret is not a $0.16 TCG common); unpriced stays null.
 */
const PRINTING_PRICE = `CASE WHEN p.language = 'en' THEN COALESCE(p.market_price, p.set_price) ELSE COALESCE(ip.price, ${EN_TWIN_PRICE}) END`

/** The dearest printing price among the rows; null when none has one. */
function maxPrice(rows: PrintingDbRow[]): number | null {
  const prices = rows.map((r) => r.set_price).filter((v): v is number => v !== null && v > 0)
  return prices.length > 0 ? Math.max(...prices) : null
}

const sum = (entries: EntryDbRow[]): number => entries.reduce((n, e) => n + e.quantity, 0)

/** Checklist cards of a set, optionally limited to one card, sorted by number (nulls last) then name. */
function checklistCards(
  db: SqlDb,
  setName: string,
  language: Language,
  cardId: number | undefined,
  scope: Scope
): ChecklistCard[] {
  const cardFilter = cardId === undefined ? '' : ' AND p.card_id = ?'
  const params = cardId === undefined ? [language, setName] : [language, setName, cardId]
  const printings = db
    .prepare(
      `SELECT p.id, p.card_id, p.set_code, ${RARITY_LABEL} AS set_rarity, c.name, c.type,
              ${PRINTING_PRICE} AS set_price,
              CASE WHEN p.language = 'en' THEN c.tcgplayer_price END AS card_price,
              c.atk, c.def, COALESCE(c.level, c.linkval) AS level,
              (SELECT i.image_id FROM card_images i WHERE i.card_id = c.id AND i.game = ${scope.game}
               ORDER BY i.sort_order, i.image_id LIMIT 1) AS image_id
       FROM card_printings p JOIN cards c ON c.id = p.card_id AND c.game = ${scope.game}
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id
       WHERE p.game = ${scope.game} AND p.contributed = 0 AND p.language = ? AND p.set_name = ?${cardFilter}`
    )
    .all(...params) as PrintingDbRow[]
  const entries = db
    .prepare(
      `SELECT e.id, e.printing_id, e.quantity, e.updated_at
       FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id AND p.game = ${scope.game}
       WHERE ${scope.where('e')} AND p.language = ? AND p.set_name = ?${cardFilter}`
    )
    .all(...params) as EntryDbRow[]

  const entriesByPrinting = new Map<number, EntryDbRow[]>()
  for (const e of entries) {
    const list = entriesByPrinting.get(e.printing_id) ?? []
    list.push(e)
    entriesByPrinting.set(e.printing_id, list)
  }
  const byCard = new Map<number, PrintingDbRow[]>()
  for (const p of printings) {
    const list = byCard.get(p.card_id) ?? []
    list.push(p)
    byCard.set(p.card_id, list)
  }

  const cards: ChecklistCard[] = []
  for (const [id, rows] of byCard) {
    const byRarity = new Map<string, PrintingDbRow[]>()
    for (const p of rows) {
      const list = byRarity.get(p.set_rarity) ?? []
      list.push(p)
      byRarity.set(p.set_rarity, list)
    }
    const rarities: ChecklistRarity[] = [...byRarity]
      .sort(([a], [b]) => cmp(a, b))
      .map(([rarity, ps]) => {
        const codes = ps
          .map((p) => ({
            printingId: p.id,
            setCode: p.set_code,
            owned: sum(entriesByPrinting.get(p.id) ?? [])
          }))
          .sort((a, b) => cmp(a.setCode, b.setCode))
        const rarityEntries = ps.flatMap((p) => entriesByPrinting.get(p.id) ?? [])
        return {
          rarity,
          owned: sum(rarityEntries),
          price: maxPrice(ps),
          codes,
          defaultPrintingId: codes[pickDefaultCode(codes)].printingId,
          entryId: latest(rarityEntries)
        }
      })

    let lowest: { number: number | null; label: string } = { number: null, label: '' }
    for (const p of rows) {
      const n = setNumber(p.set_code)
      if (n.number !== null && (lowest.number === null || n.number < lowest.number)) lowest = n
    }
    const cardEntries = rows.flatMap((p) => entriesByPrinting.get(p.id) ?? [])
    cards.push({
      cardId: id,
      name: rows[0].name,
      type: rows[0].type,
      number: lowest.number,
      numberLabel: lowest.label,
      imageId: rows[0].image_id ?? 0,
      owned: sum(cardEntries),
      entryId: latest(cardEntries),
      rarities,
      price: maxPrice(rows) ?? rows[0].card_price,
      atk: rows[0].atk,
      def: rows[0].def,
      level: rows[0].level
    })
  }
  return cards.sort((a, b) => {
    if (a.number !== b.number) {
      if (a.number === null) return 1
      if (b.number === null) return -1
      return a.number - b.number
    }
    return a.name.localeCompare(b.name)
  })
}

/** The set's summary and checklist; null when no printing has that set_name in that language. */
export function getChecklist(
  db: SqlDb,
  setName: string,
  language: Language,
  scope: Scope = LOCAL
): SetChecklist | null {
  const row = db
    .prepare(`${summary(scope)} WHERE p.game = ${scope.game} AND p.contributed = 0 AND p.language = ? AND p.set_name = ? GROUP BY p.language, p.set_name`)
    .get(language, setName) as SummaryDbRow | undefined
  if (!row) return null
  return { set: toSummary(row, coverImages(db, scope, { language, setName })), cards: checklistCards(db, setName, language, undefined, scope) }
}

/**
 * Adds one copy of a printing (original art) or removes one (original-art entry first,
 * else the most recently updated). Removing with no entry is a no-op.
 * Returns the printing's card as it now appears in the set's checklist.
 */
export function adjustPrinting(
  db: SqlDb,
  setName: string,
  language: Language,
  printingId: number,
  delta: 1 | -1,
  now = new Date(),
  scope: Scope = LOCAL
): ChecklistCard {
  if (delta !== 1 && delta !== -1) throw new CollectionError('Adjustment must be +1 or -1')
  return db.transaction(() => {
    const p = db
      .prepare(`SELECT card_id, set_name, language FROM card_printings WHERE id = ? AND game = ${scope.game}`)
      .get(printingId) as { card_id: number; set_name: string; language: Language } | undefined
    if (!p || p.set_name !== setName || p.language !== language)
      throw new CollectionError(`Printing ${printingId} is not in ${setName} (${language})`)
    const original = db
      .prepare(
        `SELECT image_id FROM card_images WHERE card_id = ? AND game = ${scope.game}
         ORDER BY sort_order, image_id LIMIT 1`
      )
      .get(p.card_id) as { image_id: number } | undefined

    if (delta === 1) {
      if (!original) throw new CollectionError('The card has no image')
      addEntry(db, { printingId, imageId: original.image_id, quantity: 1 }, now, scope)
    } else {
      const entry = db
        .prepare(
          `SELECT id, quantity FROM collection_entries WHERE printing_id = ? AND ${scope.where('collection_entries')}
           ORDER BY image_id = ? DESC, updated_at DESC, id DESC LIMIT 1`
        )
        .get(printingId, original?.image_id ?? null) as { id: number; quantity: number } | undefined
      if (entry && entry.quantity > 1) {
        db.prepare(
          `UPDATE collection_entries SET quantity = quantity - 1, updated_at = ?, ${scope.touch} WHERE id = ?`
        ).run(now.toISOString(), entry.id)
      } else if (entry) {
        scope.deleteEntry(db, entry.id, now.toISOString())
      }
    }
    return checklistCards(db, setName, language, p.card_id, scope)[0]
  })()
}
