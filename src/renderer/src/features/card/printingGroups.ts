import type { GameId } from '@shared/games'
import { finishOf } from '@shared/games/magic'
import type { Language } from '@shared/languages'
import type { Printing } from '@shared/types'

export interface ArtKind {
  key: string
  label: string
}

const ORIGINAL: ArtKind = { key: 'original', label: 'Original' }

/** A Yu-Gi-Oh rarity text split as RARITY_LABEL wrote it: "Ultra Rare (Chibi artwork)" → rarity + variant, wiki markup stripped. */
export function splitRarity(setRarity: string): { rarity: string; variant: string | null } {
  const clean = setRarity
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/"/g, '')
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(clean)
  return m ? { rarity: m[1], variant: m[2] } : { rarity: clean, variant: null }
}

function ygoKind(variant: string | null): ArtKind {
  if (!variant) return ORIGINAL
  const whole = ygoPart(variant)
  if (whole) return whole
  for (const part of variant.split(',')) {
    const k = ygoPart(part)
    if (k) return k
  }
  return ORIGINAL
}

/** The art kind one piece of a variant names, or null when it names none. */
function ygoPart(variant: string): ArtKind | null {
  const v = variant.toLowerCase().trim()
  if (/^chibi( artwork)?$/.test(v)) return { key: 'chibi', label: 'Chibi' }
  if (/^overframe$/.test(v)) return { key: 'overframe', label: 'Overframe' }
  if (/^alternate art(work)?$/.test(v)) return { key: 'alternate', label: 'Alternate art' }
  if (/^manga-style\b/.test(v)) return { key: 'manga', label: 'Manga-Style' }
  if (/^anime( artwork)?$/.test(v)) return { key: 'anime', label: 'Anime' }
  if (/^japanese artwork$/.test(v)) return { key: 'japanese', label: 'Japanese artwork' }
  if (/^international artwork$/.test(v))
    return { key: 'international', label: 'International artwork' }
  const o = /^(\d+)(st|nd|rd|th) artwork$/.exec(v)
  if (o) return { key: `art-${o[1]}`, label: `${o[1]}${o[2]} artwork` }
  return null
}

/** originalImageId is the card's own first image: a One Piece printing on it is the original, not an alt art. */
export function artKind(p: Printing, game: GameId, originalImageId?: number): ArtKind {
  if (game === 'ygo') return ygoKind(splitRarity(p.setRarity).variant)
  if (game === 'op' && p.artImageId && p.artImageId !== originalImageId)
    return { key: `op${p.artImageId}`, label: 'Alternate art' }
  return ORIGINAL
}

export interface ArtGroup {
  kind: ArtKind
  printings: Printing[]
  thumb: Printing
}

function newer(a: Printing, b: Printing): boolean {
  const da = a.releaseDate ?? ''
  const db = b.releaseDate ?? ''
  if (da !== db) return da > db
  return a.id > b.id
}

/** Original first, then by printing count desc, then label. Empty-safe. */
export function artGroups(
  printings: Printing[],
  game: GameId,
  originalImageId?: number
): ArtGroup[] {
  const map = new Map<string, ArtGroup>()
  for (const p of printings) {
    const kind = artKind(p, game, originalImageId)
    const g = map.get(kind.key)
    if (g) {
      g.printings.push(p)
      if (newer(p, g.thumb)) g.thumb = p
    } else map.set(kind.key, { kind, printings: [p], thumb: p })
  }
  const groups = [...map.values()]
  if (game === 'op') {
    const alts = groups
      .filter((g) => g.kind.key !== 'original')
      .sort(
        (a, b) =>
          Math.min(...a.printings.map((p) => p.id)) - Math.min(...b.printings.map((p) => p.id))
      )
    if (alts.length >= 2)
      alts.forEach((g, i) => (g.kind = { key: g.kind.key, label: `Alternate art ${i + 1}` }))
  }
  return groups.sort((a, b) => {
    const ao = a.kind.key === 'original' ? 0 : 1
    const bo = b.kind.key === 'original' ? 0 : 1
    if (ao !== bo) return ao - bo
    if (a.printings.length !== b.printings.length) return b.printings.length - a.printings.length
    return a.kind.label.localeCompare(b.kind.label)
  })
}

export interface Pill {
  printing: Printing
  label: string
}
export interface SetRow {
  key: string
  setName: string
  language: Language
  codePrefix: string
  year: string | null
  pills: Pill[]
}

/** The code's text before its first dash or space ("RA01-EN001", "DLR 012/103", "SOS 113"), else the whole code. */
const codePrefixOf = (code: string): string => {
  const i = code.search(/[-\s]/)
  return i < 0 ? code : code.slice(0, i)
}

function baseLabel(p: Printing, game: GameId): string {
  if (game === 'ygo') {
    const r = splitRarity(p.setRarity).rarity
    return r !== 'Rare' && r.endsWith(' Rare') ? r.slice(0, -5) : r
  }
  if (game === 'mtg') {
    const f = finishOf(p.setRarity)
    const base = p.setRarity.replace(/ \((Etched )?Foil\)$/, '')
    return f === 'foil' ? `${base} · Foil` : f === 'etched' ? `${base} · Etched` : base
  }
  return p.setRarity
}

/** A printing's code past its set's prefix and separator ("RA01-EN001" → "EN001"), or the whole code when it has another prefix or none. */
const codeSuffix = (code: string, prefix: string): string =>
  code.startsWith(`${prefix}-`) || code.startsWith(`${prefix} `)
    ? code.slice(prefix.length + 1)
    : code

function pillLabels(printings: Printing[], game: GameId, prefix: string): string[] {
  const base = printings.map((p) => baseLabel(p, game))
  const count = (ls: string[]): Map<string, number> =>
    ls.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>())
  let counts = count(base)
  const withVariant = base.map((l, i) => {
    if (game !== 'ygo' || (counts.get(l) ?? 0) < 2) return l
    const v = splitRarity(printings[i].setRarity).variant
    return v ? `${l} · ${v}` : l
  })
  counts = count(withVariant)
  return withVariant.map((l, i) =>
    (counts.get(l) ?? 0) < 2 ? l : `${l} · ${codeSuffix(printings[i].setCode, prefix)}`
  )
}

export function setRows(
  printings: Printing[],
  game: GameId,
  preferSet?: { setName: string; language: Language }
): SetRow[] {
  const groups = new Map<string, Printing[]>()
  for (const p of printings) {
    const key = `${p.language}|${p.setName}`
    const g = groups.get(key)
    if (g) g.push(p)
    else groups.set(key, [p])
  }
  const rows = [...groups.entries()].map(([key, ps]) => {
    const codePrefix = codePrefixOf(ps[0].setCode)
    const dates = ps.map((p) => p.releaseDate).filter((d): d is string => !!d)
    const newest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
    const labels = pillLabels(ps, game, codePrefix)
    const row: SetRow = {
      key,
      setName: ps[0].setName,
      language: ps[0].language,
      codePrefix,
      year: dates.length ? dates[0].slice(0, 4) : null,
      pills: ps.map((printing, i) => ({ printing, label: labels[i] }))
    }
    return { row, newest }
  })
  const preferKey = preferSet ? `${preferSet.language}|${preferSet.setName}` : null
  rows.sort((a, b) => {
    const ap = a.row.key === preferKey ? 0 : 1
    const bp = b.row.key === preferKey ? 0 : 1
    if (ap !== bp) return ap - bp
    if (a.newest !== b.newest) {
      if (!a.newest) return 1
      if (!b.newest) return -1
      return a.newest > b.newest ? -1 : 1
    }
    const ae = a.row.language === 'en' ? 0 : 1
    const be = b.row.language === 'en' ? 0 : 1
    if (ae !== be) return ae - be
    return a.row.codePrefix.localeCompare(b.row.codePrefix)
  })
  return rows.map((r) => r.row)
}

export type LanguageMode = 'english' | 'all'

export function defaultLanguageMode(printings: Printing[]): LanguageMode {
  return printings.some((p) => p.language === 'en') ? 'english' : 'all'
}

/** The languages the 'english' mode lets through: en, every owned language, preferSet's. */
export function englishModeLanguages(
  owned: Printing[],
  preferSet?: { language: Language }
): Set<Language> {
  const set = new Set<Language>(['en'])
  for (const p of owned) set.add(p.language)
  if (preferSet) set.add(preferSet.language)
  return set
}

export function printingSummary(
  printings: Printing[],
  game: GameId,
  originalImageId?: number
): { printings: number; arts: number; sets: number; languages: number } {
  return {
    printings: printings.length,
    arts: artGroups(printings, game, originalImageId).length,
    sets: new Set(printings.map((p) => `${p.language}|${p.setName}`)).size,
    languages: new Set(printings.map((p) => p.language)).size
  }
}
