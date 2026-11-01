import { RARITY_LABEL } from '../db/schema'
import type { SqlDb } from '../db/sql'
import {
  GOALS,
  MAX_BINDER_EDITS,
  MAX_BINDER_MATCHES,
  MAX_BINDERS,
  draftProblem,
  rulesEditable,
  type BinderDraft,
  type BinderEditAction,
  type BinderGoal,
  type BinderRules,
  type BinderTarget
} from '../../shared/binders'
import { isLanguage, type Language } from '../../shared/languages'
import type { GameId } from '../../shared/games'
import type {
  BinderCard,
  BinderDetail,
  BinderPreview,
  BinderSummary,
  CardBinder,
  CardRow,
  Printing
} from '../../shared/types'
import { matchedPrintingCount, narrowedRuleSql, ruleSql, type CardLookups } from './binderRules'
import {
  buildSlots,
  type Slot,
  type SlotCopy,
  type SlotEdit,
  type SlotImage,
  type SlotPrinting,
  type SlotResult
} from './binderSlots'
import { POKEMON_COLS, rowToCard, rowToPrinting, type CardDbRow, type PrintingDbRow } from './cards'
import { CollectionError } from './collection'
import { LOCAL, scopeGame, type Scope } from './scope'
import { printingPrice } from './sets'
import { shownPrinting } from './shownPrinting'

interface BinderDbRow {
  uid: string
  game: GameId
  name: string
  rules: string
  goal: string // a newer app's may be one this app doesn't know
  languages: string
  friends_visible: number
}

/** What slots are built from. `rules` is null when this app can't read them, and matches nothing. */
interface BinderSource {
  goal: BinderGoal
  languages: Language[]
  rules: BinderRules | null
}

interface Loaded {
  tooBroad: boolean
  printings: SlotPrinting[]
  result: SlotResult
}

const NO_SLOTS: SlotResult = {
  slots: [],
  ownedSlots: 0,
  missingSlots: 0,
  valueToFinish: 0,
  unpricedMissing: 0
}
const NO_RULES: BinderRules = { version: 1, rules: [] }
const IN_LIST = '(SELECT value FROM json_each(?))'

/** The stored languages, or null when this app can't read them all. */
const parseLanguages = (raw: string): Language[] | null => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every(isLanguage) ? parsed : null
  } catch {
    return null
  }
}

/**
 * A goal or language this app doesn't know makes the whole binder unreadable, like rules it can't
 * read: it matches nothing and can't be edited, and the stored row stays as it came.
 */
const sourceOf = (row: BinderDbRow): BinderSource => {
  const goal = GOALS[row.game].find((g) => g === row.goal)
  const languages = parseLanguages(row.languages)
  return {
    goal: goal ?? 'none',
    languages: languages ?? [],
    rules: goal && languages ? rulesEditable(row.rules) : null
  }
}

/** No rules means a hand-made binder, not "every printing". */
const hasRuleMatches = (rules: BinderRules | null): rules is BinderRules =>
  rules !== null && rules.rules.length > 0

const BINDER_COLS = 'b.uid, b.game, b.name, b.rules, b.goal, b.languages, b.friends_visible'

/** The scope's binders, in their saved order; only those in `uids` when given. */
function liveBinders(db: SqlDb, scope: Scope, uids?: ReadonlySet<string>): BinderDbRow[] {
  return db
    .prepare(
      `SELECT ${BINDER_COLS} FROM binders b
       WHERE ${scope.where('b')} ${uids ? `AND b.uid IN ${IN_LIST}` : ''}
       ORDER BY b.sort_order, b.created_at, b.uid`
    )
    .all(...(uids ? [JSON.stringify([...uids])] : [])) as BinderDbRow[]
}

function liveBinder(db: SqlDb, uid: string, scope: Scope): BinderDbRow | undefined {
  return db
    .prepare(`SELECT ${BINDER_COLS} FROM binders b WHERE b.uid = ? AND ${scope.where('b')}`)
    .get(uid) as BinderDbRow | undefined
}

function binderEdits(db: SqlDb, uid: string, scope: Scope): SlotEdit[] {
  return db
    .prepare(
      `SELECT e.level, e.target, e.action FROM binder_edits e
       WHERE e.binder_uid = ? AND ${scope.where('e')}`
    )
    .all(uid) as SlotEdit[]
}

/** Aliases p, c, pc and (when `priced`) ip, ready for `AND …`. `listed` is what a slot may be built on. */
const printingsSql = (scope: Scope, cols: string, priced = true): string => `
  SELECT ${cols}
  FROM card_printings p
  JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
  LEFT JOIN pokemon_cards pc ON pc.card_id = c.id AND ${scope.game} = 'pkm'
  ${priced ? `LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}` : ''}
  WHERE +p.game = ${scope.game}`

const slotPrintingCols = (scope: Scope, priced: boolean): string =>
  `p.pkey, p.id AS printing_id, p.card_id, (p.contributed = 0 AND ${shownPrinting(scope)}) AS listed,
   ${priced ? printingPrice(scope) : 'NULL'} AS price`

interface SlotPrintingRow {
  pkey: string
  printing_id: number
  card_id: number
  listed: number
  price: number | null
}

/**
 * Printings of the scope's game meeting `where`, each marked as `qualifies` says, in id order
 * however the query reached them (sorted here: an ORDER BY would tempt the planner to walk p by id).
 * Unpriced ones skip the price lookups, for callers that only count slots.
 */
function slotPrintings(
  db: SqlDb,
  where: string,
  params: unknown[],
  qualifies: boolean,
  scope: Scope,
  priced = true
): SlotPrinting[] {
  const rows = db
    .prepare(`${printingsSql(scope, slotPrintingCols(scope, priced), priced)} AND ${where}`)
    .all(...params) as SlotPrintingRow[]
  rows.sort((a, b) => a.printing_id - b.printing_id)
  return rows.map((r) => ({
    pkey: r.pkey,
    printingId: r.printing_id,
    cardId: r.card_id,
    listed: r.listed === 1,
    qualifies,
    price: r.price
  }))
}

/** Which of these ids are cards of the scope's game. */
function knownCards(db: SqlDb, ids: number[], scope: Scope): Set<number> {
  if (ids.length === 0) return new Set()
  const rows = db
    .prepare(`SELECT c.id FROM cards c WHERE +c.game = ${scope.game} AND c.id IN ${IN_LIST}`)
    .all(JSON.stringify(ids)) as { id: number }[]
  return new Set(rows.map((r) => r.id))
}

/** The cards of these pkeys, by pkey. A pkey not in this catalog yet is left out. */
function cardsOfPkeys(db: SqlDb, pkeys: string[], scope: Scope): Map<string, number> {
  if (pkeys.length === 0) return new Map()
  const rows = db
    .prepare(
      `SELECT p.pkey, p.card_id FROM card_printings p
       WHERE +p.game = ${scope.game} AND p.pkey IN ${IN_LIST}`
    )
    .all(JSON.stringify(pkeys)) as { pkey: string; card_id: number }[]
  return new Map(rows.map((r) => [r.pkey, r.card_id]))
}

/**
 * The scope's live copies, of these cards or else all of them, oldest entry first.
 * Never from catalogRollup: a binder reads ownership live.
 */
function readCopies(db: SqlDb, scope: Scope, cardIds?: number[]): SlotCopy[] {
  const rows = db
    .prepare(
      `SELECT p.pkey, p.card_id, e.id, e.image_id, e.quantity FROM collection_entries e
       JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
       WHERE ${scope.where('e')} ${cardIds ? `AND p.card_id IN ${IN_LIST}` : ''}`
    )
    .all(...(cardIds ? [JSON.stringify(cardIds)] : [])) as {
    pkey: string
    card_id: number
    id: number
    image_id: number
    quantity: number
  }[]
  rows.sort((a, b) => a.id - b.id)
  return rows.map((r) => ({
    pkey: r.pkey,
    cardId: r.card_id,
    imageId: r.image_id,
    quantity: r.quantity
  }))
}

function copiesOf(db: SqlDb, cardIds: number[], scope: Scope): SlotCopy[] {
  return cardIds.length === 0 ? [] : readCopies(db, scope, cardIds)
}

function imagesOf(db: SqlDb, cardIds: number[], scope: Scope): SlotImage[] {
  if (cardIds.length === 0) return []
  const rows = db
    .prepare(
      `SELECT i.image_id, i.card_id, i.sort_order FROM card_images i
       WHERE +i.game = ${scope.game} AND i.card_id IN ${IN_LIST}`
    )
    .all(JSON.stringify(cardIds)) as { image_id: number; card_id: number; sort_order: number }[]
  return rows.map((r) => ({ imageId: r.image_id, cardId: r.card_id, sortOrder: r.sort_order }))
}

/**
 * Builds a binder's slots. Over the match cap it stops at the count: no slots, and no other query.
 * Hand adds whose card or printing isn't in this catalog yet are held back until it arrives, so they
 * make no slot and aren't counted as missing.
 *
 * With `summary` it builds the same slots with no prices, for the counts alone, and takes the owner's
 * copies and the card lookups from there, so many binders share one read.
 */
function loadSlots(
  db: SqlDb,
  source: BinderSource,
  readEdits: () => SlotEdit[],
  scope: Scope,
  summary?: { copies: (cardIds: number[]) => SlotCopy[]; lookups: CardLookups }
): Loaded {
  const { goal, languages, rules } = source
  const priced = !summary
  const printings = new Map<string, SlotPrinting>()
  if (hasRuleMatches(rules)) {
    const w = narrowedRuleSql(db, rules, languages, scope, summary?.lookups)
    // A summary's rows are cheap enough to be the count too; priced ones are not.
    const over = (n: number): boolean => n > MAX_BINDER_MATCHES
    const tooBroad: Loaded = { tooBroad: true, printings: [], result: NO_SLOTS }
    if (!summary && over(matchedPrintingCount(db, rules, languages, scope, MAX_BINDER_MATCHES, w)))
      return tooBroad
    const limit = summary ? `LIMIT ${MAX_BINDER_MATCHES + 1}` : ''
    const matched = slotPrintings(db, `${w.sql} ${limit}`, w.params, true, scope, priced)
    if (over(matched.length)) return tooBroad
    for (const p of matched) printings.set(p.pkey, p)
  }

  const edits = readEdits()
  const adds = (level: SlotEdit['level']): string[] =>
    edits.filter((e) => e.level === level && e.action === 'add').map((e) => e.target)
  const added = knownCards(db, adds('card').map(Number).filter(Number.isInteger), scope)
  const addedPrintings = cardsOfPkeys(db, adds('printing'), scope)
  const inCatalog = (e: SlotEdit): boolean => {
    if (e.action !== 'add') return true
    if (e.level === 'card') return added.has(Number(e.target))
    return e.level !== 'printing' || addedPrintings.has(e.target)
  }

  const handCards = [...new Set([...added, ...addedPrintings.values()])]
  if (handCards.length > 0) {
    const extra = slotPrintings(
      db,
      `p.card_id IN ${IN_LIST}`,
      [JSON.stringify(handCards)],
      false,
      scope,
      priced
    )
    for (const p of extra) if (!printings.has(p.pkey)) printings.set(p.pkey, p)
  }

  const list = [...printings.values()]
  const cardIds = [...new Set([...handCards, ...list.map((p) => p.cardId)])]
  const result = buildSlots(
    goal,
    list,
    goal === 'art' ? imagesOf(db, cardIds, scope) : [],
    summary ? summary.copies(cardIds) : copiesOf(db, cardIds, scope),
    edits.filter(inCatalog)
  )
  return { tooBroad: false, printings: list, result }
}

function firstImage(db: SqlDb, cardId: number, scope: Scope): number | null {
  const row = db
    .prepare(
      `SELECT i.image_id FROM card_images i WHERE i.card_id = ? AND +i.game = ${scope.game}
       ORDER BY i.sort_order, i.image_id LIMIT 1`
    )
    .get(cardId) as { image_id: number } | undefined
  return row?.image_id ?? null
}

/** The first owned slot's art, or else the first slot's. */
function coverImage(db: SqlDb, slots: Slot[], scope: Scope): number | null {
  const slot = slots.find((s) => s.owned > 0) ?? slots[0]
  if (!slot) return null
  return slot.imageId ?? firstImage(db, slot.cardId, scope)
}

function summarize(
  db: SqlDb,
  row: BinderDbRow,
  source: BinderSource,
  loaded: Loaded,
  scope: Scope
): BinderSummary {
  return {
    uid: row.uid,
    name: row.name,
    goal: source.goal,
    languages: source.languages,
    friendsVisible: row.friends_visible === 1,
    hasRules: source.rules === null || source.rules.rules.length > 0,
    editable: source.rules !== null,
    ownedSlots: loaded.result.ownedSlots,
    missingSlots: loaded.result.missingSlots,
    tooBroad: loaded.tooBroad,
    coverImageId: coverImage(db, loaded.result.slots, scope)
  }
}

/** The scope's binders, in their saved order, with progress; only those in `uids` when given. */
export function listBinders(
  db: SqlDb,
  scope: Scope = LOCAL,
  uids?: ReadonlySet<string>
): BinderSummary[] {
  let owned: SlotCopy[] | undefined
  const copies = (cardIds: number[]): SlotCopy[] => {
    if (cardIds.length === 0) return []
    owned ??= readCopies(db, scope)
    const wanted = new Set(cardIds)
    return owned.filter((c) => wanted.has(c.cardId))
  }
  const shared = { copies, lookups: new Map<string, number[]>() }
  return liveBinders(db, scope, uids).map((row) => {
    const source = sourceOf(row)
    const readEdits = (): SlotEdit[] => binderEdits(db, row.uid, scope)
    return summarize(db, row, source, loadSlots(db, source, readEdits, scope, shared), scope)
  })
}

const CARD_COLS = `c.id, c.name, c.type, c.frame_type, c.race, c.attribute, c.level, c.linkval, c.atk,
  c.def, c.archetype, c.desc, c.tcgplayer_price, ${POKEMON_COLS}`

function binderCards(db: SqlDb, slots: Slot[], scope: Scope): BinderCard[] {
  if (slots.length === 0) return []
  const cardIds = [...new Set(slots.map((s) => s.cardId))]
  const cardRows = db
    .prepare(
      `SELECT ${CARD_COLS},
              (SELECT i.image_id FROM card_images i WHERE i.card_id = c.id AND +i.game = ${scope.game}
               ORDER BY i.sort_order, i.image_id LIMIT 1) AS first_image
       FROM cards c LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
       WHERE +c.game = ${scope.game} AND c.id IN ${IN_LIST}`
    )
    .all(JSON.stringify(cardIds)) as (CardDbRow & { first_image: number | null })[]
  const cards = new Map<number, { card: CardRow; firstImage: number | null }>(
    cardRows.map((r) => [r.id, { card: rowToCard(r), firstImage: r.first_image }])
  )

  const printingIds = slots.flatMap((s) => (s.printing ? [s.printing.printingId] : []))
  const printingRows = printingIds.length
    ? (db
        .prepare(
          `SELECT p.id, p.card_id, p.set_name, p.set_code, ${RARITY_LABEL} AS set_rarity, p.set_rarity_code,
                  ${printingPrice(scope)} AS set_price, p.missing_from_api, p.language
           FROM card_printings p
           LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}
           WHERE +p.game = ${scope.game} AND p.id IN ${IN_LIST}`
        )
        .all(JSON.stringify(printingIds)) as PrintingDbRow[])
    : []
  const printings = new Map<number, Printing>(printingRows.map((r) => [r.id, rowToPrinting(r)]))

  return slots.flatMap((slot) => {
    const found = cards.get(slot.cardId)
    if (!found) return []
    return [
      {
        key: slot.key,
        level: slot.level,
        card: found.card,
        imageId: slot.imageId ?? found.firstImage ?? 0,
        printing: (slot.printing && printings.get(slot.printing.printingId)) ?? null,
        printingScan: true,
        owned: slot.owned,
        added: slot.added,
        price: slot.price
      }
    ]
  })
}

/** One of the scope's binders, with its cards; null if deleted, unknown or of the other game. */
export function getBinder(db: SqlDb, uid: string, scope: Scope = LOCAL): BinderDetail | null {
  const row = liveBinder(db, uid, scope)
  if (!row) return null
  const source = sourceOf(row)
  const loaded = loadSlots(db, source, () => binderEdits(db, uid, scope), scope)
  const { slots, valueToFinish, unpricedMissing } = loaded.result
  return {
    ...summarize(db, row, source, loaded, scope),
    rules: source.rules ?? NO_RULES,
    cards: binderCards(db, slots, scope),
    valueToFinish,
    unpricedMissing
  }
}

/** What a draft's rules match, ignoring hand edits. The form calls this before there is a name. */
export function previewBinder(db: SqlDb, draft: BinderDraft, scope: Scope = LOCAL): BinderPreview {
  const problem = draftProblem({ ...draft, name: 'Preview' }, scopeGame(db, scope))
  if (problem) throw new CollectionError(problem)
  const loaded = loadSlots(db, draft, () => [], scope)
  const matches = loaded.printings.filter((p) => p.listed && p.qualifies)
  return {
    printings: matches.length,
    cards: new Set(matches.map((p) => p.cardId)).size,
    owned: loaded.result.ownedSlots,
    tooBroad: loaded.tooBroad
  }
}

/**
 * Creates a binder, or replaces one this scope has; returns its uid. A binder this app can't read
 * can't be saved, since that would overwrite what a newer app stored.
 */
export function saveBinder(
  db: SqlDb,
  draft: BinderDraft,
  now = new Date(),
  scope: Scope = LOCAL
): string {
  const problem = draftProblem(draft, scopeGame(db, scope))
  if (problem) throw new CollectionError(problem)
  const { ownerCol, owner, markerCol, marker, touch } = scope.binderSync('binders')
  const known = draft.uid
    ? (db
        .prepare(
          `SELECT ${BINDER_COLS}, b.deleted_at, b.game = ${scope.game} AS same_game FROM binders b
           WHERE b.uid = ? AND b.${ownerCol} = ${owner}`
        )
        .get(draft.uid) as
        (BinderDbRow & { deleted_at: string | null; same_game: number }) | undefined)
    : undefined
  if (known && !known.same_game) throw new CollectionError('Binder not found')
  const live = known !== undefined && known.deleted_at === null
  if (live && sourceOf(known).rules === null)
    throw new CollectionError('Update the app to edit this binder.')
  if (!live && liveBinders(db, scope).length >= MAX_BINDERS)
    throw new CollectionError(`You can have at most ${MAX_BINDERS} binders.`)

  const uid = draft.uid || crypto.randomUUID()
  const ts = now.toISOString()
  db.prepare(
    `INSERT INTO binders (${ownerCol}, uid, game, name, rules, goal, languages, friends_visible,
                          sort_order, created_at, updated_at, ${markerCol})
     VALUES (${owner}, ?, ${scope.game}, ?, ?, ?, ?, ?,
             (SELECT COALESCE(MAX(b.sort_order), -1) + 1 FROM binders b WHERE ${scope.where('b')}),
             ?, ?, ${marker})
     ON CONFLICT(${ownerCol}, uid) DO UPDATE SET name = excluded.name, rules = excluded.rules,
       goal = excluded.goal, languages = excluded.languages, friends_visible = excluded.friends_visible,
       sort_order = CASE WHEN deleted_at IS NULL THEN sort_order ELSE excluded.sort_order END,
       created_at = CASE WHEN deleted_at IS NULL THEN created_at ELSE excluded.created_at END,
       updated_at = excluded.updated_at, deleted_at = NULL, ${touch}`
  ).run(
    uid,
    draft.name.trim(),
    JSON.stringify(draft.rules),
    draft.goal,
    JSON.stringify(draft.languages),
    draft.friendsVisible ? 1 : 0,
    ts,
    ts
  )
  return uid
}

/** Deletes a binder and its edits. Tombstones, so other devices hear of it. */
export function removeBinder(db: SqlDb, uid: string, now = new Date(), scope: Scope = LOCAL): void {
  const edits = db
    .prepare(
      `SELECT e.level, e.target FROM binder_edits e WHERE e.binder_uid = ? AND ${scope.where('e')}`
    )
    .all(uid) as { level: string; target: string }[]
  const ts = now.toISOString()
  const dropBinder = db.prepare(
    `UPDATE binders AS b SET deleted_at = ?, updated_at = ?, ${scope.binderSync('binders').touch}
     WHERE b.uid = ? AND ${scope.where('b')}`
  )
  // One statement per row: the server's touch reads the next seq once per statement.
  const dropEdit = db.prepare(
    `UPDATE binder_edits AS e SET deleted_at = ?, updated_at = ?, ${scope.binderSync('binder_edits').touch}
     WHERE e.binder_uid = ? AND e.level = ? AND e.target = ? AND ${scope.where('e')}`
  )
  db.transaction(() => {
    dropBinder.run(ts, ts, uid)
    for (const { level, target } of edits) dropEdit.run(ts, ts, uid, level, target)
  })()
}

/** What's wrong with an edit, or null. Art edits only remove: a binder has no "add this art". */
function editProblem(target: BinderTarget, action: BinderEditAction | null): string | null {
  if (action !== 'add' && action !== 'remove' && action !== null) return 'Unknown binder edit.'
  const value = target?.target
  if (typeof value !== 'string' || !value) return 'A binder edit needs a target.'
  if (target.level === 'printing') return null
  if (target.level !== 'card' && target.level !== 'art') return 'Unknown binder edit level.'
  if (!/^\d+$/.test(value)) return 'A binder edit needs a card or art id.'
  return target.level === 'art' && action === 'add'
    ? 'Art can only be removed from a binder.'
    : null
}

/**
 * Adds to or removes from a binder by hand, or (null) drops that edit. The target needn't be in this
 * catalog yet: it takes effect when it arrives.
 */
export function setBinderEdit(
  db: SqlDb,
  uid: string,
  target: BinderTarget,
  action: BinderEditAction | null,
  now = new Date(),
  scope: Scope = LOCAL
): void {
  const problem = editProblem(target, action)
  if (problem) throw new CollectionError(problem)
  if (!liveBinder(db, uid, scope)) throw new CollectionError('Binder not found')
  const { level, target: value } = target
  const current = db
    .prepare(
      `SELECT e.action FROM binder_edits e
       WHERE e.binder_uid = ? AND e.level = ? AND e.target = ? AND ${scope.where('e')}`
    )
    .get(uid, level, value) as { action: BinderEditAction } | undefined
  if ((current?.action ?? null) === action) return

  const { ownerCol, owner, markerCol, marker, touch } = scope.binderSync('binder_edits')
  const ts = now.toISOString()
  if (action === null) {
    db.prepare(
      `UPDATE binder_edits AS e SET deleted_at = ?, updated_at = ?, ${touch}
       WHERE e.binder_uid = ? AND e.level = ? AND e.target = ? AND ${scope.where('e')}`
    ).run(ts, ts, uid, level, value)
    return
  }
  if (!current) {
    const { n } = db
      .prepare(
        `SELECT COUNT(*) AS n FROM binder_edits e WHERE e.binder_uid = ? AND ${scope.where('e')}`
      )
      .get(uid) as { n: number }
    if (n >= MAX_BINDER_EDITS)
      throw new CollectionError(`A binder can have at most ${MAX_BINDER_EDITS} hand edits.`)
  }
  db.prepare(
    `INSERT INTO binder_edits (${ownerCol}, binder_uid, level, target, game, action, created_at, updated_at, ${markerCol})
     VALUES (${owner}, ?, ?, ?, ${scope.game}, ?, ?, ?, ${marker})
     ON CONFLICT(${ownerCol}, binder_uid, level, target) DO UPDATE SET action = excluded.action,
       game = excluded.game,
       created_at = CASE WHEN deleted_at IS NULL THEN created_at ELSE excluded.created_at END,
       updated_at = excluded.updated_at, deleted_at = NULL, ${touch}`
  ).run(uid, level, value, action, ts, ts)
}

/** Every binder of the scope, and whether one card is in it, by the same rules as the binder page. */
export function bindersForCard(db: SqlDb, cardId: number, scope: Scope = LOCAL): CardBinder[] {
  const binders = liveBinders(db, scope)
  if (binders.length === 0) return []
  const printings = slotPrintings(db, 'p.card_id = ?', [cardId], false, scope)
  const images = imagesOf(db, [cardId], scope)
  const copies = copiesOf(db, [cardId], scope)
  const pkeys = printings.map((p) => p.pkey)

  const edits = new Map<string, SlotEdit[]>()
  // Only this card's edits, whichever binder they're in; a card not in this catalog has no slots.
  if (knownCards(db, [cardId], scope).size > 0) {
    const rows = db
      .prepare(
        `SELECT e.binder_uid, e.level, e.target, e.action FROM binder_edits e
         WHERE ${scope.where('e')} AND ((e.level = 'card' AND e.target = ?)
           OR (e.level = 'printing' AND e.target IN ${IN_LIST})
           OR (e.level = 'art' AND e.target IN ${IN_LIST}))`
      )
      .all(
        String(cardId),
        JSON.stringify(pkeys),
        JSON.stringify(images.map((i) => String(i.imageId)))
      ) as (SlotEdit & { binder_uid: string })[]
    for (const { binder_uid, ...edit } of rows) {
      edits.set(binder_uid, [...(edits.get(binder_uid) ?? []), edit])
    }
  }

  return binders.map((row) => {
    const { goal, languages, rules } = sourceOf(row)
    let qualifying = new Set<string>()
    if (hasRuleMatches(rules)) {
      const w = ruleSql(rules, languages)
      const matched = db
        .prepare(`${printingsSql(scope, 'p.pkey')} AND p.card_id = ? AND ${w.sql}`)
        .all(cardId, ...w.params) as { pkey: string }[]
      qualifying = new Set(matched.map((m) => m.pkey))
    }
    const own = edits.get(row.uid) ?? []
    const { slots } = buildSlots(
      goal,
      printings.map((p) => ({ ...p, qualifies: qualifying.has(p.pkey) })),
      images,
      copies,
      own
    )
    const onPrintings = own.filter((e) => e.level === 'printing').map((e) => e.action)
    const edit =
      own.find((e) => e.level === 'card')?.action ??
      (onPrintings.includes('add') ? 'add' : (onPrintings[0] ?? null))
    return { uid: row.uid, name: row.name, inBinder: slots.length > 0, edit }
  })
}
