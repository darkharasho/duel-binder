import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../db/meta'
import { parseCardPassword } from '../yugipedia/parse'

/** How long a name whose card page gave no password waits before it is asked again. */
export const CARD_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000
/** Characters MediaWiki titles can't hold; a name with one is never asked for. */
const BAD_TITLE = /[|{}[\]<>#]/

/** What earlier runs learned, by normalized name: the page's password, or when it gave none. */
interface Stored {
  found: Record<string, number>
  missed: Record<string, string>
}

/** Fetches pages by title; titles in a failed request are in `failed`, not `pages`. */
export type PageFetch = (
  titles: string[]
) => Promise<{ pages: Map<string, string>; failed: Set<string> }>

export interface CardPasswords {
  /**
   * Looks up, on their Yugipedia card pages, the names (normalized name -> page title) not known
   * from an earlier run, and the misses older than CARD_MISS_RETRY_MS, then saves what it learned.
   */
  lookUp(names: Map<string, string>): Promise<void>
  /** The card a looked-up name's password is (as a card id or an artwork's), if it is here. */
  cardFor(key: string): number | undefined
}

/**
 * Set-list rows whose names YGOPRODeck spells otherwise ("Odd-Eyes Pendulum Dragon, Four Heavenly
 * Dragons" for its "...of the Four Heavenly Dragons") are matched by the password on their card
 * page, which is YGOPRODeck's card id. Passwords are kept in meta for good (one never changes; a
 * card YGOPRODeck doesn't have yet is matched once it does); misses are asked again after a while.
 */
export function cardPasswords(db: Database.Database, fetch: PageFetch, now: Date): CardPasswords {
  const cards = new Set(
    db.prepare("SELECT id FROM cards WHERE game = 'ygo'").pluck().all() as number[]
  )
  const artworks = new Map(
    (
      db.prepare("SELECT image_id, card_id FROM card_images WHERE game = 'ygo'").all() as {
        image_id: number
        card_id: number
      }[]
    ).map((r) => [r.image_id, r.card_id])
  )
  const stored = load(getMeta(db, 'yugipedia_card_passwords'))

  return {
    async lookUp(names) {
      const due = [...names].filter(([key, title]) => {
        if (Object.hasOwn(stored.found, key) || title === '' || BAD_TITLE.test(title)) return false
        const missed = Date.parse(stored.missed[key] ?? '')
        return Number.isNaN(missed) || now.getTime() - missed >= CARD_MISS_RETRY_MS
      })
      if (due.length === 0) return
      const { pages, failed } = await fetch([...new Set(due.map(([, title]) => title))])
      for (const [key, title] of due) {
        if (failed.has(title)) continue // asked again next run
        const text = pages.get(title)
        const password = text === undefined ? null : parseCardPassword(text)
        if (password === null) {
          stored.missed[key] = now.toISOString()
        } else {
          stored.found[key] = password
          delete stored.missed[key]
        }
      }
      setMeta(db, 'yugipedia_card_passwords', JSON.stringify(stored))
    },

    cardFor(key) {
      const password = Object.hasOwn(stored.found, key) ? stored.found[key] : undefined
      if (password === undefined) return undefined
      return cards.has(password) ? password : artworks.get(password)
    }
  }
}

function load(raw: string | null): Stored {
  try {
    const v = JSON.parse(raw ?? '') as Partial<Stored>
    if (v && typeof v.found === 'object' && typeof v.missed === 'object')
      return { found: { ...v.found }, missed: { ...v.missed } }
  } catch {
    // none stored yet, or unreadable: start over
  }
  return { found: {}, missed: {} }
}
