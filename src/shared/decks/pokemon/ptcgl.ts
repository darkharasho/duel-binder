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

const BASIC_ENERGY = /^(?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/
const isBasicEnergy = (name: string): boolean => BASIC_ENERGY.test(name)

export function parsePtcgl(text: string): ParsedList {
  const out: ParsedList = { lines: [], skipped: [], sectioned: false }
  text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .forEach((rawLine, i) => {
      const s = rawLine.replace(/[\u00A0\u2007\u202F]/g, ' ').trim()
      if (!s || HEADER.test(s)) return
      let line: ParsedLine | null = null
      // "Basic Fire Energy Energy 2": the set column reads "Energy", which the set pattern can't
      // match; the literal "Energy" is no set, so only the name is kept.
      const bare = /^(\d+)\s+(.+?)\s+Energy\s+\d+$/.exec(s)
      const bareBasic = bare && isBasicEnergy(energyName(bare[2]))
      const m = bareBasic ? null : SET_LINE.exec(s)
      if (m) {
        line = {
          line: i + 1,
          raw: rawLine,
          section: 'main',
          qty: Number(m[1]),
          ref: { set: m[3], number: m[4], name: energyName(m[2]) }
        }
      } else {
        const n = bareBasic ? ([s, bare[1], bare[2]] as const) : NAME_LINE.exec(s)
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
    if (!card) {
      groups.P.push(`${e.qty} #${e.card}`)
      counts.P += e.qty
      continue
    }
    const kind = pkmKind(card.type)
    if (!kind) continue
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
