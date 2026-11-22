import { MAX_ENTRY_QTY } from '@shared/decks/fields'
import type { ParsedLine, ParsedList } from '@shared/decks/ygo/lists'
import type { DeckCard, DeckEntry, DeckSection } from '@shared/decks/types'
import type { Api } from '@shared/ipc'

export type Resolution = Awaited<ReturnType<Api['decks']['resolve']>>[number]
export type Option = { card: number; name: string; imageId: number | null }

/** One line of an import, as the owner sees it. `key` is stable for the preview's life. */
export interface ImportItem {
  key: string
  text: string
  qty: number
  section: DeckSection
}
export interface ImportPreview {
  matched: (ImportItem & { card: number })[]
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

/** Sorts the parsed lines into the three groups by what `resolve` answered for each. */
export function buildPreview(
  parsed: ParsedList,
  resolutions: Resolution[],
  kind: 'ydk' | 'ydke' | 'text'
): ImportPreview {
  const out: ImportPreview = { matched: [], ambiguous: [], notFound: [] }
  parsed.lines.forEach((l, i) => {
    const r = resolutions[i]
    const item: ImportItem = {
      key: `l${i}`,
      text: textOf(l, kind, r?.status === 'matched' ? r.name : undefined),
      qty: l.qty,
      section: l.section
    }
    if (r?.status === 'matched') out.matched.push({ ...item, card: r.card })
    else if (r?.status === 'ambiguous') out.ambiguous.push({ ...item, options: r.options })
    else out.notFound.push(item)
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
  const add = (section: DeckSection, card: number, qty: number): void => {
    const have = out.find((e) => e.section === section && e.card === card)
    if (have) have.qty = Math.min(MAX_ENTRY_QTY, have.qty + qty)
    else out.push({ section, card, qty: Math.min(MAX_ENTRY_QTY, qty) })
  }
  for (const m of p.matched) add(m.section, m.card, m.qty)
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
