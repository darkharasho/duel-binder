import type { CardRow } from '../../../../shared/types'

/** Each attribute's dot colour. */
export const ATTRIBUTE_COLORS: Record<string, string> = {
  LIGHT: '#facc15',
  DARK: '#a855f7',
  WATER: '#3b82f6',
  FIRE: '#ef4444',
  EARTH: '#b45309',
  WIND: '#22c55e',
  DIVINE: '#d4a93c'
}

export const attributeColor = (attribute: string): string =>
  ATTRIBUTE_COLORS[attribute.toUpperCase()] ?? '#9ca3af'

type InfoRow = Pick<
  CardRow,
  'type' | 'frameType' | 'race' | 'attribute' | 'level' | 'linkval' | 'atk' | 'def' | 'desc'
>

export const isSpellOrTrap = (row: Pick<CardRow, 'type' | 'frameType'>): boolean =>
  row.frameType === 'spell' || row.frameType === 'trap' || /^(Spell|Trap) Card$/.test(row.type)

const isLink = (row: Pick<CardRow, 'frameType'>): boolean => row.frameType === 'link'
const isXyz = (row: Pick<CardRow, 'frameType'>): boolean => row.frameType.startsWith('xyz')

/**
 * The card's kind: "Dragon / Fusion", "Spellcaster / Effect", "Dragon / Synchro / Tuner";
 * "Spell Card · Quick-Play" for spells and traps. "Effect" only shows when it's all there is.
 */
export function typeLine(row: Pick<CardRow, 'type' | 'frameType' | 'race'>): string {
  if (isSpellOrTrap(row)) return row.race ? `${row.type} · ${row.race}` : row.type
  const words = row.type
    .replace(/\s*Monster$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === 'XYZ' ? 'Xyz' : w))
  const kinds = words.length > 1 ? words.filter((w) => w !== 'Effect') : words
  return [row.race, ...kinds].filter(Boolean).join(' / ')
}

/** "★ Level 8", "Rank 4" or "Link 3"; null for spells, traps and anything without one. */
export function levelLabel(row: InfoRow): string | null {
  if (isSpellOrTrap(row)) return null
  if (isLink(row)) return row.linkval != null ? `Link ${row.linkval}` : null
  if (row.level == null) return null
  return isXyz(row) ? `Rank ${row.level}` : `★ Level ${row.level}`
}

/** A printed stat: "?" when it's unknown (stored as null or negative). */
export const formatStat = (v: number | null): string => (v == null || v < 0 ? '?' : String(v))

/** The stat boxes: ATK and DEF, ATK and LINK for a Link, none for spells and traps. */
export function statBoxes(row: InfoRow): { label: string; value: string }[] {
  if (isSpellOrTrap(row)) return []
  const atk = { label: 'ATK', value: formatStat(row.atk) }
  if (isLink(row)) return [atk, { label: 'LINK', value: String(row.linkval ?? '?') }]
  return [atk, { label: 'DEF', value: formatStat(row.def) }]
}

/** Not the pendulum ones: their text starts with the pendulum effect, kept as stored. */
const MATERIAL_FRAMES = /^(fusion|synchro|xyz|link)$/

/** The card text, with an Extra Deck monster's materials (its first line) split off. */
export function splitDesc(row: Pick<CardRow, 'frameType' | 'desc'>): {
  materials: string | null
  text: string
} {
  const desc = row.desc.trim()
  const nl = desc.indexOf('\n')
  if (!MATERIAL_FRAMES.test(row.frameType) || nl === -1) return { materials: null, text: desc }
  return { materials: desc.slice(0, nl).trim(), text: desc.slice(nl + 1).trim() }
}
