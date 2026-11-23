import { sortEntries } from '../sort'
import { decodeOplay, OplayError, type OplayDeck } from './oplay'
import type { ParsedLine, ParsedList } from '../lists'
import type { DeckCard, DeckEntry } from '../types'

/** A One Piece card number: OP13-086, ST01-001, EB01-012, P-001, PRB01-001_p1. */
export const OP_CODE = /[A-Za-z]{1,5}\d{0,3}-\d{1,4}[A-Za-z0-9_]*/

const SEP = '[xX×*·]'
const CODE = `(${OP_CODE.source})`
/** "4xOP13-086", "4x OP13-086 Sabo", "4 × OP13-086 - Sabo" */
const QTY_FIRST = new RegExp(`^(\\d+)\\s*${SEP}\\s*${CODE}(?:\\s+(.*))?$`)
/** "OP13-086 x4", "OP13-086 x4 Sabo" */
const QTY_LAST = new RegExp(`^${CODE}\\s*${SEP}\\s*(\\d+)(?:\\s+(.*))?$`)
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
      else if (b) [qty, code, name] = [Number(b[2]), b[1], nameOf(b[3])]
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

const SAVED_LINK = /[?&]deck=\d+/
const SHARE_LINK = /[?&]d=([A-Za-z0-9_-]+)/

/** A decoded OPlay deck as list lines: the Leader in 'leader', the rest in 'main'. */
function linesOf(deck: OplayDeck): ParsedList {
  const out: ParsedList = { lines: [], skipped: [], sectioned: true }
  const add = (section: 'leader' | 'main', code: string, qty: number): void => {
    out.lines.push({
      line: 1,
      raw: `${qty}x${code}`,
      section,
      qty,
      ref: { opNumber: code, name: '' }
    })
  }
  if (deck.leader) add('leader', deck.leader, 1)
  for (const e of deck.entries) add('main', e.code, e.qty)
  return out
}

/**
 * Any One Piece list: an OPlay share link, an OPlay deck code, else a text list. A link to a deck
 * saved on OPlay's server can't be read here, so it throws an OplayError that says what to copy instead.
 */
export function parseOpList(text: string): ParsedList {
  const t = text.trim()
  const token = t && !/\s/.test(t) ? t : null
  if (token && SAVED_LINK.test(token))
    throw new OplayError(
      'That link points to a deck saved on OPlay. Open it there and copy its deck code or share link instead.'
    )
  const link = token ? SHARE_LINK.exec(token) : null
  if (link) return linesOf(decodeOplay(link[1]))
  if (token && /^[12]/.test(token)) {
    try {
      return linesOf(decodeOplay(token))
    } catch (e) {
      if (!(e instanceof OplayError)) throw e
    }
  }
  return parseOpText(text)
}

/**
 * The Leader, then the Deck in sort order; a line per card number (twins in other languages share
 * it), else per card, by name.
 */
export function toOpText(entries: DeckEntry[], cards: Record<number, DeckCard>): string {
  const merged = new Map<string, DeckEntry>()
  for (const e of entries) {
    const num = cards[e.card]?.opNumber
    const key = `${e.section === 'leader' ? 'leader' : 'deck'} ${num ? `n:${num}` : `id:${e.card}`}`
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
