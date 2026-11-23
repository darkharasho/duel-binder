import { sortEntries } from '../sort'
import type { ParsedLine, ParsedList } from '../lists'
import type { DeckCard, DeckEntry } from '../types'
import { pkmKind } from './keys'

const SET_LINE = /^(\d+)\s+(.+?)\s+([A-Z][A-Z0-9-]{1,7})\s+([A-Z]*\d+[a-z]?)$/
const NAME_LINE = /^(\d+)\s+(.+)$/
const HEADER = /^(?:Pok[eé]mon|Trainer|Energy|Total Cards)\s*:\s*\d+$/i

const TYPES: Record<string, string> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal'
}

/** `Basic {R} Energy` and `Basic Fire Energy` are both `Fire Energy`; anything else is unchanged. */
function energyName(name: string): string {
  const sym = /^Basic\s+\{([GRWLPFDM])\}\s+Energy$/i.exec(name)
  if (sym) return `${TYPES[sym[1].toUpperCase()]} Energy`
  const word = /^Basic\s+(\w+)\s+Energy$/i.exec(name)
  if (word) return `${word[1]} Energy`
  return name
}

const isBasicName = (name: string): boolean => /^Basic\s/i.test(name) || isBasicEnergy(name)
const isBasicEnergy = (name: string): boolean => /^\w+ Energy$/.test(name) && !/^Basic /i.test(name)

export function parsePtcgl(text: string): ParsedList {
  const out: ParsedList = { lines: [], skipped: [], sectioned: false }
  text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .forEach((rawLine, i) => {
      const s = rawLine.replace(/[\u00A0\u2007\u202F]/g, ' ').trim()
      if (!s || HEADER.test(s)) return
      let line: ParsedLine | null = null
      // "Basic Fire Energy Energy 2": the set column reads "Energy", which the set pattern can't.
      const bare = /^(\d+)\s+(.+?)\s+Energy\s+\d+$/.exec(s)
      const m = bare && isBasicName(bare[2]) ? null : SET_LINE.exec(s)
      if (m) {
        const name = energyName(m[2])
        const basic = name !== m[2] || isBasicEnergy(name)
        const dropSet = basic && (m[3] === 'Energy' || m[3] === 'SVE')
        line = {
          line: i + 1,
          raw: rawLine,
          section: 'main',
          qty: Number(m[1]),
          ref: dropSet ? { name } : { set: m[3], number: m[4], name }
        }
      } else {
        const n =
          bare && isBasicName(bare[2]) ? ([s, bare[1], bare[2]] as const) : NAME_LINE.exec(s)
        if (n) {
          line = {
            line: i + 1,
            raw: rawLine,
            section: 'main',
            qty: Number(n[1]),
            ref: { name: energyName(n[2].trim()) }
          }
        }
      }
      if (!line || line.qty === 0) out.skipped.push({ line: i + 1, raw: rawLine })
      else out.lines.push(line)
    })
  return out
}

const KIND_LABEL = { P: 'Pokémon', T: 'Trainer', E: 'Energy' } as const

/** "PAL 001/193" becomes "PAL 1": the set, then the number without zeros or the set total. */
function exportCode(code: string | null): string | null {
  if (!code) return null
  const [set, rest] = code.split(/\s+/, 2)
  if (!set || !rest) return null
  const num = rest.split('/')[0].replace(/^([A-Za-z]*)0+(?=\d)/, '$1')
  return `${set} ${num}`
}

export function toPtcgl(entries: DeckEntry[], cards: Record<number, DeckCard>): string {
  const merged = new Map<number, DeckEntry>()
  for (const e of entries) {
    const have = merged.get(e.card)
    if (have) have.qty += e.qty
    else merged.set(e.card, { section: e.section, card: e.card, qty: e.qty })
  }
  const groups: Record<'P' | 'T' | 'E', string[]> = { P: [], T: [], E: [] }
  const counts = { P: 0, T: 0, E: 0 }
  for (const e of sortEntries('pkm', [...merged.values()], cards)) {
    const card = cards[e.card]
    const kind = card ? pkmKind(card.type) : null
    if (!card || !kind) continue
    const code = exportCode(card.code)
    groups[kind].push(`${e.qty} ${card.name}${code ? ` ${code}` : ''}`)
    counts[kind] += e.qty
  }
  const blocks: string[] = []
  for (const k of ['P', 'T', 'E'] as const)
    if (groups[k].length) blocks.push([`${KIND_LABEL[k]}: ${counts[k]}`, ...groups[k]].join('\n'))
  blocks.push(`Total Cards: ${counts.P + counts.T + counts.E}`)
  return blocks.join('\n\n')
}
