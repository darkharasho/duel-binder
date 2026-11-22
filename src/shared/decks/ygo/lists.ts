import { sortEntries } from '../sort'
import type { DeckCard, DeckEntry, DeckSection } from '../types'

export type DeckLineRef = { passcode: number } | { setCode: string } | { name: string }
export interface ParsedLine {
  line: number
  raw: string
  section: DeckSection
  qty: number
  ref: DeckLineRef
}
/**
 * skipped = non-empty, non-comment lines it couldn't read. sectioned = the list said which section
 * each card is in (.ydk, ydke://, or a text list with headers); a text list without headers puts
 * everything in Main, for the importer to place by card.
 */
export interface ParsedList {
  lines: ParsedLine[]
  skipped: { line: number; raw: string }[]
  sectioned: boolean
}

const SECTIONS: DeckSection[] = ['main', 'extra', 'side']
const SECTION_LABEL: Record<DeckSection, string> = {
  main: 'Main Deck',
  extra: 'Extra Deck',
  side: 'Side Deck'
}

function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
}

export function detectYgoList(text: string): 'ydk' | 'ydke' | 'text' {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (/^ydke:\/\//i.test(t)) return 'ydke'
  for (const l of splitLines(text)) {
    const s = l.trim().toLowerCase()
    if (s === '#main' || s === '#extra' || s === '!side') return 'ydk'
  }
  return 'text'
}

/** Adds copies of one card in one section, folding repeats into a single line. */
class Collector {
  readonly out: ParsedList = { lines: [], skipped: [], sectioned: true }
  private seen = new Map<string, ParsedLine>()
  add(line: number, raw: string, section: DeckSection, passcode: number): void {
    const k = `${section}:${passcode}`
    const have = this.seen.get(k)
    if (have) {
      have.qty += 1
      return
    }
    const l: ParsedLine = { line, raw, section, qty: 1, ref: { passcode } }
    this.seen.set(k, l)
    this.out.lines.push(l)
  }
}

function parseYdk(text: string): ParsedList {
  const c = new Collector()
  let section: DeckSection = 'main'
  splitLines(text).forEach((rawLine, i) => {
    const s = rawLine.trim()
    if (!s) return
    const low = s.toLowerCase()
    if (low === '#main') section = 'main'
    else if (low === '#extra') section = 'extra'
    else if (low === '!side') section = 'side'
    else if (s.startsWith('#')) return
    else if (/^\d+$/.test(s)) c.add(i + 1, rawLine, section, Number(s))
    else c.out.skipped.push({ line: i + 1, raw: rawLine })
  })
  return c.out
}

function decodeSection(b64: string): number[] | null {
  if (!b64) return []
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return null
  }
  if (bin.length % 4 !== 0) return null
  const view = new DataView(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i))
  const ids: number[] = []
  for (let i = 0; i < bin.length; i += 4) ids.push(view.getUint32(i, true))
  return ids
}

function parseYdke(text: string): ParsedList {
  const c = new Collector()
  const body = text.trim().replace(/^ydke:\/\//i, '')
  const parts = body.split('!')
  SECTIONS.forEach((section, i) => {
    const raw = parts[i] ?? ''
    const ids = decodeSection(raw)
    if (!ids) c.out.skipped.push({ line: 1, raw })
    else for (const id of ids) c.add(1, raw, section, id)
  })
  return c.out
}

const HEADER =
  /^(?:(main|extra|side)(?:\s+deck)?|(sideboard))\s*(?:\(\s*\d+\s*\)|\d+)?\s*:?\s*(?:\(\s*\d+\s*\))?$/i
const TRAILING_BRACKET = /\s*(?:\([^()]*\)|\[[^[\]]*\])\s*$/

function normalize(s: string): string {
  return s
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
}

function stripBrackets(s: string): string {
  let cur = s
  for (;;) {
    const next = cur.replace(TRAILING_BRACKET, '')
    if (next === cur || !next.trim()) return cur.trim()
    cur = next
  }
}

/** A bare 5–10 digit line in a text list: a passcode, one copy (a .ydk without its headers). */
const BARE_PASSCODE = /^\d{5,10}$/

function parseText(text: string): ParsedList {
  const out: ParsedList = { lines: [], skipped: [], sectioned: false }
  const bare = new Map<string, ParsedLine>()
  let section: DeckSection = 'main'
  splitLines(text).forEach((rawLine, i) => {
    let s = normalize(rawLine).trim()
    if (!s) return
    s = s.replace(/^(?:[-*•]\s*)+/, '').trim()
    if (!s) {
      out.skipped.push({ line: i + 1, raw: rawLine })
      return
    }
    const h = HEADER.exec(s)
    if (h) {
      section = (h[1] ? h[1].toLowerCase() : 'side') as DeckSection
      out.sectioned = true
      return
    }
    if (BARE_PASSCODE.test(s)) {
      const k = `${section}:${Number(s)}`
      const have = bare.get(k)
      if (have) have.qty += 1
      else {
        const l: ParsedLine = {
          line: i + 1,
          raw: rawLine,
          section,
          qty: 1,
          ref: { passcode: Number(s) }
        }
        bare.set(k, l)
        out.lines.push(l)
      }
      return
    }
    let qty = 1
    s = stripBrackets(s)
    const suffix = /^(.+?)\s+[x×]\s*(\d+)$/i.exec(s)
    if (suffix) {
      s = stripBrackets(suffix[1])
      qty = Number(suffix[2])
    } else {
      const prefix = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(s)
      if (prefix) {
        qty = Number(prefix[1])
        s = prefix[2].trim()
      }
    }
    if (qty === 0 || !/[\p{L}\p{N}]/u.test(s)) {
      out.skipped.push({ line: i + 1, raw: rawLine })
      return
    }
    const id = /^#(\d+)$/.exec(s)
    out.lines.push({
      line: i + 1,
      raw: rawLine,
      section,
      qty,
      ref: id ? { passcode: Number(id[1]) } : { name: s }
    })
  })
  return out
}

export function parseYgoList(text: string): ParsedList {
  const kind = detectYgoList(text)
  if (kind === 'ydk') return parseYdk(text)
  if (kind === 'ydke') return parseYdke(text)
  return parseText(text)
}

function passcodes(entries: DeckEntry[], section: DeckSection): number[] {
  const ids: number[] = []
  for (const e of entries)
    if (e.section === section) for (let i = 0; i < e.qty; i++) ids.push(e.card)
  return ids
}

export function toYdk(entries: DeckEntry[]): string {
  const block = (s: DeckSection): string =>
    passcodes(entries, s)
      .map((id) => `${id}\n`)
      .join('')
  return `#created by Duel Binder\n#main\n${block('main')}#extra\n${block('extra')}!side\n${block('side')}`
}

export function toYdke(entries: DeckEntry[]): string {
  const enc = (ids: number[]): string => {
    const view = new DataView(new ArrayBuffer(ids.length * 4))
    ids.forEach((id, i) => view.setUint32(i * 4, id, true))
    let bin = ''
    for (let i = 0; i < view.byteLength; i++) bin += String.fromCharCode(view.getUint8(i))
    return btoa(bin)
  }
  return `ydke://${SECTIONS.map((s) => enc(passcodes(entries, s))).join('!')}!`
}

export function toYgoText(entries: DeckEntry[], cards: Record<number, DeckCard>): string {
  const blocks: string[] = []
  for (const section of SECTIONS) {
    const merged = new Map<number, DeckEntry>()
    for (const e of entries) {
      if (e.section !== section) continue
      const have = merged.get(e.card)
      if (have) have.qty += e.qty
      else merged.set(e.card, { section, card: e.card, qty: e.qty })
    }
    if (!merged.size) continue
    const sorted = sortEntries('ygo', [...merged.values()], cards)
    const total = sorted.reduce((n, e) => n + e.qty, 0)
    const rows = sorted.map((e) => `${e.qty} ${cards[e.card]?.name ?? `#${e.card}`}`)
    blocks.push([`${SECTION_LABEL[section]} (${total})`, ...rows].join('\n'))
  }
  return blocks.join('\n\n')
}
