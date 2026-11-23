import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games'
import { MAX_MARK_PROBLEMS, MAX_PROBLEM_KEY } from '../../shared/decks/check'
import { DeckFieldError, MAX_DECKS_PER_GAME, checkDeckFields } from '../../shared/decks/fields'
import type {
  DeckCard,
  DeckDetail,
  DeckEntry,
  DeckList,
  DeckSummary,
  DeckVerdictMark,
  VerdictStatus
} from '../../shared/decks/types'
import type { DeckLineRef } from '../../shared/decks/lists'
import { normalCardName as normalName } from '../../shared/decks/names'
import { checkObject } from './args'
import { printingArtImageId, type PrintingDbRow } from './cards'
import { CollectionError } from './collection'
import { LOCAL, scopeGame, type Scope } from './scope'
import { printingPrice } from './sets'

const MAX_UID = 64
const MAX_PACK_VERSION = 32
const MAX_REFS = 300
const MAX_REF_TEXT = 200
/** Name matches read per import line: a whole-name match is among the shortest names hit. */
const NAME_HITS = 200
const VERDICT_STATUSES: readonly VerdictStatus[] = [
  'legal',
  'warnings',
  'illegal',
  'unknown',
  'update'
]
/** The languages whose printings price a deck built for the Asian (OCG) region. */
const REGION_LANGUAGES = "('ja', 'ko', 'zh-hans', 'zh-hant', 'ae', 'ja-asia')"
/** An id or pkey list bound as one JSON array, never one parameter per item (the DO caps them). */
/** A basic Energy's whole name, normalised. */
const BASIC_ENERGY = /^(?:grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/
const IN_LIST = '(SELECT value FROM json_each(?))'

/** frameType lets the importer place a card (an Extra Deck monster in Extra) when the list didn't. */
export type DeckResolution =
  | { status: 'matched'; card: number; name: string; frameType: string }
  | {
      status: 'ambiguous'
      options: { card: number; name: string; frameType: string; imageId: number | null }[]
    }
  | { status: 'unmatched' }

interface DeckDbRow {
  uid: string
  game: string
  format: string
  name: string
  notes: string
  cover: number | null
  private: number
  cards: string
  last_verdict: string | null
  created_at: string
  updated_at: string
}

function checkUid(uid: unknown): string {
  if (typeof uid !== 'string' || !uid || uid.length > MAX_UID)
    throw new CollectionError('uid must be text')
  return uid
}

function parseCards(json: string): DeckEntry[] {
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? (v as DeckEntry[]) : []
  } catch {
    return []
  }
}

/** A stored verdict mark, or null when there is none or it doesn't read as one. */
function parseMark(json: string | null): DeckVerdictMark | null {
  if (json === null) return null
  try {
    return checkMark(JSON.parse(json))
  } catch {
    return null
  }
}

function checkMark(v: unknown): DeckVerdictMark {
  const o = checkObject(v, 'Deck verdict')
  if (typeof o.status !== 'string' || !VERDICT_STATUSES.includes(o.status as VerdictStatus))
    throw new CollectionError('Unknown verdict status')
  if (
    !Array.isArray(o.problems) ||
    o.problems.length > MAX_MARK_PROBLEMS ||
    !o.problems.every((p) => typeof p === 'string' && p.length <= MAX_PROBLEM_KEY)
  )
    throw new CollectionError(
      `Problems must be a list of at most ${MAX_MARK_PROBLEMS} texts of at most ${MAX_PROBLEM_KEY} characters`
    )
  if (typeof o.packVersion !== 'string' || o.packVersion.length > MAX_PACK_VERSION)
    throw new CollectionError(`Pack version must be text of at most ${MAX_PACK_VERSION} characters`)
  return {
    status: o.status as VerdictStatus,
    problems: o.problems as string[],
    packVersion: o.packVersion
  }
}

/** Each card's first image, for the card ids given. */
function firstImages(db: SqlDb, ids: number[], scope: Scope): Map<number, number> {
  const out = new Map<number, number>()
  if (ids.length === 0) return out
  const rows = db
    .prepare(
      `SELECT i.card_id, i.image_id FROM card_images i
       WHERE i.card_id IN ${IN_LIST} AND +i.game = ${scope.game}
       ORDER BY i.card_id, i.sort_order, i.image_id`
    )
    .all(JSON.stringify(ids)) as { card_id: number; image_id: number }[]
  for (const r of rows) if (!out.has(r.card_id)) out.set(r.card_id, r.image_id)
  return out
}

/**
 * The DeckCard of every card id this catalog has (absent ids are left out), with one query per
 * table: the DO rejects big compound queries.
 */
function deckCards(
  db: SqlDb,
  ids: number[],
  images: Map<number, number>,
  scope: Scope
): Record<number, DeckCard> {
  const facts: Record<number, DeckCard> = {}
  if (ids.length === 0) return facts
  const list = JSON.stringify(ids)
  const cards = db
    .prepare(
      `SELECT c.id, c.name, c.type, c.frame_type FROM cards c
       WHERE c.id IN ${IN_LIST} AND +c.game = ${scope.game}`
    )
    .all(list) as { id: number; name: string; type: string; frame_type: string }[]
  if (cards.length === 0) return facts
  const owned = new Map<number, number>()
  const addOwned = (rows: { card_id: number; n: number }[]): void => {
    for (const r of rows) owned.set(r.card_id, (owned.get(r.card_id) ?? 0) + r.n)
  }
  addOwned(
    db
      .prepare(
        `SELECT p.card_id, SUM(e.quantity) AS n FROM collection_entries e
         JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
         WHERE ${scope.where('e')} AND p.card_id IN ${IN_LIST}
         GROUP BY p.card_id`
      )
      .all(list) as { card_id: number; n: number }[]
  )
  addOwned(
    db
      .prepare(
        `SELECT p.card_id, COUNT(*) AS n FROM graded_copies g
         JOIN card_printings p ON p.pkey = g.pkey AND +p.game = ${scope.game}
         WHERE ${scope.where('g')} AND p.card_id IN ${IN_LIST}
         GROUP BY p.card_id`
      )
      .all(list) as { card_id: number; n: number }[]
  )
  const prices = new Map(
    (
      db
        .prepare(
          `SELECT card_id, MIN(CASE WHEN language = 'en' THEN price END) AS en, MIN(price) AS anyp,
                  MIN(CASE WHEN language IN ${REGION_LANGUAGES} THEN price END) AS region
           FROM (SELECT p.card_id, p.language, ${printingPrice(scope)} AS price
                 FROM card_printings p
                 JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
                 LEFT JOIN pokemon_cards pc ON pc.card_id = c.id AND ${scope.game} = 'pkm'
                 LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}
                 WHERE +p.game = ${scope.game} AND p.card_id IN ${IN_LIST})
           WHERE price > 0
           GROUP BY card_id`
        )
        .all(list) as {
        card_id: number
        en: number | null
        anyp: number | null
        region: number | null
      }[]
    ).map((r) => [r.card_id, r])
  )
  const sourceIds = new Map<number, string>()
  const codes = new Map<number, string>()
  if (scopeGame(db, scope) === 'pkm') {
    const ids2 = cards.map((c) => c.id)
    const l2 = JSON.stringify(ids2)
    for (const r of db
      .prepare(`SELECT card_id, source_id FROM pokemon_cards WHERE card_id IN ${IN_LIST}`)
      .all(l2) as { card_id: number; source_id: string }[])
      sourceIds.set(r.card_id, r.source_id)
    for (const r of db
      .prepare(
        `SELECT p.card_id, MIN(p.set_code) AS code FROM card_printings p
         WHERE p.card_id IN ${IN_LIST} AND +p.game = ${scope.game} AND p.language = 'en'
         GROUP BY p.card_id`
      )
      .all(l2) as { card_id: number; code: string }[])
      codes.set(r.card_id, r.code)
  }
  for (const c of cards) {
    const p = prices.get(c.id)
    const price = p ? (p.en ?? p.anyp) : null
    facts[c.id] = {
      id: c.id,
      name: c.name,
      type: c.type,
      frameType: c.frame_type,
      imageId: images.get(c.id) ?? null,
      owned: owned.get(c.id) ?? 0,
      price,
      regionPrice: p?.region ?? price,
      sourceId: sourceIds.get(c.id) ?? null,
      code: codes.get(c.id) ?? null
    }
  }
  return facts
}

/** Each pinned printing's art: its own (printingArtImageId), else its card's first image. */
function pinnedArt(
  db: SqlDb,
  pkeys: string[],
  images: Map<number, number>,
  scope: Scope
): Record<string, number> {
  const art: Record<string, number> = {}
  if (pkeys.length === 0) return art
  const rows = db
    .prepare(
      `SELECT p.pkey, p.card_id, p.language, p.set_rarity_code, p.contributed FROM card_printings p
       WHERE p.pkey IN ${IN_LIST} AND +p.game = ${scope.game}`
    )
    .all(JSON.stringify(pkeys)) as (Pick<
    PrintingDbRow,
    'card_id' | 'language' | 'set_rarity_code' | 'contributed'
  > & { pkey: string })[]
  for (const r of rows) {
    const id = printingArtImageId(r) ?? images.get(r.card_id)
    if (id !== undefined) art[r.pkey] = id
  }
  return art
}

function readDecks(db: SqlDb, scope: Scope, uid?: string): DeckDbRow[] {
  return db
    .prepare(
      `SELECT d.uid, d.game, d.format, d.name, d.notes, d.cover, d.private, d.cards, d.last_verdict,
              d.created_at, d.updated_at
       FROM decks d WHERE ${scope.where('d')}${uid === undefined ? '' : ' AND d.uid = ?'}
       ORDER BY d.updated_at DESC, d.uid`
    )
    .all(...(uid === undefined ? [] : [uid])) as DeckDbRow[]
}

/**
 * The tile's art: the picked cover while the deck still holds that card, else the first Main
 * entry with art, else any entry's.
 */
function coverImage(r: DeckDbRow, cards: DeckEntry[], images: Map<number, number>): number | null {
  if (r.cover !== null && cards.some((e) => e.card === r.cover)) {
    const picked = images.get(r.cover)
    if (picked !== undefined) return picked
  }
  const first = (es: DeckEntry[]): number | undefined =>
    es.map((e) => images.get(e.card)).find((id) => id !== undefined)
  return first(cards.filter((e) => e.section === 'main')) ?? first(cards) ?? null
}

function summary(r: DeckDbRow, cards: DeckEntry[], images: Map<number, number>): DeckSummary {
  return {
    uid: r.uid,
    game: r.game as GameId,
    format: r.format,
    name: r.name,
    private: r.private === 1,
    coverImageId: coverImage(r, cards, images),
    cards,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastSeen: parseMark(r.last_verdict)
  }
}

/** Card ids in the decks, and the ids whose first image is needed (those plus the covers). */
function idsOf(rows: { r: DeckDbRow; cards: DeckEntry[] }[]): {
  cardIds: number[]
  imageIds: number[]
} {
  const cardIds = new Set<number>()
  const imageIds = new Set<number>()
  for (const { r, cards } of rows) {
    for (const e of cards) {
      cardIds.add(e.card)
      imageIds.add(e.card)
    }
    if (r.cover !== null) imageIds.add(r.cover)
  }
  return { cardIds: [...cardIds], imageIds: [...imageIds] }
}

/** The scope's decks of its game, newest edit first, with the facts of every card in them. */
export function listDecks(db: SqlDb, scope: Scope = LOCAL): DeckList {
  const rows = readDecks(db, scope).map((r) => ({ r, cards: parseCards(r.cards) }))
  const { cardIds, imageIds } = idsOf(rows)
  const images = firstImages(db, imageIds, scope)
  return {
    decks: rows.map(({ r, cards }) => summary(r, cards, images)),
    cardFacts: deckCards(db, cardIds, images, scope)
  }
}

/** One of the scope's decks, or null when it has none live by that uid. */
export function getDeck(db: SqlDb, uid: unknown, scope: Scope = LOCAL): DeckDetail | null {
  const r = readDecks(db, scope, checkUid(uid))[0]
  if (!r) return null
  const cards = parseCards(r.cards)
  const { cardIds, imageIds } = idsOf([{ r, cards }])
  const images = firstImages(db, imageIds, scope)
  const pkeys = [...new Set(cards.flatMap((e) => (e.printing ? [e.printing] : [])))]
  return {
    ...summary(r, cards, images),
    notes: r.notes,
    cover: r.cover,
    cardFacts: deckCards(db, cardIds, images, scope),
    printingArt: pinnedArt(db, pkeys, images, scope)
  }
}

/**
 * Adds a deck (a draft with no uid) or replaces one's fields, and returns its uid. A uid the scope
 * doesn't hold live is an error, so a removed deck isn't brought back by a stale editor. A deck is
 * saved however illegal it is; only its fields are checked.
 */
export function saveDeck(
  db: SqlDb,
  draft: unknown,
  now = new Date(),
  scope: Scope = LOCAL
): string {
  const o = checkObject(draft, 'Deck')
  if (o.uid !== undefined) checkUid(o.uid)
  let fields
  try {
    fields = checkDeckFields(o, scopeGame(db, scope))
  } catch (e) {
    if (e instanceof DeckFieldError) throw new CollectionError(e.message)
    throw e
  }
  const ts = now.toISOString()
  const { ownerCol, owner, markerCol, marker, touch } = scope.decks
  const values = [
    fields.format,
    fields.name,
    fields.notes,
    fields.cover,
    fields.private ? 1 : 0,
    JSON.stringify(fields.cards)
  ]
  if (o.uid !== undefined) {
    const uid = o.uid as string
    const info = db
      .prepare(
        `UPDATE decks AS d SET format = ?, name = ?, notes = ?, cover = ?, private = ?, cards = ?,
           updated_at = ?, ${touch}
         WHERE d.uid = ? AND ${scope.where('d')}`
      )
      .run(...values, ts, uid)
    if (info.changes === 0) throw new CollectionError('That deck is gone')
    return uid
  }
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM decks d WHERE ${scope.where('d')}`).get() as {
    n: number
  }
  if (n >= MAX_DECKS_PER_GAME)
    throw new CollectionError(
      `You have ${MAX_DECKS_PER_GAME} decks in this game; remove one to add another`
    )
  const uid = crypto.randomUUID()
  db.prepare(
    `INSERT INTO decks (${ownerCol}, uid, game, format, name, notes, cover, private, cards, created_at,
       updated_at, ${markerCol})
     VALUES (${owner}, ?, ${scope.game}, ?, ?, ?, ?, ?, ?, ?, ?, ${marker})`
  ).run(uid, ...values, ts, ts)
  return uid
}

/**
 * Removes a deck. A tombstone, so other devices hear of it; the desktop's never-signed-in owner 0
 * deletes the row outright, as it does slabs, since no server ever had it.
 */
export function removeDeck(db: SqlDb, uid: unknown, now = new Date(), scope: Scope = LOCAL): void {
  const id = checkUid(uid)
  const { ownerCol, owner, touch } = scope.decks
  if (ownerCol === 'owner_id')
    db.prepare(
      `DELETE FROM decks WHERE uid = ? AND owner_id = 0 AND owner_id = ${owner} AND deleted_at IS NULL`
    ).run(id)
  const ts = now.toISOString()
  db.prepare(
    `UPDATE decks AS d SET deleted_at = ?, updated_at = ?, ${touch}
     WHERE d.uid = ? AND ${scope.where('d')}`
  ).run(ts, ts, id)
}

/** A deck as a friend sees it: its notes and this device's last verdict stay private. */
export const deckForFriends = (d: DeckDetail): DeckDetail => ({ ...d, notes: '', lastSeen: null })

/** A friend's public decks (never the private ones), with only the facts of the cards in them. */
export function decksForFriends(list: DeckList): DeckList {
  const decks = list.decks.filter((d) => !d.private).map((d) => ({ ...d, lastSeen: null }))
  const cardFacts: Record<number, DeckCard> = {}
  for (const d of decks)
    for (const e of d.cards) if (list.cardFacts[e.card]) cardFacts[e.card] = list.cardFacts[e.card]
  return { decks, cardFacts }
}

/** One of a friend's decks as they see it, or null when it is private or not there. */
export function friendDeck(db: SqlDb, uid: unknown, scope: Scope): DeckDetail | null {
  const d = getDeck(db, uid, scope)
  return d && !d.private ? deckForFriends(d) : null
}

/**
 * Records this device's last legality verdict for a deck. Per device and never synced, so it
 * neither marks the deck changed nor moves its updated_at. A gone deck is left alone.
 */
export function markDeckSeen(db: SqlDb, uid: unknown, mark: unknown, scope: Scope = LOCAL): void {
  const id = checkUid(uid)
  const m = checkMark(mark)
  db.prepare(
    `UPDATE decks AS d SET last_verdict = ?, last_pack_version = ? WHERE d.uid = ? AND ${scope.where('d')}`
  ).run(JSON.stringify(m), m.packVersion, id)
}

function checkRefs(v: unknown): DeckLineRef[] {
  if (!Array.isArray(v)) throw new CollectionError('Deck lines must be a list')
  if (v.length > MAX_REFS) throw new CollectionError(`At most ${MAX_REFS} deck lines at a time`)
  return v.map((raw) => {
    const o = checkObject(raw, 'Deck line')
    if (typeof o.passcode === 'number' && Number.isSafeInteger(o.passcode) && o.passcode > 0)
      return { passcode: o.passcode }
    if (typeof o.setCode === 'string' && o.setCode.length <= MAX_REF_TEXT)
      return { setCode: o.setCode.trim() }
    if (typeof o.name === 'string' && o.name.length <= MAX_REF_TEXT) {
      // A Pokémon line's set and number; malformed ones are dropped and the name alone is used.
      if (
        typeof o.set === 'string' &&
        typeof o.number === 'string' &&
        /^[A-Za-z][A-Za-z0-9-]{1,7}$/.test(o.set) &&
        /^[A-Za-z]*\d+[A-Za-z]?$/.test(o.number)
      )
        return { set: o.set, number: o.number, name: o.name }
      return { name: o.name }
    }
    throw new CollectionError('A deck line needs a passcode, set code or name')
  })
}

/**
 * Finds the scope's card for each imported deck line: a passcode is a card id or an alternate
 * art's image id; a set code is any printing's (cards sharing one are ambiguous); a name must equal
 * a card's whole name once both are normalised, so a partial name is unmatched.
 */
export function resolveDeckLines(db: SqlDb, refs: unknown, scope: Scope = LOCAL): DeckResolution[] {
  const lines = checkRefs(refs)
  const passcodes = [...new Set(lines.flatMap((r) => ('passcode' in r ? [r.passcode] : [])))]
  const codes = [
    ...new Set(lines.flatMap((r) => ('setCode' in r && r.setCode ? [r.setCode.toLowerCase()] : [])))
  ]

  const byPasscode = new Map<number, number>()
  if (passcodes.length > 0) {
    const list = JSON.stringify(passcodes)
    const art = db
      .prepare(
        `SELECT i.image_id, i.card_id FROM card_images i
         WHERE i.image_id IN ${IN_LIST} AND +i.game = ${scope.game}`
      )
      .all(list) as { image_id: number; card_id: number }[]
    for (const r of art) byPasscode.set(r.image_id, r.card_id)
    const cards = db
      .prepare(`SELECT c.id FROM cards c WHERE c.id IN ${IN_LIST} AND +c.game = ${scope.game}`)
      .all(list) as { id: number }[]
    for (const r of cards) byPasscode.set(r.id, r.id)
  }

  const byCode = new Map<string, Set<number>>()
  if (codes.length > 0) {
    const rows = db
      .prepare(
        `SELECT DISTINCT p.set_code, p.card_id FROM card_printings p
         WHERE p.set_code COLLATE NOCASE IN ${IN_LIST} AND +p.game = ${scope.game}`
      )
      .all(JSON.stringify(codes)) as { set_code: string; card_id: number }[]
    for (const r of rows) {
      const key = r.set_code.toLowerCase()
      const set = byCode.get(key) ?? new Set<number>()
      set.add(r.card_id)
      byCode.set(key, set)
    }
  }

  // On Pokémon a name only finds cards with an English printing: that's the name deck lists use.
  const pkm = scopeGame(db, scope) === 'pkm'
  const englishOnly = pkm
    ? `AND EXISTS (SELECT 1 FROM card_printings p WHERE p.card_id = c.id AND +p.game = ${scope.game} AND p.language = 'en')`
    : ''
  // Pokémon "set number" refs: English printings of the set whose number matches, zeros ignored.
  const bySetNumber = new Map<string, Set<number>>()
  const stripZeros = (n: string): string => n.toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1')
  const setKey = (set: string, number: string): string =>
    `${set.toLowerCase()} ${stripZeros(number)}`
  const sets = [...new Set(lines.flatMap((r) => ('set' in r ? [r.set.toLowerCase()] : [])))]
  if (sets.length > 0) {
    const stmt = db.prepare(
      `SELECT DISTINCT p.set_code, p.card_id FROM card_printings p
       WHERE p.set_code LIKE ? COLLATE NOCASE AND p.language = 'en' AND +p.game = ${scope.game}`
    )
    for (const set of sets)
      for (const r of stmt.all(`${set} %`) as { set_code: string; card_id: number }[]) {
        const num = r.set_code
          .slice(set.length + 1)
          .split('/')[0]
          .trim()
        const key = setKey(set, num)
        const ids = bySetNumber.get(key) ?? new Set<number>()
        ids.add(r.card_id)
        bySetNumber.set(key, ids)
      }
  }

  const setHit = (r: DeckLineRef): boolean => 'set' in r && bySetNumber.has(setKey(r.set, r.number))

  const named = db.prepare(
    `SELECT c.id, c.name, c.frame_type FROM cards_fts JOIN cards c ON c.id = cards_fts.rowid
     WHERE cards_fts MATCH ? AND +c.game = ${scope.game} ${englishOnly}
     ORDER BY length(c.name), c.id LIMIT ${NAME_HITS}`
  )
  type Hit = { id: number; name: string; frame_type: string }
  const byName = new Map<string, Hit[]>()
  for (const r of lines) {
    if (!('name' in r) || setHit(r)) continue
    const want = normalName(r.name)
    if (byName.has(want)) continue
    const tokens = want.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    if (tokens.length === 0) {
      byName.set(want, [])
      continue
    }
    const hits = (named.all(tokens.map((t) => `"${t}"`).join(' ')) as Hit[]).filter(
      (c) => normalName(c.name) === want
    )
    byName.set(
      want,
      hits.sort((a, b) => a.id - b.id)
    )
  }

  const ambiguousIds = new Set<number>()
  for (const ids of byCode.values()) if (ids.size > 1) for (const id of ids) ambiguousIds.add(id)
  for (const ids of bySetNumber.values())
    if (ids.size > 1) for (const id of ids) ambiguousIds.add(id)
  for (const hits of byName.values())
    if (hits.length > 1) for (const h of hits) ambiguousIds.add(h.id)
  const names = new Map<number, { name: string; frameType: string }>()
  for (const hits of byName.values())
    for (const h of hits) names.set(h.id, { name: h.name, frameType: h.frame_type })
  // Every matched card's name too, so the import preview reads in names, not passcodes.
  const wanted = new Set(ambiguousIds)
  for (const id of byPasscode.values()) wanted.add(id)
  for (const ids of byCode.values()) for (const id of ids) wanted.add(id)
  for (const ids of bySetNumber.values()) for (const id of ids) wanted.add(id)
  const missing = [...wanted].filter((id) => !names.has(id))
  if (missing.length > 0)
    for (const r of db
      .prepare(
        `SELECT c.id, c.name, c.frame_type FROM cards c
         WHERE c.id IN ${IN_LIST} AND +c.game = ${scope.game}`
      )
      .all(JSON.stringify(missing)) as Hit[])
      names.set(r.id, { name: r.name, frameType: r.frame_type })
  const images = firstImages(db, [...ambiguousIds], scope)

  const fact = (card: number): { name: string; frameType: string } =>
    names.get(card) ?? { name: '', frameType: '' }
  const resolve = (ids: number[]): DeckResolution =>
    ids.length === 0
      ? { status: 'unmatched' }
      : ids.length === 1
        ? { status: 'matched', card: ids[0], ...fact(ids[0]) }
        : {
            status: 'ambiguous',
            options: ids.map((card) => ({
              card,
              ...fact(card),
              imageId: images.get(card) ?? null
            }))
          }

  return lines.map((r) => {
    if ('passcode' in r) {
      const card = byPasscode.get(r.passcode)
      return card === undefined
        ? { status: 'unmatched' }
        : { status: 'matched', card, ...fact(card) }
    }
    if ('setCode' in r)
      return resolve([...(byCode.get(r.setCode.toLowerCase()) ?? [])].sort((a, b) => a - b))
    const byNameIds = (): number[] => (byName.get(normalName(r.name)) ?? []).map((h) => h.id)
    // Basic Energy is interchangeable: of several cards, take the SVE one, else the lowest id.
    const byBasicName = (): DeckResolution => {
      const ids = byNameIds()
      if (pkm && ids.length > 1 && BASIC_ENERGY.test(normalName(r.name))) {
        const sve = new Set(
          (
            db
              .prepare(
                `SELECT DISTINCT p.card_id FROM card_printings p
                 WHERE p.card_id IN ${IN_LIST} AND +p.game = ${scope.game}
                   AND p.language = 'en' AND p.set_code LIKE 'SVE %' COLLATE NOCASE`
              )
              .all(JSON.stringify(ids)) as { card_id: number }[]
          ).map((x) => x.card_id)
        )
        return resolve([ids.find((id) => sve.has(id)) ?? ids[0]])
      }
      return resolve(ids)
    }
    if ('set' in r) {
      const ids = [...(bySetNumber.get(setKey(r.set, r.number)) ?? [])].sort((a, b) => a - b)
      return ids.length > 0 ? resolve(ids) : byBasicName()
    }
    return byBasicName()
  })
}
