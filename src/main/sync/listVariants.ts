import type Database from 'better-sqlite3'

/**
 * The art variant Yugipedia's English set lists print a rarity in when they print it in nothing
 * else: MAMS-EN001–018's Starlight and Grand Master Rares come only overframe ("(extended art)"
 * rows), while YGOPRODeck and TCGplayer name them plainly. Kept in its own table, filled by the
 * set-list sync (intl.ts), because the TCGplayer sync (saveTcgVariants) sets each printing's
 * variant from TCGplayer's product names every run and would otherwise clear it.
 */
export function ensureListVariants(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS list_variants (card_id INTEGER NOT NULL, set_code TEXT NOT NULL,
    set_rarity TEXT NOT NULL, variant TEXT NOT NULL, PRIMARY KEY (card_id, set_code, set_rarity))`)
}

const key = (cardId: number, code: string, rarity: string): string =>
  `${cardId}|${code.toUpperCase()}|${rarity}`

/** Each listed variant by `card|CODE|rarity`. */
export function listVariants(db: Database.Database): Map<string, string> {
  ensureListVariants(db)
  const rows = db
    .prepare('SELECT card_id, set_code, set_rarity, variant FROM list_variants')
    .all() as { card_id: number; set_code: string; set_rarity: string; variant: string }[]
  return new Map(rows.map((r) => [key(r.card_id, r.set_code, r.set_rarity), r.variant]))
}

export const listVariantKey = key
