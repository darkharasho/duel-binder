import Database from 'better-sqlite3'
import type { CachedLang, TdCard } from './types'

export const CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface CardCache {
  get(lang: CachedLang, id: string): { card: TdCard; fetchedAt: number } | null
  put(lang: CachedLang, id: string, card: TdCard, fetchedAt: number): void
  close(): void
}

export function openCardCache(path: string): CardCache {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS td_cards (
    lang TEXT NOT NULL, id TEXT NOT NULL, fetched_at INTEGER NOT NULL, json TEXT NOT NULL,
    PRIMARY KEY (lang, id)
  )`)
  const sel = db.prepare('SELECT fetched_at, json FROM td_cards WHERE lang = ? AND id = ?')
  const ins = db.prepare('INSERT OR REPLACE INTO td_cards (lang, id, fetched_at, json) VALUES (?, ?, ?, ?)')
  return {
    get(lang, id) {
      const r = sel.get(lang, id) as { fetched_at: number; json: string } | undefined
      return r ? { card: JSON.parse(r.json) as TdCard, fetchedAt: r.fetched_at } : null
    },
    put(lang, id, card, fetchedAt) { ins.run(lang, id, fetchedAt, JSON.stringify(card)) },
    close() { db.close() }
  }
}

/** True when a cached card is still good: fresh (<= 7 days), has an image and a TCGplayer id somewhere. */
export function cardIsUsable(card: TdCard, fetchedAt: number, now: number): boolean {
  if (now - fetchedAt > CARD_MAX_AGE_MS) return false
  if (!card.image) return false
  return !!card.thirdParty?.tcgplayer || !!card.variants_detailed?.some((v) => v.thirdParty?.tcgplayer)
}

/**
 * True when a Traditional Chinese card is still good. Fresh is enough: they have no TCGplayer row,
 * and most have no image, so cardIsUsable would fetch every one of them again every night.
 */
export const traditionalCardIsUsable = (fetchedAt: number, now: number): boolean =>
  now - fetchedAt <= CARD_MAX_AGE_MS

/** The share of an extra week a card's id gives it: stable, and even across a set's numbers. */
function ageJitter(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32
}

/**
 * True when a French, German, Italian or Spanish card is still good. Fresh is enough, for the same
 * reason as a Traditional Chinese card. A fill reads thousands of them at once, so each card lasts
 * one to two weeks by its id, and the refetch spreads over a week's nights instead of one.
 */
export const europeanCardIsUsable = (id: string, fetchedAt: number, now: number): boolean =>
  now - fetchedAt <= CARD_MAX_AGE_MS * (1 + ageJitter(id))
