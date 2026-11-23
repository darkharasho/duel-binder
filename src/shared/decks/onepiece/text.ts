import { sortEntries } from '../sort'
import type { ParsedLine, ParsedList } from '../lists'
import type { DeckCard, DeckEntry } from '../types'

/** A One Piece card number: OP13-086, ST01-001, EB01-012, P-001, PRB01-001_p1. */
export const OP_CODE = /[A-Za-z]{1,5}\d{0,3}-\d{1,4}[A-Za-z0-9_]*/

const SEP = '[xX×*·]'
const CODE = `(${OP_CODE.source})`
/** "4xOP13-086", "4x OP13-086 Sabo", "4 × OP13-086 - Sabo" */
const QTY_FIRST = new RegExp(`^(\\d+)\\s*${SEP}\\s*${CODE}(?:\\s+(.*))?$`)
/** "OP13-086 x4" */
const QTY_LAST = new RegExp(`^${CODE}\\s*${SEP}\\s*(\\d+)$`)
/** "OP13-086", one copy, maybe with a name after it */
const BARE = new RegExp(`^${CODE}(?:\\s+(.*))?$`)
const DON = /DON!!/i

/** The trailing name, without a leading "-". */
const nameOf = (s: string | undefined): string => (s ?? '').trim().replace(/^-\s*/, '').trim()

/** A plain-text One Piece list; it never names sections, so every line goes in Main. */
export function parseOpText(text: string): ParsedList {
  const out: ParsedList = { lines: [], skipped: [], sectioned: false }
  text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .forEach((rawLine, i) => {
      const s = rawLine.replace(/[\u00A0\u2007\u202F]/g, ' ').trim()
      if (!s || s.startsWith('#') || s.startsWith('//') || DON.test(s)) return
      let qty = 0
      let code = ''
      let name = ''
      const a = QTY_FIRST.exec(s)
      const b = a ? null : QTY_LAST.exec(s)
      const c = a || b ? null : BARE.exec(s)
      if (a) [qty, code, name] = [Number(a[1]), a[2], nameOf(a[3])]
      else if (b) [qty, code] = [Number(b[2]), b[1]]
      else if (c) [qty, code, name] = [1, c[1], nameOf(c[2])]
      if (qty <= 0) {
        out.skipped.push({ line: i + 1, raw: rawLine })
        return
      }
      const line: ParsedLine = {
        line: i + 1,
        raw: rawLine,
        section: 'main',
        qty,
        ref: { opNumber: code.toUpperCase(), name }
      }
      out.lines.push(line)
    })
  return out
}

/** The Leader, then the Deck in sort order; a line per card, by number (else by name). */
export function toOpText(entries: DeckEntry[], cards: Record<number, DeckCard>): string {
  const merged = new Map<string, DeckEntry>()
  for (const e of entries) {
    const key = `${e.section === 'leader' ? 'leader' : 'deck'} ${e.card}`
    const have = merged.get(key)
    if (have) have.qty += e.qty
    else merged.set(key, { section: e.section, card: e.card, qty: e.qty })
  }
  const all = [...merged.values()]
  const leader = all.filter((e) => e.section === 'leader')
  const deck = all.filter((e) => e.section !== 'leader')
  return [...sortEntries('op', leader, cards), ...sortEntries('op', deck, cards)]
    .map((e) => {
      const card = cards[e.card]
      return `${e.qty}x${card?.opNumber ?? card?.name ?? `#${e.card}`}`
    })
    .join('\n')
}
