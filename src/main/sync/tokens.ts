import type Database from 'better-sqlite3'
import { isTokenId, tokenId } from '@shared/games/ids'
import { setPrefix } from '@shared/sets'
import { deleteMeta, getMeta, setMeta } from '../db/meta'
import type { YugipediaClient } from '../yugipedia/client'
import { parseGalleryCodes, parseTokenPage, type TokenPage } from '../yugipedia/parse'
import { fileArtName } from '../yugipedia/printingArt'
import { deleteOrFlag, normalizeName } from './intl'

export const TOKEN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const CATEGORY = 'Category:Monster Tokens'
/**
 * The plain "Token" page, whose printings show many different arts. Its other printings go to the
 * cards they show when those have pages, so it comes last.
 */
const GENERIC_TOKEN = 'Token (card)'
const GENERIC_GALLERY = `Card Gallery:${GENERIC_TOKEN}`

export function shouldRefreshTokens(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'token_cards_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= TOKEN_INTERVAL_MS
}

export interface TokenSyncResult {
  /** Cards printed that YGOPRODeck doesn't list. */
  cards: number
  addedCards: number
  /** English printings written, on those and on the token cards YGOPRODeck lists. */
  printings: number
  /** Printed tokens left out because Yugipedia has no scan to show for them. */
  skipped: string[]
  changed: boolean
  ok: boolean
}

/**
 * Brings token cards in from Yugipedia, which YGOPRODeck lacks (the character tokens, printed
 * "Token" with no passcode) or lists without their English printings. A card's name is its
 * Yugipedia title, so the non-English sync finds its printings in the set lists like any other
 * card's and printing scans come from its gallery, and it is told apart from every other "Token".
 * Never rejects; on trouble the stored rows stay and the next run tries again.
 */
export async function refreshTokens(
  db: Database.Database,
  client: YugipediaClient,
  now: Date = new Date()
): Promise<TokenSyncResult> {
  const result: TokenSyncResult = {
    cards: 0,
    addedCards: 0,
    printings: 0,
    skipped: [],
    changed: false,
    ok: false
  }
  try {
    await run(db, client, now, result)
    result.ok = true
  } catch (e) {
    console.warn('Token card sync failed', e)
  }
  return result
}

async function run(
  db: Database.Database,
  client: YugipediaClient,
  now: Date,
  result: TokenSyncResult
): Promise<void> {
  const listed = await client.listCategoryPages(CATEGORY)
  // An empty listing would otherwise look like "every token vanished".
  if (listed.length === 0) throw new Error('Yugipedia listed no tokens')
  const titles = listed.map((p) => p.title)
  const texts = await client.fetchPages([...titles, GENERIC_GALLERY])
  const pages = listed
    .flatMap((p) => {
      const text = texts.get(p.title)
      const parsed = text === undefined ? null : parseTokenPage(text)
      return parsed?.printed ? [{ ...p, parsed }] : []
    })
    .sort((a, b) => Number(a.title === GENERIC_TOKEN) - Number(b.title === GENERIC_TOKEN))

  const known = new Map<string, number>()
  for (const c of db
    .prepare("SELECT id, name FROM cards WHERE game = 'ygo' ORDER BY id DESC")
    .all() as { id: number; name: string }[]) {
    if (!isTokenId(c.id)) known.set(normalizeName(c.name), c.id)
  }
  const fresh = pages.filter((p) => !known.has(normalizeName(p.title)))
  const files = [...new Set(fresh.flatMap((p) => (p.parsed.image ? [p.parsed.image] : [])))]
  const filePages = await client.filePageIds(files)
  const scans = parseGalleryCodes(texts.get(GENERIC_GALLERY) ?? '')
  const iso = now.toISOString()

  // Reuses YGOPRODeck's name for a set it lists under that code.
  const setNames = new Map(
    (
      db
        .prepare(
          "SELECT set_code, MIN(set_name) AS name FROM sets WHERE game = 'ygo' AND language = 'en' AND set_code <> '' GROUP BY set_code"
        )
        .all() as { set_code: string; name: string }[]
    ).map((r) => [r.set_code, r.name])
  )
  /** The cards holding each English code, so no two cards end up under one. */
  const holders = new Map<string, Set<number>>()
  const hold = (code: string, cardId: number): void => {
    const key = code.toUpperCase()
    holders.set(key, (holders.get(key) ?? new Set()).add(cardId))
  }
  for (const r of db
    .prepare(
      `SELECT card_id, set_code FROM card_printings
       WHERE game = 'ygo' AND language = 'en' AND set_code <> ''`
    )
    .all() as { card_id: number; set_code: string }[]) {
    hold(r.set_code, r.card_id)
  }

  const upsertCard = db.prepare(`
    INSERT INTO cards (id, name, type, frame_type, race, attribute, level, linkval, atk, def, archetype,
      "desc", tcgplayer_price, updated_at)
    VALUES (@id, @name, 'Token', 'token', @race, @attribute, @level, NULL, @atk, @def, @archetype,
      @text, NULL, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, race = excluded.race,
      attribute = excluded.attribute, level = excluded.level, atk = excluded.atk, def = excluded.def,
      archetype = excluded.archetype, "desc" = excluded."desc", updated_at = excluded.updated_at
    WHERE cards.name IS NOT excluded.name OR cards.race IS NOT excluded.race
      OR cards."desc" IS NOT excluded."desc" OR cards.attribute IS NOT excluded.attribute OR cards.level IS NOT excluded.level
      OR cards.atk IS NOT excluded.atk OR cards.def IS NOT excluded.def
      OR cards.archetype IS NOT excluded.archetype`)
  const upsertImage = db.prepare(`
    INSERT INTO card_images (image_id, card_id, sort_order, missing_from_api) VALUES (?, ?, 0, 0)
    ON CONFLICT(image_id) DO UPDATE SET card_id = excluded.card_id, missing_from_api = 0`)
  const oldImages = db.prepare(
    'SELECT image_id FROM card_images WHERE card_id = ? AND image_id <> ?'
  )
  const dropImage = db.prepare(
    `DELETE FROM card_images WHERE image_id = ? AND NOT EXISTS
       (SELECT 1 FROM collection_entries WHERE image_id = card_images.image_id)`
  )
  const flagImage = db.prepare('UPDATE card_images SET missing_from_api = 1 WHERE image_id = ?')
  const upsertPrinting = db.prepare(`
    INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
      missing_from_api, language, variant)
    VALUES (@cardId, @setName, @code, @rarity, '', NULL, 0, 'en', @variant)
    ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en' DO UPDATE SET
      set_name = excluded.set_name, missing_from_api = 0, variant = excluded.variant
    RETURNING id`)
  const ownPrintings = db.prepare(
    "SELECT id FROM card_printings WHERE card_id = ? AND language = 'en' AND tcg_product_id IS NULL"
  )

  /** Writes the page's printings no other card holds; a listed card keeps the codes it has. */
  const savePrintings = (cardId: number, page: TokenPage, own: boolean): Set<number> => {
    const seen = new Set<number>()
    const taken = new Set<string>()
    for (const p of page.printings) {
      const key = `${p.code}\u0000${p.rarity}`
      const holding = holders.get(p.code.toUpperCase())
      if (taken.has(key)) continue
      if (holding && (own ? [...holding].some((c) => c !== cardId) : true)) continue
      taken.add(key)
      const scan = own ? scans.get(p.code) : undefined
      const prefix = setPrefix(p.code)
      const row = upsertPrinting.get({
        cardId,
        setName: setNames.get(prefix) ?? p.setName,
        code: p.code,
        rarity: p.rarity,
        // Only the plain "Token" page has one scan per art, which this tells apart.
        variant: scan ? fileArtName(scan) : null
      }) as { id: number }
      seen.add(row.id)
      result.printings++
    }
    for (const p of page.printings)
      if (taken.has(`${p.code}\u0000${p.rarity}`)) hold(p.code, cardId)
    return seen
  }

  const printingCount = db.prepare("SELECT count(*) FROM card_printings WHERE game = 'ygo'").pluck()
  const before = printingCount.get()
  db.transaction(() => {
    for (const { pageId, title, parsed } of pages) {
      const listedId = known.get(normalizeName(title))
      if (listedId !== undefined) {
        savePrintings(listedId, parsed, false)
        continue
      }
      const file = parsed.image ? filePages.get(parsed.image) : undefined
      if (file === undefined) {
        result.skipped.push(title)
        continue
      }
      result.cards++
      const id = tokenId(pageId)
      const imageId = tokenId(file)
      const isNew = !db.prepare('SELECT 1 FROM cards WHERE id = ?').get(id)
      upsertCard.run({
        id,
        name: title,
        race: parsed.race ?? 'Token',
        attribute: parsed.attribute,
        level: parsed.level,
        atk: parsed.atk,
        def: parsed.def,
        archetype: parsed.archetype,
        text: parsed.text,
        updatedAt: iso
      })
      if (isNew) result.addedCards++
      upsertImage.run(imageId, id)
      for (const { image_id: old } of oldImages.all(id, imageId) as { image_id: number }[]) {
        dropImage.run(old)
        flagImage.run(old)
      }
      const seen = savePrintings(id, parsed, true)
      const stale = (ownPrintings.all(id) as { id: number }[])
        .map((r) => r.id)
        .filter((r) => !seen.has(r))
      deleteOrFlag(db, stale)
    }
    if (result.addedCards > 0) {
      db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
      // Their non-English printings are in set lists already read: have them read again.
      deleteMeta(db, 'intl_sets_synced_at')
    }
    setMeta(db, 'token_cards_synced_at', iso)
  })()
  result.changed = result.addedCards > 0 || printingCount.get() !== before
  if (result.skipped.length > 0) console.warn(`Tokens with no scan: ${result.skipped.join(', ')}`)
  console.info(
    `Yugipedia: ${result.cards} token cards, ${result.addedCards} new, ${result.printings} English printings`
  )
}
