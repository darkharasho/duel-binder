import type { GameId } from '../games'
import { formatOf } from './formats'
import type { DeckEntry, DeckFields, DeckSection } from './types'

export const MAX_DECKS_PER_GAME = 200
export const MAX_DECK_ENTRIES = 300
export const MAX_DECK_NAME = 80
export const MAX_DECK_NOTES = 2000
export const MAX_ENTRY_QTY = 99
const MAX_PRINTING = 64

/** Thrown for a bad field; callers map it to their own error type. */
export class DeckFieldError extends Error {}

function text(v: unknown, what: string, max: number, required = false): string {
  if (typeof v !== 'string') throw new DeckFieldError(`${what} must be text`)
  const t = v.trim()
  if (required && !t) throw new DeckFieldError(`${what} is required`)
  if (t.length > max) throw new DeckFieldError(`${what} must be at most ${max} characters`)
  return t
}

function checkEntries(v: unknown, sections: readonly string[]): DeckEntry[] {
  if (!Array.isArray(v)) throw new DeckFieldError('Cards must be a list')
  const merged = new Map<string, DeckEntry>()
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) throw new DeckFieldError('Bad card entry')
    const e = raw as Record<string, unknown>
    if (typeof e.section !== 'string' || !sections.includes(e.section))
      throw new DeckFieldError('Card is in a section this format does not have')
    if (typeof e.card !== 'number' || !Number.isInteger(e.card) || e.card < 0)
      throw new DeckFieldError('Card must be a card id')
    if (typeof e.qty !== 'number' || !Number.isInteger(e.qty) || e.qty < 1 || e.qty > MAX_ENTRY_QTY)
      throw new DeckFieldError(`Quantity must be a whole number from 1 to ${MAX_ENTRY_QTY}`)
    let printing: string | undefined
    // An empty pin is no pin, so it merges with the entry's unpinned copies.
    if (e.printing !== undefined && e.printing !== null && e.printing !== '') {
      if (typeof e.printing !== 'string' || e.printing.length > MAX_PRINTING)
        throw new DeckFieldError(`Printing must be text of at most ${MAX_PRINTING} characters`)
      printing = e.printing
    }
    const key = JSON.stringify([e.section, e.card, printing ?? null])
    const hit = merged.get(key)
    if (hit) hit.qty += e.qty
    else
      merged.set(key, {
        section: e.section as DeckSection,
        card: e.card,
        ...(printing !== undefined ? { printing } : {}),
        qty: e.qty
      })
  }
  const cards = [...merged.values()]
  if (cards.length > MAX_DECK_ENTRIES)
    throw new DeckFieldError(`A deck holds at most ${MAX_DECK_ENTRIES} different cards`)
  for (const c of cards)
    if (c.qty > MAX_ENTRY_QTY)
      throw new DeckFieldError(`Quantity must be a whole number from 1 to ${MAX_ENTRY_QTY}`)
  return cards
}

/** Checks and tidies a deck's editable fields (trimmed name, merged entries); throws DeckFieldError. */
export function checkDeckFields(o: Record<string, unknown>, game: GameId): DeckFields {
  const format = typeof o.format === 'string' ? formatOf(game, o.format) : null
  if (!format) throw new DeckFieldError('Unknown format')
  const cover = o.cover ?? null
  if (cover !== null && (typeof cover !== 'number' || !Number.isInteger(cover) || cover < 0))
    throw new DeckFieldError('Cover must be a card id or empty')
  if (typeof o.private !== 'boolean') throw new DeckFieldError('Private must be true or false')
  return {
    format: format.id,
    name: text(o.name, 'Name', MAX_DECK_NAME, true),
    notes: text(o.notes ?? '', 'Notes', MAX_DECK_NOTES),
    cover,
    private: o.private,
    cards: checkEntries(
      o.cards,
      format.sections.map((s) => s.id)
    )
  }
}
