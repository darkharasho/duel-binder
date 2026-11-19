import { getMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import {
  GradedFieldError,
  checkGradedFields,
  type GradedCopy,
  type GradedDraft
} from '../../shared/graded'
import type { GameId } from '../../shared/games'
import { checkObject } from './args'
import {
  printingArtImageId,
  rowToCard,
  rowToPrinting,
  type CardDbRow,
  type PrintingDbRow
} from './cards'
import { CollectionError, cardPriceColumns, entryPrice } from './collection'
import { LOCAL, type Scope } from './scope'

const MAX_UID = 64

/** The scope's slabs, of its game, whose printing this catalog has; `where` narrows them (SQL on `c`/`p`). */
function readGraded(db: SqlDb, scope: Scope, where: string, args: unknown[]): GradedCopy[] {
  const rows = db
    .prepare(
      `SELECT g.uid AS g_uid, g.game AS g_game, g.pkey AS g_pkey, g.image_id AS g_image_id,
              g.company AS g_company, g.grade AS g_grade, g.label AS g_label, g.cert AS g_cert,
              g.subgrades AS g_subgrades,
              g.value AS g_value, g.paid AS g_paid, g.notes AS g_notes, g.created_at AS g_created_at,
              COALESCE(rs.tcg_date, res.tcg_date) AS g_release_date,
              gp.price AS gp_price, gp.listing_count AS gp_listings, gp.checked_at AS gp_checked,
              ${cardPriceColumns(scope)}
       FROM graded_copies g
       JOIN card_printings p ON p.pkey = g.pkey AND +p.game = ${scope.game}
       JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
       LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}
       LEFT JOIN sets rs ON rs.game = p.game AND rs.language = p.language AND rs.set_name = p.set_name
       LEFT JOIN sets res ON res.game = p.game AND res.language = 'en' AND res.set_name = p.set_name
       LEFT JOIN graded_prices gp ON gp.pkey = g.pkey AND gp.company = g.company AND gp.grade = g.grade
       WHERE ${scope.where('g')} ${where}
       ORDER BY g.created_at DESC, g.uid`
    )
    .all(...args) as Record<string, unknown>[]
  const status = getMeta(db, 'price_service_status')
  return rows.map((r) => {
    const card = rowToCard(r as unknown as CardDbRow)
    const printing = rowToPrinting({
      ...(r as unknown as PrintingDbRow),
      id: r.p_id as number,
      release_date: r.g_release_date as string | null
    })
    const { unitPrice } = entryPrice(r, card, printing, status)
    return {
      uid: r.g_uid as string,
      game: r.g_game as GameId,
      pkey: r.g_pkey as string,
      card,
      printing,
      imageId: r.g_image_id as number,
      printingScan: true,
      company: r.g_company as string,
      grade: r.g_grade as string,
      label: r.g_label as string,
      cert: r.g_cert as string,
      subgrades: r.g_subgrades as string,
      value: (r.g_value as number | null) ?? null,
      paid: (r.g_paid as number | null) ?? null,
      notes: r.g_notes as string,
      rawPrice: unitPrice,
      market:
        typeof r.gp_price === 'number'
          ? {
              price: r.gp_price,
              listings: r.gp_listings as number,
              checkedAt: r.gp_checked as string
            }
          : null,
      createdAt: r.g_created_at as string
    }
  })
}

/** The scope's slabs of the game shown, newest first. */
export function listGraded(db: SqlDb, scope: Scope = LOCAL): GradedCopy[] {
  return readGraded(db, scope, '', [])
}

/** The scope's slabs of one card, newest first. */
export function gradedForCard(db: SqlDb, cardId: number, scope: Scope = LOCAL): GradedCopy[] {
  return readGraded(db, scope, 'AND c.id = ?', [cardId])
}

/** The art a slab of `printingId` shows: `imageId` when it's the card's, else the printing's own, else the card's first. */
function printingAndArt(
  db: SqlDb,
  printingId: number,
  imageId: number | undefined,
  scope: Scope
): { pkey: string; imageId: number } {
  const p = db
    .prepare(
      `SELECT p.pkey, p.card_id, p.language, p.set_rarity_code, p.contributed FROM card_printings p
       WHERE p.id = ? AND +p.game = ${scope.game}`
    )
    .get(printingId) as
    | (Pick<PrintingDbRow, 'card_id' | 'language' | 'set_rarity_code' | 'contributed'> & {
        pkey: string | null
      })
    | undefined
  if (!p || !p.pkey) throw new CollectionError(`Printing ${printingId} not found`)
  const images = (
    db
      .prepare(`SELECT i.image_id FROM card_images i WHERE i.card_id = ? ORDER BY i.sort_order`)
      .all(p.card_id) as { image_id: number }[]
  ).map((i) => i.image_id)
  if (imageId !== undefined) {
    if (!images.includes(imageId))
      throw new CollectionError('Image does not belong to the printing’s card')
    return { pkey: p.pkey, imageId }
  }
  const own = printingArtImageId(p)
  const art = own ?? images[0]
  if (art === undefined) throw new CollectionError('The card has no art')
  return { pkey: p.pkey, imageId: art }
}

/**
 * Adds a slab (a draft with no uid) or replaces one's fields, and returns its uid. A uid the scope
 * doesn't hold live is an error, so a removed slab isn't brought back by a stale form.
 */
export function saveGraded(
  db: SqlDb,
  draft: unknown,
  now = new Date(),
  scope: Scope = LOCAL
): string {
  const o = checkObject(draft, 'Graded copy')
  if (typeof o.printingId !== 'number' || !Number.isSafeInteger(o.printingId) || o.printingId < 1)
    throw new CollectionError('printingId must be a positive whole number')
  if (
    o.imageId !== undefined &&
    (typeof o.imageId !== 'number' || !Number.isSafeInteger(o.imageId))
  )
    throw new CollectionError('imageId must be a whole number')
  if (o.uid !== undefined && (typeof o.uid !== 'string' || !o.uid || o.uid.length > MAX_UID))
    throw new CollectionError('uid must be text')
  let fields
  try {
    fields = checkGradedFields(o)
  } catch (e) {
    if (e instanceof GradedFieldError) throw new CollectionError(e.message)
    throw e
  }
  const d = o as unknown as GradedDraft
  const { pkey, imageId } = printingAndArt(db, d.printingId, d.imageId, scope)
  const ts = now.toISOString()
  const { ownerCol, owner, markerCol, marker, touch } = scope.graded
  const values = [
    pkey,
    imageId,
    fields.company,
    fields.grade,
    fields.label,
    fields.cert,
    fields.subgrades,
    fields.value,
    fields.paid,
    fields.notes
  ]
  if (d.uid !== undefined) {
    const info = db
      .prepare(
        `UPDATE graded_copies AS g SET pkey = ?, image_id = ?, company = ?, grade = ?, label = ?, cert = ?,
           subgrades = ?, value = ?, paid = ?, notes = ?, updated_at = ?, ${touch}
         WHERE g.uid = ? AND ${scope.where('g')}`
      )
      .run(...values, ts, d.uid)
    if (info.changes === 0) throw new CollectionError('That graded copy is gone')
    return d.uid
  }
  const uid = crypto.randomUUID()
  db.prepare(
    `INSERT INTO graded_copies (${ownerCol}, uid, game, pkey, image_id, company, grade, label, cert, subgrades, value,
       paid, notes, created_at, updated_at, ${markerCol})
     VALUES (${owner}, ?, ${scope.game}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${marker})`
  ).run(uid, ...values, ts, ts)
  return uid
}

/**
 * Removes a slab. A tombstone, so other devices hear of it; the desktop's never-signed-in owner 0
 * deletes the row outright, as it does entries, since no server ever had it.
 */
export function removeGraded(
  db: SqlDb,
  uid: unknown,
  now = new Date(),
  scope: Scope = LOCAL
): void {
  if (typeof uid !== 'string' || !uid || uid.length > MAX_UID)
    throw new CollectionError('uid must be text')
  const { ownerCol, owner, touch } = scope.graded
  if (ownerCol === 'owner_id')
    db.prepare(
      `DELETE FROM graded_copies WHERE uid = ? AND owner_id = 0 AND owner_id = ${owner} AND deleted_at IS NULL`
    ).run(uid)
  const ts = now.toISOString()
  db.prepare(
    `UPDATE graded_copies AS g SET deleted_at = ?, updated_at = ?, ${touch}
     WHERE g.uid = ? AND ${scope.where('g')}`
  ).run(ts, ts, uid)
}
