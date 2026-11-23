import { sortEntries } from '../sort'
import type { ParsedLine, ParsedList } from '../lists'
import type { DeckCard, DeckEntry, DeckSection } from '../types'

/** "4 Lightning Bolt (2X2) 117 *F*": the set and number are Arena's, the foil mark is ignored. */
const LINE =
  /^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)\s+([A-Za-z0-9★†-]+))?(?:\s+\*[A-Za-z]\*)?$/
const HEADER = /^(deck|sideboard|commander|companion|about)\s*:?$/i
const HEADER_SECTION: Record<string, DeckSection | undefined> = {
  deck: 'main',
  sideboard: 'side',
  commander: 'commander',
  companion: 'side'
}

/** MTGO writes a split card as "Fire/Ice"; Scryfall and the catalog write "Fire // Ice". */
function faceName(name: string): string {
  if (name.includes('//')) return name.replace(/\s*\/\/\s*/g, ' // ')
  return name.replace(/\s*\/\s*/g, ' // ')
}

/** An Arena or MTGO deck list; a list with no headers puts everything in Main. */
export function parseMtgText(text: string): ParsedList {
  const out: ParsedList = { lines: [], skipped: [], sectioned: false, headed: false }
  let section: DeckSection = 'main'
  let headed = false
  let cards = 0
  text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .forEach((rawLine, i) => {
      const s = rawLine.replace(/[\u00A0\u2007\u202F]/g, ' ').trim()
      if (!s) {
        // MTGO: with no headers at all, the first blank line after the cards starts the sideboard.
        if (!headed && cards > 0 && !out.sectioned) {
          section = 'side'
          out.sectioned = true
        }
        return
      }
      if (s.startsWith('#') || s.startsWith('//')) return
      const header = HEADER.exec(s)
      if (header) {
        headed = true
        out.headed = true
        out.sectioned = true
        section = HEADER_SECTION[header[1].toLowerCase()] ?? section
        return
      }
      if (/^name\s/i.test(s)) return
      const m = LINE.exec(s)
      const qty = m ? Number(m[1]) : 0
      if (!m || qty <= 0) {
        out.skipped.push({ line: i + 1, raw: rawLine })
        return
      }
      const name = faceName(m[2].trim())
      const line: ParsedLine = {
        line: i + 1,
        raw: rawLine,
        section,
        qty,
        ref: m[3] ? { set: m[3], number: m[4], name } : { name }
      }
      out.lines.push(line)
      cards++
    })
  return out
}

/** Split and aftermath cards keep both halves in a list; every other two-name card is its front face. */
const keepsBothNames = (card: DeckCard | undefined): boolean =>
  card?.mtgLayout === 'split' || card?.mtgLayout === 'aftermath'

function nameOf(card: DeckCard | undefined, id: number, both: (full: string) => string): string {
  const full = card?.mtgName ?? card?.name
  if (!full) return `#${id}`
  return keepsBothNames(card) ? both(full) : full.split(' // ')[0]
}

/**
 * Arena's layout: Commander, a blank line, Deck, a blank line, Sideboard. A line carries the
 * pinned printing's set and number when `pins` knows it.
 */
export function toArenaText(
  entries: DeckEntry[],
  cards: Record<number, DeckCard>,
  pins: Record<string, { set: string; number: string }>
): string {
  const line = (e: DeckEntry): string => {
    const pin = e.printing ? pins[e.printing] : undefined
    const name = nameOf(cards[e.card], e.card, (full) => full)
    return `${e.qty} ${name}${pin ? ` (${pin.set}) ${pin.number}` : ''}`
  }
  const sorted = sortEntries('mtg', entries, cards)
  const block = (header: string, section: DeckSection): string[] => {
    const lines = sorted.filter((e) => e.section === section).map(line)
    return lines.length > 0 ? [header, ...lines] : []
  }
  return [block('Commander', 'commander'), block('Deck', 'main'), block('Sideboard', 'side')]
    .filter((b) => b.length > 0)
    .map((b) => b.join('\n'))
    .join('\n\n')
}

/** MTGO's layout: the main deck, a blank line, the sideboard (Commander puts its commanders there). */
export function toMtgoText(entries: DeckEntry[], cards: Record<number, DeckCard>): string {
  const merged = new Map<string, DeckEntry>()
  for (const e of entries) {
    const key = `${e.section}|${e.card}`
    const have = merged.get(key)
    if (have) have.qty += e.qty
    else merged.set(key, { section: e.section, card: e.card, qty: e.qty })
  }
  const sorted = sortEntries('mtg', [...merged.values()], cards)
  const line = (e: DeckEntry): string =>
    `${e.qty} ${nameOf(cards[e.card], e.card, (full) => full.replace(' // ', '/'))}`
  const main = sorted.filter((e) => e.section === 'main').map(line)
  const side = sorted.filter((e) => e.section === 'commander' || e.section === 'side').map(line)
  return [main, side]
    .filter((b) => b.length > 0)
    .map((b) => b.join('\n'))
    .join('\n\n')
}
