import { MAX_ENTRY_QTY } from '@shared/decks/fields'
import { defaultSection } from '@shared/decks/formats'
import type { GameId } from '@shared/games'
import type { ParsedLine, ParsedList } from '@shared/decks/ygo/lists'
import type { DeckCard, DeckEntry, DeckSection } from '@shared/decks/types'
import type { Api } from '@shared/ipc'

export type Resolution = Awaited<ReturnType<Api['decks']['resolve']>>[number]
export type Option = {
  card: number
  name: string
  frameType: string
  opCardType?: string | null
  imageId: number | null
}
/** A One Piece DON!! card: never part of a deck list, so an import ignores it. */
const isDon = (c: { opCardType?: string | null }): boolean => c.opCardType === 'DON!!'

/** A Magic list's Sideboard or Companion line has nowhere to go in a Commander deck. */
export const COMMANDER_NO_SIDEBOARD = 'Commander decks here have no sideboard'

/** One line of an import, as the owner sees it. `key` is stable for the preview's life. */
export interface ImportItem {
  key: string
  text: string
  qty: number
  section: DeckSection
  /** More copies than an entry holds: it can only be dropped, never cut down silently. */
  tooMany?: boolean
  /** Why a line can't go in this deck (it is shown, and can only be dropped). */
  leftOut?: string
}
export interface ImportPreview {
  /** The list named its sections; otherwise a card goes where defaultSection puts it. */
  sectioned: boolean
  matched: (ImportItem & { card: number; printing?: string })[]
  ambiguous: (ImportItem & { options: Option[] })[]
  /** Lines that matched no card, and lines the parser couldn't read. */
  notFound: ImportItem[]
}

/** What the owner decided for an ambiguous or not-found line. */
export type Pick =
  | { drop: true }
  | { drop?: false; card: number; section: DeckSection; name: string; facts?: DeckCard }

/** A matched line reads by the catalog's name; one still unknown reads as typed or by passcode. */
function textOf(l: ParsedLine, kind: 'ydk' | 'ydke' | 'text', name?: string): string {
  if (name) return `${l.qty} ${name}`
  if (kind === 'text') return l.raw.trim()
  return 'passcode' in l.ref ? `#${l.ref.passcode} (not in the catalog)` : l.raw.trim()
}

/** Where a picked or matched card goes: the list's own section, else by the card's frame. */
export function placeOf(
  game: GameId,
  sectioned: boolean,
  section: DeckSection,
  card: { frameType: string; opCardType?: string | null }
): DeckSection {
  return sectioned
    ? section
    : defaultSection(game, { frameType: card.frameType, opCardType: card.opCardType ?? null })
}

/**
 * Sorts the parsed lines into the three groups by what `resolve` answered for each. A line of more
 * copies than an entry holds is not found, as typed, so it is never cut down without a word.
 */
export function buildPreview(
  parsed: ParsedList,
  resolutions: Resolution[],
  kind: 'ydk' | 'ydke' | 'text',
  game: GameId = 'ygo',
  format?: string
): ImportPreview {
  const out: ImportPreview = {
    sectioned: parsed.sectioned,
    matched: [],
    ambiguous: [],
    notFound: []
  }
  parsed.lines.forEach((l, i) => {
    const r = resolutions[i]
    if (r?.status === 'matched' && isDon(r)) return
    const item: ImportItem = {
      key: `l${i}`,
      text: textOf(l, kind, r?.status === 'matched' ? r.name : undefined),
      qty: l.qty,
      section: l.section
    }
    if (game === 'mtg' && format === 'commander' && l.section === 'side')
      out.notFound.push({
        ...item,
        text: `${item.text} (${COMMANDER_NO_SIDEBOARD})`,
        leftOut: COMMANDER_NO_SIDEBOARD
      })
    else if (l.qty > MAX_ENTRY_QTY)
      out.notFound.push({
        ...item,
        text: `${kind === 'text' ? l.raw.trim() : item.text} (more than ${MAX_ENTRY_QTY} copies)`,
        tooMany: true
      })
    else if (r?.status === 'matched')
      out.matched.push({
        ...item,
        section: placeOf(game, parsed.sectioned, l.section, r),
        card: r.card,
        ...(r.printing ? { printing: r.printing } : {})
      })
    else if (r?.status === 'ambiguous') {
      const options = r.options.filter((o) => !isDon(o))
      if (options.length === 0) return
      if (options.length === 1)
        out.matched.push({
          ...item,
          text: textOf(l, kind, options[0].name),
          section: placeOf(game, parsed.sectioned, l.section, options[0]),
          card: options[0].card
        })
      else out.ambiguous.push({ ...item, options })
    } else out.notFound.push(item)
  })
  parsed.skipped.forEach((s, i) =>
    out.notFound.push({ key: `s${i}`, text: s.raw.trim(), qty: 1, section: 'main' })
  )
  return out
}

/** Ambiguous and not-found lines still waiting for a pick or a drop. */
export function unresolvedCount(p: ImportPreview, picks: Record<string, Pick>): number {
  return [...p.ambiguous, ...p.notFound].filter((i) => !picks[i.key]).length
}

/** The deck's entries: every matched line and every picked one, copies of one card folded. */
export function keptEntries(p: ImportPreview, picks: Record<string, Pick>): DeckEntry[] {
  const out: DeckEntry[] = []
  const add = (section: DeckSection, card: number, qty: number, printing?: string): void => {
    const have = out.find(
      (e) => e.section === section && e.card === card && e.printing === printing
    )
    if (have) have.qty = Math.min(MAX_ENTRY_QTY, have.qty + qty)
    else
      out.push({
        section,
        card,
        ...(printing ? { printing } : {}),
        qty: Math.min(MAX_ENTRY_QTY, qty)
      })
  }
  for (const m of p.matched) add(m.section, m.card, m.qty, m.printing)
  for (const i of [...p.ambiguous, ...p.notFound]) {
    const pick = picks[i.key]
    if (pick && !pick.drop) add(pick.section, pick.card, i.qty)
  }
  return out
}

/** "Snake-Eye.ydk" names a deck "Snake-Eye"; anything else gets the default. */
export function deckNameFromFile(fileName: string | null): string {
  const base = (fileName ?? '').replace(/\.[^.]*$/, '').trim()
  return base || 'Imported deck'
}
